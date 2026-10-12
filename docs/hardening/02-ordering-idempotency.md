# Aşama 2 — Sıralama, tamamlama ve tekrar gönderim

## 1. Serileştirme

Olay ekleme (`POST /runs/:id/events`) ve tamamlama (`POST /runs/:id/complete`) aynı düzeni kullanır
(`lib/api/helpers.ts#lockRun`):

1. Tek bir Prisma interaktif transaction (`RUN_TX`: `maxWait` 10 sn, `timeout` 20 sn).
2. İlk ifade: `SELECT "id" FROM "AgentRun" WHERE id/org/proje = … FOR UPDATE`.
3. Kilit alındıktan sonra çalışma durumu, en yüksek `seq` ve zincir başı okunur (READ COMMITTED:
   her ifade yeni snapshot alır).
4. Olay + bulgular + zincir bağlantısı + sayaçlar (veya tamamlamada sayım + mühür) aynı
   transaction'da yazılır. Herhangi bir hata hepsini geri alır; idempotency kaydı da dahil.

Seçim gerekçesi: satır kilidi PostgreSQL'in standart, deterministik aracıdır; SERIALIZABLE + retry
döngüsüne gerek bırakmaz. **Sınır:** aynı çalışmaya eşzamanlı yazımlar sıraya girer. Farklı
çalışmalar birbirini beklemez. Kuyruk `maxWait`/`timeout`'u aşarsa istek 500 alır; aynı
`Idempotency-Key` ile tekrar güvenlidir.

## 2. `seq` sözleşmesi

`seq` = olayın zincirdeki konumu (müşteri adım numarası **değil**).

| İstek | Sonuç |
| --- | --- |
| `seq` yok (önerilen) | Kilit altında `max(seq) + 1` |
| `seq` > mevcut en büyük | Kabul (boşluklar serbest — eski istemciler için) |
| `seq` mevcut, içerik aynı | `200 { idempotent: true }`, eski olay |
| `seq` mevcut, içerik farklı | `409 conflict` (eskiden eski olay `200` dönüyor, yeni içerik kayboluyordu) |
| `seq` ≤ mevcut en büyük ve yok | `409 conflict` (eskiden kabul edilip zincir sırasını bozuyordu) |

"İçerik aynı" = maskelenmiş title/input/output/metadata/type/risk/cost/bulgular eşit
(`seq`, `occurredAt` hariç). Müşteri adım numarası `metadata` içinde taşınmalı.
Doğrulayıcı değişmedi; eski boşluklu zincirler aynen doğrulanır.

## 3. Tamamlama

- Tamamlanmış/başarısız çalışmaya yeni olay: `422 run_already_completed` (kilit altında kontrol).
- Tekrar `complete`, aynı `status` (ve verilmişse aynı `endedAt`): `200`, satır değişmez.
- Farklı `status` veya `endedAt`: `409 conflict`; `endedAt`, `status`, `seal` değişmez.

## 4. Idempotency-Key

- Başlık: `Idempotency-Key`, 1–200 karakter `A-Z a-z 0-9 . _ : -` (aksi `422`, değer yankılanmaz).
- Kapsam: `(organizationId, projectId, key)` unique; org/proje API anahtarından çözülür.
  Başka tenant'ın aynı anahtarı ayrı bir anahtardır, sonuç sızmaz.
- Kayıt aynı transaction içinde `INSERT … ON CONFLICT DO NOTHING` ile alınır; eşzamanlı ikinci
  istek unique index üzerinde ilkinin commit/rollback'ini bekler.
- Aynı anahtar + aynı işlem/çalışma + aynı anlam → ilk yanıt aynen (durum kodu dahil) döner,
  `Idempotent-Replayed: true`. Çalışma sonradan tamamlanmış olsa da.
- Aynı anahtar + başka işlem, başka çalışma veya farklı içerik → `409 conflict`; ilk yazım değişmez.
- Saklanan: `requestHash` = **maskelenmiş** isteğin + bulgu hash'lerinin `sha256(canonical)`'ı ve
  hassas olmayan yanıt (kimlikler, sayılar). Ham gövde saklanmaz; hash, olay satırlarının zaten
  içerdiğinden fazlasını açığa çıkarmaz. Sonuç: yalnız gizli alan içinde farklılaşan iki gövde aynı
  sayılır (zaten aynı şekilde saklanırlar).
- Saklama: 24 saat (`IDEMPOTENCY_TTL_MS`). Süresi dolan anahtar yeniden kullanılınca eski kayıt
  silinip yeni istek işlenir — o andan sonra gelen geç bir retry **yeni kayıt oluşturabilir**.
  Süresi dolanlar `pnpm prune:runs --apply` ile de silinir.

## 5. SDK (collector-js 0.3.0)

- Her `startRun` / `event` / `complete` çağrısı bir kez anahtar üretir (`crypto.randomUUID`) ve
  bütün retry'larda aynısını yollar. `idempotencyKey` alanıyla dışarıdan verilebilir (gövdeye girmez).
- Timeout yanıt gövdesinin okunmasını da kapsar.
- JSON olmayan yanıt: HTTP durumu korunur, gövde mesaja yazılmaz; 5xx ve okunamayan 2xx retry edilir.
- 4xx (409 dahil) retry edilmez. 429/`Retry-After` desteği Aşama 5'e bırakıldı.

## 6. Kabul testleri (gerçek PostgreSQL)

