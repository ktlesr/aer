# Aşama 4 — Sürümlü paket ve bağımsız doğrulama

Branch `feat/stage-4-packet-verification`, taban `4750e39` (Aşama 0–3 `main`'de).
Durum: **commit edilmedi** — bağımsız inceleme çalışma ağacı üzerinde yapılacak.

## 1. Sürümler (hiçbiri sessizce değişmez)

| Kimlik | Ne | Değişti mi |
| --- | --- | --- |
| `aer-canonical/1` | `canonicalize()`: sıralı anahtar, `undefined → null`, yapraklar `JSON.stringify` | Hayır (yalnız adlandırıldı) |
| `aer-chain/1` | `sha256(prevHash + "\n" + canonical(core))`, genesis `"AER-CHAIN-v1:" + runId` | Hayır |
| `aer-manifest/1` | Yeni: run bağlamı + olayların zincir dışı alanları, mühürde dondurulur | Yeni |
| `aer-receipt/1` | Yeni: mühür beyanı + isteğe bağlı Ed25519 imzası | Yeni |
| `aer-canonical/1+sha256` | Paket 2.0 `content_hash` (kanonik bayt) | Yeni |
| `emission-order-json+sha256` | Paket 1.x `content_hash` (yazarın anahtar sırası) | Hayır (adlandırıldı) |

Bir algoritma değişirse **yeni kimlik** alır; eski kimlik tarihsel kayıtları doğrulamaya devam eder.
`canonicalize.ts` ve `hash.ts` bu aşamada değişmedi.

**Deterministik serileştirme (test edildi):** sabit bir test vektörü (`packet.test.ts` ve CLI testi)
aynı baytları hem Vitest hem düz Node (derlenmiş CJS) altında üretir. Belgelenen davranışlar:
`-0 → 0`; 2^53 üstü tamsayılar çalışma zamanı tarafından zaten yuvarlanmıştır (büyük kimlikler metin
gönderilmeli); **Unicode normalizasyonu yapılmaz** (NFC ve NFD farklı bayttır); anahtarlar UTF-16 kod
birimine göre sıralanır; tek başına vekil (lone surrogate) `\ud800` olarak kaçışlanır.
Desteklenen ortam: Node ≥ 18 (ES2019+ well-formed `JSON.stringify`).

## 2. Paket 2.0 ve kapsam

Paket şimdi `versions` ve `coverage` alanlarını kendi içinde taşır.

| Mekanizma | Kapsar | Kim yeniden hesaplayabilir |
| --- | --- | --- |
| Olay zinciri (`seal` = zincir başı) | Her olayın seq, type, title, occurredAt, input/output, risk, maliyet, metadata, bulgular; sıra | DB/dosya yazabilen herkes (zinciri baştan) |
| Run manifesti (`manifest_hash`, mühürde dondurulur) | Run: id, tenant, agentName, status, riskLevel, startedAt, endedAt, costMicroUsd, sunucu politikası, istemci capture beyanı, environment, conversationRef, turnRef, parentRunId. Olay başına: zincir hash'i, sunucu politikası, capture beyanı, `sourced` bloğu (digest). Zincir başı ve olay sayısı | Aynı — **bu yüzden makbuz var** |
| `content_hash` | Paketin `export.content_hash` dışındaki her yeri | Dosyayı düzenleyen herkes |
| Makbuz (`receipt`) | `manifest_hash`, zincir başı, olay sayısı, tenant, sürümler | Kimse — müşteri sakladıysa veya imza güvenilen anahtarla doğrulanıyorsa |

**Bütünlüğe bağlı olmayanlar** (doğrulayıcı bunları her raporda listeler, gizlemez):
`run.durationMs/eventCount/redactionCount` (sayaçlar), `run.links.parentRun.status/agentName`
(export anında çözülür), `events[].sourced.not_recorded` (export anında türetilir),
`redaction_findings` (olay bulgularının kopyası; asılları zincirde), `export.generatedAt`.

**İnsan görünümü ile kanıt ayrımı:** dashboard ve PDF insan görünümüdür; PDF alt bilgisi artık
"Human-readable view, not the evidence · verify the JSON packet offline with aer-verify" der ve
manifest hash'ini gösterir. Kanıt JSON pakettir.

**Mühürsüz zincir:** `verifyChain` mühür yokken artık `verified` değil `consistent_unsealed` döner;
dashboard "Consistent so far · not sealed", PDF "Consistent so far · not sealed", `verify:run`
çıkış kodu 3.

**Eski paketleri yeniden yazmıyoruz:** Aşama 4'ten önce mühürlenmiş run'ların manifest'i `null`
kalır (geriye dönük hesaplanmaz — o an ne olduğunu değil bugünkü DB'yi bağlardı); doğrulayıcı
`not_frozen` / `verified_partial` der. Türev (düzeltilmiş) paket mekanizması **yok**; gerekirse ayrı
paket + açık referans olarak sonraki işe kalır.

## 3. Tehdit modeli

| Tehdit | Ne yakalar | Ne yakalamaz |
| --- | --- | --- |
| Dosya bozulması / elle düzenleme (olay) | Zincir (`broken`) | — |
| Dosyada run bağlamı/zincir dışı alan düzenlemesi | Manifest (`mismatch`) | Düzenleyen manifest'i de yeniden hesaplarsa: yalnız makbuz/imza |
| DB'de mühür sonrası değişiklik (agentName, status, sourced, lineage…) | Manifest, sonraki export'ta (`mismatch`) — test edildi | Operatör manifest hash sütununu da yeniden yazarsa: yalnız müşterideki makbuz |
| API anahtarı çalınması | Hiçbiri: geçerli anahtarla yazılan sahte olay geçerli kayıttır | Anahtar iptali ayrı süreç (CLAUDE.md) |
| Operatörün geçmişi tamamen yeniden yazması | **Müşterinin mühür anında sakladığı makbuz** (`trusted_receipt: mismatch`) — test edildi | Müşteri makbuz saklamadıysa hiçbir şey; imza anahtarı da operatördeyse imza yardım etmez |
| İmza anahtarının ele geçirilmesi | Hiçbiri, ele geçirilmeden önce saklanan makbuzlar dışında | Anahtar döndürme sonrası eski makbuzlar eski açık anahtarla doğrulanır; ele geçirilen anahtarla atılan imzalar ayırt edilemez |
| Paket içine sahte açık anahtar koymak | İmza yalnız doğrulayıcının verdiği anahtarla değerlendirilir (`untrusted_key`/`invalid`) — test edildi | — |

Sonuç: **"Operatöre güvenmeden kanıt" iddiası kullanılmaz.** Bağımsız dış mühür/zaman damgası
hizmeti yok; makbuzdaki `issued_at` AER sunucusunun saatidir (`clock: "aer-server"`).

## 4. Makbuz, imza ve anahtar akışı

- `POST /runs/{id}/complete` aynı satır kilidinde: sayaçlar → zincir başı → manifest → makbuz →
  tek `UPDATE` (`seal`, `manifestHash`, `manifestVersion`, `receipt`). Yanıt `{ run, receipt }`.
  Tekrar `complete` aynı makbuzu döner; idempotent replay de.
- İmza: Ed25519 (`node:crypto`, yeni bağımlılık yok) — beyanın `aer-canonical/1` baytları üzerine.
  Anahtar `AER_RECEIPT_SIGNING_KEY` (+ `AER_RECEIPT_KEY_ID`) env'den; yoksa makbuz imzasız ama yine
  çapa olarak geçerli (müşteri saklarsa). Gizli anahtar log'a, DB'ye, pakete, makbuza girmez.
- Açık anahtarlar: `GET /api/v1/receipt-keys` (kimlik doğrulamasız; aktif + `AER_RECEIPT_PUBLIC_KEYS`
  ile emekli anahtarlar). Doğrulayıcı bu uç noktayı **çağırmaz**; kullanıcı anahtarı önceden alıp
  sabitler (`--trusted-key`). Döndürme: yeni `key_id`, eski açık anahtar emekli listesine.
- Müşteri tarafı teslim: SDK 0.5 `run.complete()` makbuzu döndürür; müşteri kendi deposuna yazar.
  **Webhook eklenmedi** (yeni dış hizmet/SSRF yüzeyi açmamak için); harici teslim denemesi/başarısızlığı
  bu yüzden henüz yok.

## 5. Çevrimdışı doğrulayıcı — `@ktlsr/aer-verify`

```
aer-verify packet.json [--receipt receipt.json] [--trusted-key key.json]... [--require-anchor] [--json]
```

- Ayrı rapor satırları: şema, olay zinciri, mühür, run manifesti, content hash, paketteki makbuz,
  imza, saklanan makbuz ve imzası; `anchored` (güvenilen bir şeye bağlı mı); kapsam dışı alanlar.
- `overall`: `verified` · `verified_partial` (1.x şema / manifest öncesi) · `consistent_unsealed` ·
  `legacy_unchained` · `failed` · `unsupported`. Çıkış: 0 / 2 / 2 / 2 / 1 / 4.
- Ağ yok: derlenmiş paket `http/https/net/tls/dns` gerektirmez, `fetch` çağırmaz (testli).
- Doğrulama mantığı kopyalanmaz: CLI, `packages/evidence-chain/src`'yi derlemeye dahil eder
  (CJS, bağımlılıksız). Sunucu (`apps/web`) aynı `verifyPacket`/`buildManifest`'i kullanır.
- **Yerel paketleme testi (çalıştırıldı):** `npm pack` → 15 dosya, 13.9 kB → boş geçici dizine
  `npm install --offline ./ktlsr-aer-verify-0.1.0.tgz` → `aer-verify` 2.0 fixture'ı `VERIFIED`, çıkış 0.
  **npm'e yayımlanmadı.**

## 6. Uyumluluk

| | Bu sürüm öncesi sunucu | Bu sürüm |
| --- | --- | --- |
| collector-js ≤ 0.4 | Değişmedi | Çalışır; `complete` yanıtındaki `receipt` yok sayılır |
| collector-js 0.5 | `complete()` → `{ receipt: null }` | `{ receipt }` |
| Paket 1.1 / 1.3 (writer sırası) | — | Zincir + content hash `verified`, manifest yok → `verified_partial` (gerçek eski kodla üretilen fixture'lar) |
| Paket 1.3 (JSONB'den okunmuş) | — | Zincir `verified`; content hash `not_reproducible` (doğrulandı sayılmaz) → `verified_partial` |
| Paket 2.0 | — | Tam |
| Bilinmeyen şema (ör. 3.0) | — | `unsupported`, çıkış 4 |
| Aşama 4 öncesi mühürlenmiş run, yeni export | — | Paket 2.0, `manifest: not_frozen` → `verified_partial` |

Not: 1.x `content_hash` JSONB'de saklanan export'larda yeniden üretilemiyordu (PostgreSQL JSONB anahtar
sırasını değiştirir) — bu aşamada gerçek eski paketle yeniden üretildi; 2.0 kanonik hash bu yüzden.

## 7. Migration ve geri dönüş

`20261014090000_run_manifest_receipt`: `AgentRun`'a üç nullable sütun (`manifestVersion`,
`manifestHash`, `receipt`). Yalnız ekleme. Geri dönüş: kodu geri al, sütunlar düşürülebilir (o ana
kadar verilmiş makbuzlar müşteride kalır; sunucu tarafı manifest kaybolur). Üretim migration'ı
çalıştırılmadı.

## 8. Testler

| Dosya | Kapsam | Gerçek DB |
| --- | --- | --- |
| `packages/evidence-chain/src/packet.test.ts` | Sabit kanonik vektör; gerçek eski 1.1/1.3 paketler (writer sırası + JSONB); eski olay düzenlemesi; bilinmeyen/bozuk girdi; 2.0: düzenleme, sıra değişimi, 6 manifest alanı, türetilmiş alanlar, tam yeniden hesaplanmış sahte paket vs saklanan makbuz, bilinmeyen/yanlış anahtar, düzenlenmiş makbuz, content hash, mühürsüz; gerçek yazıcı fixture'ı | Hayır |
| `apps/web/tests/packet-v2.integration.test.ts` | Gerçek rotalar → JSONB → doğrulayıcı: imzalı makbuz + anchored; tekrar complete aynı makbuz; mühür sonrası DB düzenlemesi (agentName, status, lineage, sourced); mühürsüz; manifest öncesi run; imzasız makbuz; açık anahtar uç noktası; SDK uçtan uca | **Evet** |
| `packages/aer-verify/test/cli.test.js` | Derlenmiş CLI düz Node'da: çıkış kodları, anchored, `--require-anchor`, düzenlemeler, yabancı anahtar, eski paketler, gelecek şema, okunamayan girdi (yankısız), ağ modülü yok, çalışma ortamları arası aynı bayt | Hayır |
| `packages/collector-js/src/sourced.test.ts` | `complete()` makbuz / eski sunucuda `null` | Hayır |

## 9. Sınırlar

- Dış mühür/bağımsız zaman damgası yok; webhook teslimi yok; türev paket mekanizması yok.
- Makbuz ancak müşteri saklarsa veya imza anahtarı operatörden bağımsız güvenilirse operatöre karşı
  koruma sağlar. Üretimde imza anahtarı henüz yapılandırılmadı (makbuzlar imzasız çıkar).
- Dashboard manifest durumunu ayrıca göstermiyor (zincir durumunu gösteriyor); `verify:run` scripti de
  yalnız zinciri kontrol ediyor. Tam kontrol için JSON paket + `aer-verify`.
- 1.x paketlerin run bağlamı hiçbir mekanizmayla korunmuyordu; geriye dönük korunamaz.
- Doğrulama kaydedileni doğrular; olayların gerçekleştiğini, kaynakların doğruluğunu veya
  bildirilmeyen olay olmadığını değil.

## 10. Upgrade testi (yerelde çalıştırıldı)

`main` (`4750e39`) koduyla boş `aer_upgrade4` veritabanına 10 migration + seed (mühürlü `run_demo`,
9 olay); ardından bu aşamanın migration'ı ve yeni kodla: eski run'ın 2.0 export'u `verified_partial`
(zincir `verified`, content hash `verified`, manifest `not_frozen` — geriye dönük doldurulmadı); aynı
DB'de yeni run (`parentRunId: run_demo`) mühürlendi, makbuzla `verified` + `anchored`. Geçici
veritabanı ve worktree silindi.

## 11. Bağımsız inceleme düzeltmeleri (çalışma ağacı incelemesi)

| Bulgu | Kök neden | Düzeltme | Regresyon |
| --- | --- | --- | --- |
| P1 `__proto__` ile içerik eklenip imzalı paket hâlâ `verified`/anchored | `aer-canonical/1` nesneyi atamayla kurar; kendi `__proto__` anahtarı prototipe gider ve hash'lenen baytlardan düşer (eski koddan beri) | Algoritma **değiştirilmedi** (eski kayıtlar o baytlarla hash'lendi). Bunun yerine bu içerik temsil edilemez sayılır: API (`readJson`) `__proto__` anahtarlı gövdeyi `422` ile reddeder, hiçbir şey yazılmaz; doğrulayıcı böyle bir paketi `malformed`/`failed` sayar (CLI çıkış 1) | `review-stage4.test.js` (2), `packet.test.ts` (olay, sourced, makbuz), `packet-v2.integration.test.ts` (API 422) |
| P1 bilinmeyen algoritma sürümü (`aer-chain/999`) doğrulanıyor | Rapor sabitlerle dolduruluyor, paketin beyanı okunmuyordu | Paketin beyan ettiği `canonicalization/chain/content_hash/manifest`, `chain.algorithm` ve `chain.genesis` desteklenen sözleşmeye göre kontrol edilir; uyumsuz → `unsupported`, çıkış 4. Rapor beyan edilen değerleri gösterir | 6 varyant |
| P1 `sourced: []` null sayılıp doğrulanıyor | Şekil kontrolü yalnız `run.id`/`events` idi; manifest girişi nesne olmayanı null'a çeviriyordu | Sürüme göre şekil doğrulaması (zorunlu alanlar, null izinleri, tipler, hash biçimleri) hash/karşılaştırmadan **önce**; yanlış tip `malformed` | 8 varyant |
| P2 makbuzda tenant değişikliği yakalanmıyor | Yalnız `manifest_hash` ve `run_id` karşılaştırılıyordu | Tüm taahhütler: `receipt_version`, `manifest_version`, `run_id`, `organization_id`, `project_id`, `manifest_hash`, `chain_head`, `event_count`, `clock`; hem paketteki hem saklanan makbuz için | 7 alan × 2 yol |
| P2 CLI bozuk JSON'un parçasını yansıtıyor | `JSON.parse` hata metni girdiden alıntı yapabiliyor | Yalnız sabit mesajlar ("the packet file is not valid JSON" vb.); alttaki hata metni hiç yazılmaz | `review-stage4.test.js` |

**Sınır (yeni):** Bu değişiklikten önce `__proto__` anahtarlı içerik kabul edilip saklanmış olabilir
(Aşama 1 maskelemesi onu veri olarak tutuyordu). O run'ların paketleri artık `malformed` raporlanır —
doğru sonuç: o içerik hiçbir hash kapsamında değildi.
