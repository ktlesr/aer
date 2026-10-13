# Aşama 5 — SDK teslim güvenilirliği

Branch `feat/stage-5-sdk-delivery`, taban `0b9c941` (Aşama 0–4 `main`'de). Yalnız SDK
(`@ktlsr/collector-js` 0.6.0) değişti; sunucu, şema ve migration **yok**.
Durum: **commit edilmedi** — bağımsız inceleme çalışma ağacı üzerinde yapılacak.

## 1. Model

`startRun` dışındaki her yazım tek bir sıralı kuyruktan geçer (`src/queue.ts`). Sunucu `seq`'i varış
sırasıyla verdiği için bu sıra kanıt zincirinin sırasıdır. Aynı anda tek istek uçuşta (FIFO).

| Çağrı | Ne zaman döner | AER erişilemezse |
| --- | --- | --- |
| `startRun()` | run AER'de oluştuğunda | `maxRetries` sonrası hata; uygulama karar verir |
| `run.event()` | AER olayı **kabul ettiğinde** (önceki kuyruk öğelerinden sonra) | hata fırlatır — kayıtsız ilerlememesi gereken adımlar için |
| `run.enqueue()` | olay **kuyruğa alındığında** (store varsa diske yazıldığında) | sınırlar içinde arka planda denenir; hiç ulaşmazsa `onDeliveryError` + `stats().failed` + o run için `complete()` reddi |
| `run.complete()` | run mühürlendiğinde | hata; o run'ın `enqueue` edilmiş bir olayı teslim edilemediyse `undelivered_events` ve **hiçbir şey gönderilmez** |

**Politika (talimat §9):** Kritik işlemde `event()` kullanılır — teslim olmadan dönmez, başarısızlık
istisnadır; kayıtsız devam sessizce seçilemez. Düşük riskli adımda `enqueue()` ile devam edilir;
kayıp olursa uyarı hook'u, sayaç ve mühür reddi görünür kılar. Boşaltılmamış kuyruk tamamlanmış
çalışma olarak sunulmaz.

## 2. Hata sınıflandırması ve retry

| Durum | Davranış |
| --- | --- |
| Ağ hatası / timeout (status 0), okunamayan 2xx | Aynı `Idempotency-Key` ile tekrar |
| 408, 429, 5xx | Tekrar; `Retry-After` (saniye veya HTTP tarihi) uygulanır |
| Diğer 4xx (401, 404, 409, 422…) | Tekrar **yok**; kalıcı başarısızlık |
| Kısmi teslim | Her istek tek öğe: teslim edilenler kalır, edilemeyen her öğe ayrı raporlanır, ilgili run mühürlenmez |

Sınırlar: her bekleme `maxRetryDelayMs` (varsayılan 30 sn) ile sınırlı — `Retry-After` daha uzunsa
da. Beklenen çağrılar `maxRetries` (varsayılan 2) sonrası durur; arka plan öğeleri `maxItemAgeMs`
(varsayılan 10 dk) sonra kalıcı başarısız sayılır. Sonsuz retry yok.

## 3. Kuyruk sınırları ve backpressure

`maxQueueItems` (1000) ve `maxQueueBytes` (5 MB, JSON karakteri). Dolunca `whenFull: "throw"`
(varsayılan) `queue_full` fırlatır ve **hiçbir şey kuyruğa girmez**; `"wait"` yer açılana kadar
bekletir (backpressure). Tek öğe `maxQueueBytes`'tan büyükse her durumda `queue_full`. Sessiz düşürme
seçeneği yok.

Sayaçlar `stats()`: `queued`, `queuedBytes`, `delivered`, `failed`, `retries`.
`onDeliveryError({ kind, runId, idempotencyKey, reason, error })` — yük (payload) hiç verilmez;
hook hata fırlatırsa teslim durmaz.

## 4. Kapanış

- `flush(timeoutMs?)` → `{ delivered, failed, pending }`; hiç fırlatmaz.
- `shutdown(timeoutMs?)` → yeni yazımı reddeder (`recorder_closed`), süre içinde teslim eder; sonra
  bekleyen retry zamanlayıcısını iptal eder. Store yoksa kalanlar `reason: "closed"` ile raporlanır
  (süreçten sağ çıkamazlar); store varsa diskte kalır.
- Bekleyen retry zamanlayıcıları **unref edilmez**: Node süreci kuyruğu sessizce kaybetmek yerine
  `maxItemAgeMs`'e kadar açık kalır; çıkış süresini `shutdown(timeoutMs)` sınırlar. (İlk taslakta
  unref vardı; `flush()` beklenirken süreç çıkıp kuyruğu kaybediyordu — testle yakalandı.)