Dosyalar: `apps/web/tests/ordering.integration.test.ts`, `apps/web/tests/sdk-retry.integration.test.ts`.
Yarışlar `sleep` ile değil, **test tarafından tutulan satır kilidiyle** kurulur: istekler kilidin
arkasında sıraya alınır, `pg_blocking_pids` ile (özyinelemeli — ikinci bekleyen ilk bekleyenin
tuple kilidine takılır) tam beklenen sayıda oturumun beklediği doğrulanır, sonra kilit bırakılır.

| # | Test | Eski kod (`9a3b5ed` rotaları) | Yeni kod |
| --- | --- | --- | --- |
| 1 | 100 paralel olay | **1×201, 99×422** (seq çakışması; olay kaybı) | 100×201, seq 1..100, sayaç 100, zincir `verified` |
| 2 | Aynı anahtarla 20 paralel olay / 10 paralel run | 10 olay / birden çok run | 1 olay, 1 run; 19 yanıt `Idempotent-Replayed` |
| 3 | Aynı anahtar, farklı içerik; aynı `seq` farklı içerik; geriye `seq` | `201` / `200` (sessiz kayıp) / kabul | `409` / `409` / `409`; boşluklu ileri `seq` kabul, zincir doğrulanır |
| 4 | Commit sonrası yanıt kaybı + retry (API ve SDK uçtan uca) | API: 2 olay; SDK: 2 run | Tek kayıt; SDK zinciri `verified` |
| 5a | Olay önce sıraya girer, sonra complete | Olay 201 ama **mühür olayı içermiyor** | Olay mühürlü zincirde |
| 5b | Complete önce, sonra olay | Olay **mühürden sonra 201** ile eklendi | Olay `422`, mühür sonrası ekleme yok |
| 6 | Tekrar complete; mühür sonrası kabul edilmiş olayın retry'ı | Farklı status `200` ile üzerine yazıldı | Aynı → 200 değişiklik yok; farklı → 409; kabul edilmiş retry → ilk sonuç; yeni olay → 422 |
| 7 | Bulgu yazımında enjekte edilmiş DB hatası (trigger) | — | 500; olay/bulgu/sayaç/idempotency kaydı yok; aynı anahtarla retry tek kez yazar |
| 8 | Tenant izolasyonu | — | Aynı anahtar iki org'da iki ayrı run; yabancı org yazamaz/replay edemez (404); anahtar başka işlemde 409; bozuk anahtar 422 |

"Eski kod" sütunu, aynı test dosyasının değişiklik öncesi rotalarla gerçekten çalıştırılmasından
gelir (14/16 kırmızı; 7 ve 8'in bir kısmı eski kodda yeni tabloya dayandığı için anlamlı değil).
Yeni kodda dosyalar 5 ardışık çalıştırmada 16/16 geçti (tekrar, başarısızlığı gizlemek için değil
kararlılığı göstermek için yapıldı; hiçbir çalıştırma başarısız olmadı).

## 7. Uyumluluk matrisi

| İstemci → Sunucu | Bu sürüm öncesi sunucu | Bu sürüm |
| --- | --- | --- |
| collector-js ≤ 0.2 | Değişmedi | Çalışır. Anahtar yok → retry'da yinelenme riski eskisi gibi. Açık `seq` kullanıyorsa: aynı içerikli retry 200, farklı içerik artık 409 |
| collector-js 0.3 | `Idempotency-Key` ve `capture` sessizce yok sayılır; istemci maskelemesi yine çalışır | Tam destek |
| Ham API | Değişmedi | Başlık opsiyonel; `seq` kuralları yukarıdaki gibi |
| Paket 1.1 (eski export) | — | Aynen doğrulanır (zincir algoritması değişmedi) |
| Paket 1.2 | — | `capture` alanları eklendi; zincir hash'i 1.1 ile aynı |

**Upgrade testi (yerelde çalıştırıldı):** referans commit kodu ile boş bir veritabanı kuruldu ve
eski kodla sentetik veri yazıldı (seed'in mühürlü demo run'ı + açık `seq` kullanan, tamamlanmamış
bir run). Ardından bu teslimin üç migration'ı uygulandı ve yeni kodla: eski mühürlü run DB ve paket
yolundan `verified`; eski açık run'a aynı `seq` ile retry `200`; yeni olay `201`; complete `200`;
eski (politika `null`) ve yeni (`aer-redaction/2`) olayları içeren zincir `verified`. Geçici
veritabanı ve worktree silindi.

## 8. Migration ve geri dönüş

Üç migration (`finding_type_secret`, `capture_policy`, `idempotency_records`) yalnızca ekleme yapar.
Geri dönüş: kodu geri al; `IdempotencyRecord` tablosu ve yeni sütunlar düşürülebilir
(yalnız tekrar-önleme geçmişi ve politika etiketleri kaybolur). `FindingType.secret` enum değeri
PostgreSQL'de geri silinemez; kullanılmadan kalır. Bu yüzden "tam rollback destekleniyor" denmez.
Üretim migration'ı bu teslimde **çalıştırılmadı**.

## 9. Bilinen sınırlar

- Aynı çalışmaya yazımlar tek sıra; çok yüksek eşzamanlılıkta `RUN_TX` limitleri aşılabilir (500 → güvenli retry).
- 24 saatten sonra gelen retry yeni kayıt oluşturabilir.
- Eski bir olay, yeni politika ile farklı maskelenecek içerikle aynı `seq`'te tekrar gönderilirse
  içerik "farklı" sayılır (409).
- Kalıcı istemci kuyruğu, `flush()`, 429/`Retry-After` yok (Aşama 5).
- `human_approval_granted` hâlâ SDK tarafından bildirilebiliyor (Aşama 6).
