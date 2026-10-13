# Aşama 6 — Kimliği doğrulanmış insan onayı

Branch `feat/stage-6-human-approval`, taban `8dcf1e1` (Aşama 0–5 + geçici dosya düzeltmesi `main`'de).

## 1. Model: üç taraf, üç kanal

| Taraf | Kanal | Yapabildiği |
| --- | --- | --- |
| Ajan | API anahtarı | Onay **ister** (bir run'da tek bir eylem + parametreler), durumunu okur, eylemden hemen önce **kullanır** (consume), sonucu **beyan eder** |
| İnsan | Dashboard oturumu (Auth.js), kendi workspace'i | Bekleyen isteği **onaylar / reddeder**, onaylanmışı **geri alır** |
| AER | Sunucu | Her adımı run'ın kanıt zincirine **kendisi** yazar |

**API anahtarı tek başına doğrulanmış onay üretemez:** onaylama yalnız server action'lar üzerinden,
`requireDashboardAccess()` (oturum + workspace kapsamı) ve `auth()` (kullanıcı kimliği) ile yapılır;
formdan yalnız onay id'si alınır, tenant/kullanıcı asla. API'de onaylama rotası yoktur.

## 2. Bağlama

- **Eylem ve parametreler:** `actionHash = sha256(salt + "\naction\n" + action)` ve
  `paramsHash = sha256(salt + "\n" + canonical(params))`, `salt` onay başına rastgele 16 bayt. İkisi
  de **ham** değerler üzerinden — maskelenmiş değerler üzerinden olsaydı iki farklı e-posta aynı
  belirtece dönüşüp tek onayı paylaşabilirdi (Codex R2: `notify:a@…` / `notify:b@…` aynı onayı
  kullanabiliyordu; düzeltildi). Ayrı hash'ler sayesinde neden kesin: `approval_action_mismatch` /
  `approval_params_mismatch`. Saklanan: tuzlu hash + maskelenmiş
  kopya; ham parametreler ve tuzsuz hash hiçbir yerde saklanmaz (idempotency parmak izleri dahil:
  create maskelenmiş değerden, consume tuzlu özetten). Karşılaştırma `timingSafeEqual`.
- **Run ve tenant:** onay bir run'a ve onun org/projesine bağlı (bileşik FK); başka tenant 404.
- **Süre:** `ttlSeconds` 30–86400 (varsayılan 900). Süresi geçmiş istek onaylanamaz; onaylanmış ama
  süresi geçmiş onay kullanılamaz (`approval_expired`). "expired" saklanmaz, hesaplanır.
- **Kullanım sayısı:** `maxUses` 1–10 (varsayılan 1). Her kullanım run satır kilidi altında sayılır;
  eşzamanlı 8 consume'dan tam biri geçer (test). `Idempotency-Key` ile tekrar edilen consume replay
  olur, ikinci kullanım sayılmaz.
- **Run kapanışı:** mühürlenmiş run'da karar/geri alma/kullanma yok (`run_already_completed`).

Reddedilme nedenleri (409, `error.message`): `approval_pending`, `_rejected`, `_revoked`,
`_expired`, `_used_up`, `_action_mismatch`, `_params_mismatch`, `run_already_completed`.

## 3. Zincir kaydı ve "bildirilen" ile "doğrulanmış" ayrımı

Her adım sunucu tarafından, olay API'siyle aynı kod yolundan (`lib/api/appendEvent.ts`, olay rotası
bu aşamada bu ortak modüle taşındı) zincire yazılır:

| Adım | Olay türü | `metadata.aer_approval` |
| --- | --- | --- |
| İstek | `human_approval_requested` | id, action, params_hash, expires_at, max_uses, `state: requested` |
| Onay | `human_approval_granted` | + `state: approved`, `decided_by_user_id`, `decided_at` |
| Ret / geri alma | `human_approval_rejected` (yeni) | `state: rejected` / `revoked` |
| Kullanım | `human_approval_used` (yeni) | `state: used`, `use` |

- `metadata.aer_approval` **ayrılmış**: olay API'si istemciden geleni `422` ile reddeder.
- `human_approval_rejected` ve `human_approval_used` yalnız sunucu yazar; API'de olay türü değildir (`422`).
- SDK'nın kendi gönderdiği `human_approval_granted`/`_requested` olayları kabul edilir ama
  **"Reported by the agent · not verified"** olarak gösterilir.
- Zaman çizelgesi dört etiket kullanır (Codex R3 sonrası): **request** "Requested by the agent ·
  recorded by AER · no decision yet", **decision** "Verified by AER · signed-in user decision"
  (yalnız `granted`/`rejected` + `state` + `decided_by_user_id`), **use** "Checked by AER · approval
  used for the matching action", **reported** "Reported by the agent · not verified". AER'e ait
  sayılmak için: `aer_approval` anahtarı + `recorded_by: aer-server` **ve** o id'nin bu run'ın
  `Approval` tablosunda bulunması (anahtar ayrılmadan önce bir istemci onu yazmış olabilir; ama
  `Approval` satırı yalnız sunucu oluşturur).
- Karar veren kullanıcı zincirde iç kullanıcı id'siyle (`decided_by_user_id`) yer alır, e-posta değil;
  dashboard e-postayı aynı workspace içinden gösterir.
- Bu olaylar normal zincir olaylarıdır: paket/manifest/makbuz/`aer-verify` onları kapsar (test:
  onay adımlarını içeren mühürlü paket `verified`).

## 4. Dış sistem sonucu

`POST /approvals/{id}/outcome` `{ status, externalRef?, receiptHash? }` — yalnız kullanılmış onayda,
bir kez. `source: "application"` ile saklanır; dashboard'da **"Outcome reported by the application
(not verified)"**. AER dış sistemin makbuzunu doğrulamaz. Sonuç zincire yazılmaz (yalnız onay kaydında).

## 5. Ne iddia edilmez

AER eylemi **teknik olarak engellemez**. "Onaysız işlem yapılamaz" ancak uygulama, eylemden hemen
önce `consume` çağırıp reddedildiğinde durursa doğrudur. Dashboard bunu panelde açıkça yazar.

## 6. API ve SDK

| Yol | Yetki | Not |
| --- | --- | --- |
| `POST /api/v1/runs/{run_id}/approvals` | API anahtarı | `{ action, params?, ttlSeconds?, maxUses? }` (strict) → 201 pending; `Idempotency-Key` |
| `GET /api/v1/approvals/{id}` | API anahtarı | durum (etkin durum: expired / used_up hesaplanır) |
| `POST /api/v1/approvals/{id}/consume` | API anahtarı | `{ action, params? }`; `Idempotency-Key` |
| `POST /api/v1/approvals/{id}/outcome` | API anahtarı | uygulama beyanı |
| Dashboard server action'ları | Oturum + workspace | approve / reject / revoke |

SDK 0.7.0: `run.requestApproval()`, `getApproval()`, `waitForApproval()` (sınırlı yoklama),
`consumeApproval()` (reddedilirse fırlatır), `reportApprovalOutcome()`. Bunlar kuyruktan geçmez
(anında cevap gerekir); kapanmış recorder'da istek göndermez. Onay parametreleri capture politikasından
**geçirilmeden** gönderilir (bağlama gerçek değerler üzerinden olmalı) — README'de yazılı.

## 7. Migration ve geri dönüş

`20261014150000_verified_approvals`: `ApprovalStatus` enum, `Approval` tablosu (bileşik FK, cascade),
`EventType`'a iki değer (`ADD VALUE IF NOT EXISTS`). (İnceleme sırasında henüz yayınlanmamış tabloya
`actionHash` kolonu eklendi; migration dosyası commit'ten önce güncellendi.) Geri dönüş: kodu geri al, tablo/enum tipi düşürülebilir; **`EventType`
değerleri PostgreSQL'de silinemez** — tam geri dönüş iddia edilmez. Üretim migration'ı bu teslimde
çalıştırılmadı.

## 8. Testler

| Dosya | Kapsam | Gerçek DB |
| --- | --- | --- |
| `apps/web/tests/approvals.integration.test.ts` | Tam akış + zincir; A→B (farklı parametre/eylem/ek alan); yanlış tenant okuma/kullanma/karar/istek (404); API anahtarı onay üretemez (sunucu türleri ve ayrılmış anahtar 422, bildirilen olay "reported"); süresi dolmuş/reddedilmiş/geri alınmış/tükenmiş; eşzamanlı consume (tam bir); idempotent consume; mühürlü run + paket doğrulama; sonuç beyanı + ham parametre saklanmaması; istek sınırları; SDK uçtan uca | **Evet** |
| `apps/web/components/approvals-panel.test.tsx` | Doğrulanmış karar ile uygulama beyanının ayrı gösterimi; açık run'da eylem düğmeleri, kapalıda yok; "engellemez" notu | Hayır |

## 9. Sınırlar

- Workspace tek kullanıcılı (sahip): "yetkili kullanıcı" = workspace'in oturum açmış sahibi. Rol/RBAC yok
  (CLAUDE.md kapsam dışı). İkinci bir onaylayıcı veya dört göz ilkesi yok.
- Bildirim yok: insan, bekleyen onayı dashboard'da görür (SDK `waitForApproval` yoklar).
- Kullanım (consume) dışındaki başarısız denemeler (ör. parametre uyuşmazlığı) zincire yazılmaz.
- Dış sonuç yalnız uygulama beyanıdır.
- Onay parametreleri capture politikasından geçmez; içerik değil tanımlayıcı gönderilmeli.

## 10. Bağımsız inceleme (Codex, Claude tarafından başlatıldı)

**1. tur — CHANGES_REQUIRED.**
- R1 "onay rotaları eksik": **inceleme kopyası hatası** — kopyayı hazırlayan PowerShell `Copy-Item`,
  `[approval_id]` gibi köşeli parantezli yolları joker karakter sayıp kopyalamadı (uygulayıcının kendi
  özet karşılaştırması bunu `DIFF` olarak gösterdiği hâlde inceleme başlatıldı). Rotalar ağaçta vardı;
  sonraki turlarda `-LiteralPath` ve kopya özetleri eşleşmeden inceleme başlatılmaz.
- R2 maskelenmiş eylem adı üzerinden onay paylaşımı → ham eylem adının ayrı tuzlu hash'i (`actionHash`).
- R3 bekleyen istek "insan kararı" gibi rozetleniyordu → dört ayrı etiket.
- Gözlem: servis `__proto__` korumasını HTTP katmanına bırakıyordu → serviste de reddedilir (422).

**2. tur — CHANGES_REQUIRED** (gerçek HTTP + Auth.js oturumu + CSRF dahil; inceleyici uygulamayı
`:3156`'da çalıştırdı). R1 kopya hatası olarak kapatıldı; R2/R3 normal girdilerde doğrulandı. Yeni:
- R4 (orta) `1e400` → `Infinity` → kanonik `null`: `amount:1e400` için verilen onay `amount:null` ile
  kullanılabiliyordu. R5 (orta) eşleşmemiş UTF-16 surrogate'lar UTF-8'de U+FFFD'ye dönüşüp farklı
  eylem adlarını birleştiriyordu. Düzeltme: onay girdileri hash'ten **önce** doğrulanır
  (`unsupportedApprovalValue`): sonlu olmayan sayı, 2^53 üstü tamsayı (ayrıştırıcı zaten yuvarlar —
  büyük sayılar/kesin ondalıklar metin gönderilmeli), eşleşmemiş surrogate (değer ve anahtar),
  `__proto__` → `422`; hata yolu anahtar adlarını yazmaz. İstek ve consume aynı kuralı kullanır.
  Zincir kanonikleştirmesi değiştirilmedi.
- R6 (düşük) `shutdown()` `waitForApproval` beklemesini iptal etmiyordu → bekleme recorder'ın kapanış
  sinyaline bağlı.
- İnceleyicinin testleri: `tests/review-stage6-sdk.test.ts` (varsayılan pakette) ve
  `tests/e2e/review-stage6-http.e2e.ts` (çalışan uygulama ister; yalnız import yolu değişti).
  Uygulayıcı ortamında uygulama `:3156`'da `aer_test`'e karşı çalıştırıldı: **4/4 geçti**
  (R4/R5 HTTP repro'ları, oturum/CSRF/yabancı kullanıcı, tenant, idempotency).
- Kalan sınır: sonlu sayılar IEEE-754 double olarak karşılaştırılır (`1.00000000000000001` = `1`);
  kesinlik gerekiyorsa değer metin olarak gönderilmeli (README).

**3. tur — CHANGES_REQUIRED.** R4/R5/R6 düzeltmeleri doğrulandı (271 test geçti). Yeni:
- R7 (orta) `-0` kanonik olarak `0` olur: `-0` için verilen onay `0` ile kullanılabiliyordu.
  Düzeltme: `-0` de reddedilir (`422`, "send 0"). İnceleyicinin testi `-0`'ın kabul edilip consume'da
  `0`'dan ayrılmasını (409) varsayıyordu; seçilen çözüm `-0`'ı hiç kabul etmemek (canonical/1 ikisini
  ayıramaz; ayırmak için ek bir kodlama kendi çakışma yüzeyini açar). Güvenlik özelliği aynı: `-0`
  onayı `0`'ı yetkilendiremez. Test dosyası bu gerekçeyle uyarlandı (dosya başında yazılı).
- İnceleyicinin ortam politikası yerel sunucu başlatmayı engelledi; gerçek HTTP/oturum/CSRF tekrarı
  o turda BLOCKED. Uygulayıcı aynı e2e dosyasını kendi ortamında yeniden çalıştırdı (aşağıdaki not) —
  bu bağımsız doğrulama sayılmaz.
- Uygulayıcı ortamı, 3. tur düzeltmesinden sonra: uygulama `:3156`'da `aer_test`'e karşı, `tests/e2e/review-stage6-http.e2e.ts` **4/4 geçti**.

**4. tur — BLOCKED** (kod bulgusu yok). R7 düzeltmesi doğrulandı, 275/275 web testi geçti; yalnız
inceleyicinin ortam politikası yerel sunucuyu başlatmayı engellediği için gerçek HTTP/oturum/CSRF
kontrolleri çalışmadı.

**5. tur — PASS.** Uygulayıcı aynı kodu (`:3156`, `aer_test`) kendisi başlattı; inceleyici sunucuyu
başlatmadan/durdurmadan yalnız istek gönderdi. Gerçek HTTP / Auth.js oturumu / CSRF testleri **7/7**
geçti (2. tur e2e dosyası + yeni `tests/e2e/review-stage6-round5-http.e2e.ts`); R7 HTTP ile de
doğrulandı. Sapma (inceleyicinin bildirdiği): ilk Vitest koşusunun önbelleği junction üzerinden kopya
dışına yazıldı; uygulama kodu/veri etkilenmedi.