- Doğrulandı: 30 sn retry gecikmesiyle bile `shutdown(100)` sonrası süreç 124 ms'de çıktı.

## 5. Kalıcı kuyruk (isteğe bağlı)

`import { fileQueueStore } from "@ktlsr/collector-js/file-store"` — ayrı giriş noktası, tarayıcı/edge
paketlerine `node:fs` girmez. Varsayılan bellek içi; uygulamaya altyapı dayatılmaz.

- Dosya: `{ version: 1, items, failedRuns }`. Öğede yol, **capture politikası uygulanmış** gövde,
  `Idempotency-Key`, zaman; **API anahtarı yok** (testli). İzin `0600` (POSIX).
- Yazım: anlık görüntü → geçici dosya → `rename` (atomik); kayıtlar sırayla.
- Yükleme bir kez yapılır: açık `resume()` ile ya da ilk yazımda örtük olarak. Store varken varsayılan
  capture `redacted_content`'tır; açık `"full"` reddedilir (dosya sunucu maskelemesinden önce yazılır).
- `resume()`: önceki sürecin öğelerini aynı anahtarlarla teslime alır. Daha önce ulaşmış ama yanıtı
  kaybolmuş bir öğe sunucuda **replay** olur, ikinci kayıt oluşmaz. Run'a devam için aynı
  `startRun({ idempotencyKey })` aynı run'ı döndürür.
- Bozuk/biçimi bilinmeyen dosya: `resume()` reddeder, dosyaya dokunmaz, içeriği hata mesajına yazmaz.
  Boş kuyrukla sessizce üzerine yazılmaz.

## 6. Uyumluluk

| | 0.5 ve öncesi | 0.6 |
| --- | --- | --- |
| `event()` / `complete()` | Bekle, hata fırlat | Aynı (kuyruk üzerinden; önceki `enqueue` öğelerinin arkasında bekler) |
| 429 | Tekrar yok (4xx) | `Retry-After` ile tekrar |
| 408 | Tekrar yok | Tekrar |
| `enqueue`, `flush`, `shutdown`, `stats`, `resume`, `delivery`, `file-store` | — | Yeni |
| Sunucu | Değişmedi | Değişmedi (mevcut idempotency/seq sözleşmesi yeterli) |

## 7. Testler

| Dosya | Kapsam | Gerçek DB |
| --- | --- | --- |
| `packages/collector-js/src/delivery.test.ts` | 429 + `Retry-After` üst sınırı ve aynı anahtar; sınırlı retry; 4xx retry yok; kesintide `enqueue` + sıra + tekillik (yanıt kaybı dahil); ulaşmayan olay → hook (yüksüz) + `complete` reddi; 4xx olay → yalnız o run engellenir; kuyruk dolu `throw`/`wait`/bayt; store'suz kapanış raporu ve kapandıktan sonra ret; dosya store ile yeniden başlatma (aynı anahtarlar, çift kayıt yok, diskte API anahtarı yok); bozuk dosya reddi; hata fırlatan hook | Hayır (sahte AER Idempotency-Key ile tekilleştirir) |
| `apps/web/tests/sdk-delivery.integration.test.ts` | Gerçek rotalar: yanıt kaybı + kesinti + yeniden başlatma → 4 olay tek kez, sırada, mühürlü, zincir `verified`; reddedilen (409) olay → `complete` reddi, run mühürsüz | **Evet** |
| Mevcut SDK testleri (29) | Değişmeden geçiyor | — |

## 8. Sınırlar

- Tek kuyruk, tek uçuşta istek: bir öğenin retry'ı sonrakileri bekletir (head-of-line). Çok sayıda
  eşzamanlı run'da verim gerekirse run başına şerit (lane).
- `startRun` kuyruğa girmez: AER erişilemezken yeni run açılamaz (run kimliğini sunucu verir).
- `event()` ile beklenip başarısız olan olay run'ı engellemez — çağıran hatayı zaten aldı; tekrar
  deneyebilir. Yalnız arka plan (`enqueue`) kayıpları `complete`'i engeller.
- Kalıcı store yalnız Node dosya sistemi; tarayıcı için bellek içi (veya kendi `QueueStore`'unuz).
- Store'lu bir süreçte kalıcı başarısız sayılan olay `failedRuns`'ta saklanır; o run bu kurulumda
  mühürlenemez (bilinçli: eksik run tamam gösterilmez). Elle temizlik yolu yok.
- Bayt sınırı JSON karakter sayısıdır, disk baytı değil.

## 9. Bağımsız inceleme düzeltmeleri (çalışma ağacı incelemesi)

| Bulgu | Kök neden | Düzeltme | Regresyon |
| --- | --- | --- | --- |
| P1 varsayılan capture ile diske açık şifre | Store, sunucu maskelemesinden **önce** yazıyor; capture yoksa gövde ham | Store varken varsayılan capture `redacted_content` (sunucuya da öyle beyan edilir); store + açık `"full"` → kurucu hata verir | `review-stage5.test.mjs` 1, `delivery.test.ts` |
| P1 yeniden yüklenen `event()` reddi run'ı engellemiyor | Yalnız `background` olaylar `failedRuns`'a ekleniyordu | Kuralı "çağıran gerçekten haberdar mı?" yap: yalnız hâlâ bekleyen canlı bir `event()` çağıranı hatayı almış sayılır; arka plan ve yeniden yüklenen öğeler run'ı eksik bırakır | 2 |
| P1 kaydı başarısız `enqueue` sonradan gönderiliyor | Öğe önce belleğe, sonra diske yazılıyordu | Öğe yalnız ona ait kayıt başarıyla bittikten sonra teslim edilebilir olur; kayıtlar sırayla ve **çalıştıkları anda** alınan anlık görüntüyle yazılır, diğer kayıtlar bekleyen öğeyi içermez; başarısızlıkta iz kalmaz (`store_failed`) | 3 + eşzamanlı ekleme testi |
| P1 bozuk dosya reddinden sonra üzerine yazılıyor | Yükleme hatası yazım durumuna bağlı değildi | Store tek sefer yüklenir (açık `resume()` ya da ilk yazımda örtük); yükleme başarısızsa kuyruk hiçbir yazımı kabul etmez (`store_not_loaded`) ve hiç kaydetmez — dosya dokunulmadan kalır | 4 |
| P2 transport retry zamanlayıcısı `shutdown` sonrası süreci açık tutuyor | `wake` yalnız kuyruğun kendi beklemesini iptal ediyordu | `shutdown` bir `AbortSignal` tetikler: istemcinin kendi retry beklemesi ve uçuştaki istek iptal edilir; öğe store varsa diskte kalır (aynı anahtarla tekrar → en kötü replay), yoksa `closed` raporlanır | 5 (derlenmiş SDK, alt süreç) |

Ek: teslimden sonra başarısız olan kayıtlar `stats().storeErrors` ile sayılır (öğe yeniden başlatmada
aynı anahtarla tekrar gönderilebilir → replay). İnceleyicinin beş testi `test/review-stage5.test.mjs`
olarak kalıcı (yalnız import yolu değişti) ve `pnpm test` içinde derlenmiş SDK'ya karşı koşar.

### 9.1 İkinci inceleme turu (Codex, izole kopya — Claude tarafından başlatıldı)

| Bulgu | Kök neden | Düzeltme | Regresyon |
| --- | --- | --- | --- |
| P1 N1 yükleme/kayıt sürerken `shutdown` `pending=0` diyor, sonra yazım kabul ediliyor | `flush` yalnız `items`'ı sayıyordu; yükleme sonrası `closed` yeniden kontrol edilmiyordu; durmuş kuyrukta `event()` asılı kalabiliyordu | Süren `add` çağrıları sayılır (`pending` ve boşalma beklemesine dahil); örtük yükleme kapanıştan sonra biterse `recorder_closed`; kayıt kapanıştan sonra biterse öğe kalıcıdır (yazım başarılı) ama teslimini bekleyen olmaz; kapanışta store'da kalan öğeleri bekleyen `event()`/`complete()` `recorder_closed` alır (asılı kalmaz) | `review-stage5-followup.test.mjs` 1–2, `delivery.test.ts` |
| P2 N2 tek dosya yazım hatası sonraki tüm kayıtları engelliyor | `fileQueueStore` zinciri reddedilmiş halde kalıyordu | Her kaydın hatası çağırana gider, zincir toparlanır; sorun giderilince sonraki kayıt gerçekten denenir | 3 |

İnceleyicinin sandbox'ı süreç başlatamadığı için `pnpm` testleri/typecheck'leri ve R5 süreç çıkışı
testi orada **BLOCKED** kaldı; uygulayıcı ortamında çalıştırıldı (aşağıda).

### 9.2 Üçüncü inceleme turu (Codex, izole kopya, süreç izni açık — Claude tarafından başlatıldı)

Önceki 8 repro geçti; SDK ve web testleri ile typecheck'ler inceleyici ortamında da geçti. Yeni bulgular:

| Bulgu | Düzeltme | Regresyon |
| --- | --- | --- |
| P1 T3-1 yapısı bozuk öğeli dosya (`items:[null]`) reddedildikten sonra üzerine yazılıyor | Yüklenen durumun tamamı (sürüm, `failedRuns`, her öğenin alanları/tipleri, benzersiz id, `path`'in run'a ait olması, anahtar biçimi) **belleğe dokunmadan önce** doğrulanır; geçersizse `loaded` hiç açılmaz | round3 test 1 |
| P1 T3-2 kapanış süren kayıt bitmeden dönebiliyor | `flush`/`shutdown` boşalma koşuluna çalışan worker, süren kayıtlar ve süren yükleme dahil. **Süresiz `shutdown()`** başlamış her kaydı bekler → döndükten sonra bu recorder'dan hiçbir yazım düşemez. **Süreli `shutdown(ms)`** süreyi aşmaz; hâlâ süren kayıtları `checkpointsPending` ile raporlar | round3 test 3, `delivery.test.ts` (uyarlanmış B) |
| P2 T3-3 kapalı recorder `startRun` ile istek gönderiyor | `startRun` kapalı recorder'da `recorder_closed` verir, istek gitmez; uçuştaki `startRun` da kapanış sinyalini kullanır | round3 test 2 |
| P2 T3-4 açık `resume()` sürerken kapanış `pending=0` | Süren yükleme `pending`'e 1 olarak eklenir (yükleme yazmaz; kapanıştan sonra bitebilir) | round3 test 4 |

**Kabul edilmeyen repro (round3 test 5) ve gerekçesi:** Test, *süresiz* `shutdown()`'ın, kendi
bloklanmış kaydı hâlâ sürerken dönmesini, sonra o eski kaydın yeni sahibin durumunu ezmemesini istiyor.
Aynı turun test 3'ü ise süresiz `shutdown()`'ın süren kaydı beklemesini istiyor; ikisi birlikte
sağlanamaz. Kuyruk, store'a verilmiş bir kaydı geri alamaz (özel `QueueStore` kendi yazımını
istediği zaman uygular). Seçilen sözleşme: süresiz kapanış kayıtları bekler (eski yazımın sonradan
düşmesi imkânsız), süreli kapanış raporlar (`checkpointsPending`). Testin amacı (eski kayıt yeni
kaydı silmesin) `delivery.test.ts`'teki uyarlanmış testle korunur. Test dosyası değiştirilmeden
duruyor; `pnpm test` bu tek testi `--test-skip-pattern` ile atlar. Tek başına çalıştırıldığında
tasarım gereği bloklanır (doğrulandı).

**Sınır:** Süreli kapanıştan sonra `checkpointsPending > 0` iken aynı store ile ikinci bir recorder
açmak, eski kaydın sonradan düşmesine açıktır — rapor bu yüzden var. Dosya store'unda süreçler arası
kilit (fencing) yok; aynı dosyayı aynı anda iki süreç kullanmamalı.

### 9.3 Dördüncü inceleme turu (Codex — Claude tarafından başlatıldı)

İnceleyici §9.2 itirazını değerlendirdi: **"literal testlere ilişkin karar: uygulayıcı haklı"** — round3
test 3 ve test 5 aynı arayüz altında birlikte karşılanamaz; tek testi gerekçeyle suite dışında bırakmak
kabul engeli değil, uyarlanmış regresyon korunmalı ve süreli devir sınırı kullanıcıya açıklanmalı.
Zorunlu beş kontrol inceleyici ortamında geçti. Yeni bulgular:

| Bulgu | Düzeltme | Regresyon |
| --- | --- | --- |
| P2 T4-1 süreli kapanıştan sonra ikinci süresiz `shutdown()` çözülmüyor | Durmuş kuyrukta kalıcı öğeler "süren iş" sayılmaz (worker onları bir daha teslim etmez); yalnız süren yükleme/ekleme/kayıt beklenir, öğeler `pending` raporlanır | round4 test 3, `delivery.test.ts` |
| P2 T4-2 README süreli kapanış sonrası store devir tehlikesini anlatmıyor | README: `checkpointsPending` kontrolü örneği; sıfır değilken store'u başka recorder'a verme; süreçler arası kilit yok | round4 test 2 (tehlikeyi gösterir — `checkpointsPending` yok sayılırsa kayıp) |

### 9.4 Commit sonrası güvenlik incelemesi: geçici dosya

Otomatik güvenlik incelemesi `file-store.ts`'te güvensiz geçici dosya buldu: ad tahmin edilebilir
(`<yol>.<pid>.tmp`) ve `writeFile` varsayılan bayrakla açıyordu — o ada önceden konmuş bir
dosya/sembolik bağ üzerinden yazılabilir, `0600` yalnız yeni dosyada geçerliydi.

Düzeltme (Codex odaklı incelemesi iki tur):
- Rastgele ad (`randomBytes(12)`, 96 bit) ve **özel oluşturma** (`open(tmp, "wx", 0o600)` =
  O_CREAT|O_EXCL): önceden var olan dosya/bağ üzerinden yazılmaz, kayıt `EEXIST` ile reddedilir.
- **Sahiplik açılışla belirlenir:** yalnız bu kaydın oluşturduğu geçici dosya silinir. (İlk sürüm
  `EEXIST` sonrasında da siliyordu — başkasına ait dosyayı; Codex S1, düzeltildi.) Yazım tanıtıcı
  üzerinden yapılır; yarıda kalan yazımda da kendi dosyası temizlenir.
- Yeni oluşturulan dizin `0700`.

Güvence sınırları (Codex S2):
- Temizlik **en iyi çabadır**: `rename`/`unlink` reddi veya ani süreç sonu geçici dosya bırakabilir;
  asıl hata yine çağırana gider, eski kuyruk korunur.
- `0600`/`0700` POSIX izinleridir ve yalnız **yeni** dosya/dizinde uygulanır; mevcut dizin izinleri
  düzeltilmez. Windows'ta erişim üst dizinin ACL'ine bağlıdır.
- Sembolik bağ değerlendirmesi yalnız yazım/`rename` içindir (`rename` hedefteki bağın kendisini
  değiştirir). `load()` hedef yolu okurken bağı izler; saldırganın değiştirebildiği üst dizin
  bileşenleri korunmaz. **Store yolu özel bir dizinde olmalı** (README).
- `fsync` yok: atomik `rename` tam anlık görüntü yayımlar ama güç kesintisine karşı kalıcılık
  garantisi değildir.

Regresyon: `delivery.test.ts` (eski öngörülebilir ada konmuş dosyaya dokunulmaz; yarıda kalan
yazımda kendi dosyası silinir, eski görüntü ve sonraki kayıt sağlam), `test/review-temp-security.test.mjs`
(Codex; `EEXIST`'te başkasının dosyası silinmez). Codex'in kısmi yazım testi `fs.writeFile`'ı
yamaladığı ve düzeltme artık onu çağırmadığı için `pnpm test`'te atlanır; amacı uyarlanmış testle
korunur. Sembolik bağ testi Windows'ta (yetki) BLOCKED.
