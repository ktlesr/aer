# Aşama 0 — Güncel durum, temel doğrulama ve karar kaydı

Kaynak talimat: `AER_Claude_Codex_Gelistirme_Talimati.md` (11 Ekim 2026).
Bu belge Aşama 0 çıktısıdır; Aşama 1 ve 2 kararlarını da kaydeder.

## 1. Başlangıç durumu (2026-10-12)

| Öğe | Değer |
| --- | --- |
| Başlangıç branch / commit | `main` @ `9a3b5ed` (= talimattaki referans commit; arada değişiklik yok) |
| Çalışma branch'i | `feat/stage-1-2-capture-integrity` |
| Çalışma ağacı | Temiz; tek izlenmeyen dosya talimat belgesinin kendisi (commit edilmedi) |
| Node / pnpm | v22.20.0 / 10.19.0 |
| Next / Prisma / Vitest | 16.2.9 / 7.8.0 / 4.1.8 |
| PostgreSQL | `postgres:16` (docker compose, host port 5440) |
| Test veritabanı | Ayrı `aer_test` veritabanı — geliştirme verisi (`aer`) testlerde kullanılmadı |

Test komutu (gerçek PostgreSQL):

```sh
DATABASE_URL="postgresql://aer:aerpass@localhost:5440/aer_test?schema=public" \
  pnpm --filter web exec prisma migrate deploy
DATABASE_URL="postgresql://aer:aerpass@localhost:5440/aer_test?schema=public" \
  pnpm --filter web test
```

## 2. Akış: SDK → API → maskeleme → DB → zincir → export → doğrulayıcı

1. **SDK** (`packages/collector-js/src/index.ts`): `startRun` → `POST /api/v1/runs`,
   `event` → `POST /runs/:id/events`, `complete` → `POST /runs/:id/complete`.
   Ağ hatası/5xx'te en fazla 2 retry; tekrar önleme yalnızca istemcinin açık `seq` vermesine bağlı.
2. **API kimliği** (`lib/api/auth.ts`): Bearer key → `sha256` → `ApiKey.keyHash`; org/proje key'den çözülür.
3. **Maskeleme** (`lib/redaction/*`, `lib/api/helpers.ts#redactFields`): kalıcı her alan
   (agentName, title, input, output, metadata, environment, sdk) regex desenlerinden geçer;
   bulgu yalnızca `sha256(eşleşen değer)` saklar.
4. **DB** (`prisma/schema.prisma`): `AgentRun`, `AgentEvent` (`@@unique([runId, seq])`),
   `RedactionFinding`, `AuditExport`; tenant üçlüsü FK ile tutarlı.
5. **Zincir** (`packages/evidence-chain`): `hash = sha256(prevHash + "\n" + canonical(core))`,
   genesis `sha256("AER-CHAIN-v1:"+runId)`; `complete` başı `seal` olarak dondurur.
6. **Export** (`lib/audit/packet.ts`): schema 1.1 paket; olay hash'leri, bulgular, genesis, seal,
   paket `content_hash`.
7. **Doğrulayıcı**: tek paylaşılan `verifyChain`; `pnpm verify:run <id>` (DB), dashboard rozeti,
   `packetToChainLinks` (paket). Bağımsız CLI yok (Aşama 4).

## 3. Mevcut testler

| Komut | Kapsam | Gerçek DB? |
| --- | --- | --- |
| `pnpm --filter web test` | `lib/**/*.test.ts` (unit) + `tests/*.integration.test.ts` | Integration dosyaları **evet** (`DATABASE_URL`) |
| `pnpm --filter @ktlsr/evidence-chain test` | canonicalize/hash/chain/verify | Hayır |
| `pnpm --filter @ktlsr/collector-js test` | node:test, sahte fetch | Hayır |
| `pnpm --filter web exec tsc --noEmit` | typecheck | — |
| `pnpm --filter web lint` | eslint | — |

Başlangıçta gerçekten çalıştırılan kontroller ve sonuçları:

| Kontrol | Sonuç |
| --- | --- |
| web vitest (aer_test) | 15 dosya, **105/105 geçti** |
| evidence-chain vitest | **21/21 geçti** |
| collector-js node:test | **3/3 geçti**; `tsc --noEmit` temiz |
| web `tsc --noEmit` | temiz |
| web `lint` | **1 hata — önceden var**: `components/local-time.tsx:25` `react-hooks/set-state-in-effect`. Bu teslimin konusu değil; dokunulmadı. |

## 4. Ön bulguların sınıflandırması

Kanıt sütunu: **Kod** = kod incelemesi, **Çalıştırma** = depo koduyla gerçekten çalıştırılmış repro.

| # | Bulgu | Durum | Kanıt |
| --- | --- | --- | --- |
| 1 | Olay değiştirilince zincir doğrulaması bozuluyor | CONFIRMED (beklenen davranış) | Çalıştırma: `computeChain` → 1. olayın `title`'ı değişti → `verifyChain` = `broken`. Mevcut `chain.test.ts` / `chain.integration.test.ts` bunu zaten resmi test ediyor. |
| 2 | Olaylar + mühür birlikte yeniden hesaplanınca doğrulama geçiyor | CONFIRMED (tasarım sınırı) | Çalıştırma: değiştirilmiş olaylarla `computeChain` + yeni seal → `verified`. Dış mühür olmadan operatör yeniden yazımına karşı koruma yok. Aşama 4'e devredildi; ürün metni Aşama 1'de düzeltildi. |
| 3 | Maskeleme e-postayı yakalıyor; şifre, kişi adı, ticari sır yakalanmıyor | CONFIRMED | Çalıştırma: `{password:"hunter2", note:"şifrem Kedi123!", name:"Ahmet Yılmaz", sir:"…confidential"}` → 0 bulgu; e-posta → 1 bulgu. |
| 4 | Ondalık puan `0.[REDACTED_CREDIT_CARD]` oluyor | CONFIRMED | Çalıştırma: `0.0000246913578`, `0.0004320987615`, `0.0005185185138` (ondalık hanesi Luhn-geçerli 13 hane) hem **sayı** hem **metin** olarak `"0.[REDACTED_CREDIT_CARD]"` oldu. `0.48000000000000004` ve `0.5143552127546813` ise Luhn'dan geçmediği için **etkilenmiyor** — hata, ondalık hanelerin Luhn'u tutturmasına bağlı. Aynı sınıf `national_id` (11 hane, `\b[1-9]\d{10}\b`) için de kodda görüldü. |
| 5 | seq ve tamamlanma kontrolü yazmadan önce, kilitsiz | CONFIRMED (kod) → Aşama 2'de çalıştırmayla | Kod: `events/route.ts` durum kontrolü ve `seq = eventCount+1` transaction dışında; `complete/route.ts` sayım/seal transaction'sız. Paralel olaylarda `(runId, seq)` çakışması → P2002 → 422 bekleniyor; Aşama 2 testleri eski kodda çalıştırılarak doğrulandı (bkz. `02-ordering-idempotency.md`). |
| 6 | SDK retry; tekrar önleme açık `seq`'e bağlı | CONFIRMED (kod) | Kod: `ApiClient.request` aynı gövdeyi tekrar yollar, idempotency kimliği yok; `seq` yoksa yanıt kaybında ikinci olay oluşur. Ayrıca aynı `seq` + farklı içerik eski olayı **başarı** diye döndürüyor (yeni içerik kayboluyor). |
| 7 | `human_approval_granted` SDK tarafından bildirilebiliyor | CONFIRMED (kod) | `eventTypeSchema` bu türü kabul ediyor. **Aşama 6 kapsamı** — bu teslimde değiştirilmedi. |
| 8 | Paylaşılan JSON'da olay hash'leri ve mühür yok | NOT_REPRODUCED (tam export için) | Kod: `buildAuditPacket` schema 1.1 her olayda `hash`/`prevHash`, ayrıca `chain.genesis`, `seal`, `content_hash` içeriyor (`packet.test.ts`). Paylaşılan çıktı büyük olasılıkla dashboard/ham görünüm kopyası; ayrım Aşama 4'te etiketlenecek. |

## 5. Aşamalı uygulama planı (bu teslim)

**Aşama 1 — Maskeleme**
1. `fix(redaction)`: ondalık/sayı bağlamındaki rakam dizileri kart/kimlik sayılmaz; sayı yolunda
   tamsayı olmayan değerler taranmaz; güvenli olmayan büyük tamsayılar (17–19 hane) kart sayılır (fail-closed).
2. `feat(redaction)`: alan adı tabanlı gizli alan kuralları (`password`, `secret`, `token`…), nesne
   anahtarı çakışmasında deterministik sonek, politika sürümü `aer-redaction/2`.
3. `feat(api,db)`: sunucu politika sürümü + istemci beyanı (`capture`) olay/çalışma satırına ve pakete.
4. `feat(collector-js)`: `metadata_only` / `allowlist` / `redacted_content` modları, `redact` hook'u,
   hata yolunda içeriği atan (fail-closed) davranış.
5. `docs`: gizlilik sözleşmesi ve ürün metni düzeltmeleri.

**Aşama 2 — Sıralama ve tekrar gönderim**
6. `fix(api)`: olay ekleme ve tamamlama aynı `AgentRun` satır kilidi (`SELECT … FOR UPDATE`) altında.
7. `feat(api,db)`: `Idempotency-Key` başlığı; `IdempotencyRecord` tablosu, tenant kapsamlı unique.
8. `feat(collector-js)`: mantıksal işlem başına sabit anahtar, gövde okumayı kapsayan timeout.
9. `test`: gerçek PostgreSQL yarış testleri (bariyer = test tarafından tutulan satır kilidi).

## 6. Karar kaydı — şema/API değişiklikleri

| Değişiklik | Uyumluluk | Migration | Geri alma | Test |
| --- | --- | --- | --- | --- |
| `FindingType` enum'a `secret` | Eski satırlar etkilenmez; eski okuyucular yeni değeri string olarak görür | `ALTER TYPE … ADD VALUE` | PostgreSQL enum değeri **geri silinemez**; geri dönüşte değer kullanılmadan kalır (zararsız). "Rollback destekleniyor" denmez. | unit + integration |
| `AgentRun.redactionPolicy`, `AgentEvent.redactionPolicy` (nullable) | Eski satır `null` = politika kaydedilmemiş (pre-v2) | `ADD COLUMN` | `DROP COLUMN` mümkün; veri kaybı yalnız bu sütun | integration |
| `AgentRun.captureDeclared`, `AgentEvent.captureDeclared` (Json, nullable) | Eski SDK göndermez → `null` | `ADD COLUMN` | `DROP COLUMN` | integration |
| `IdempotencyRecord` tablosu | Başlık yoksa davranış eskisi gibi | `CREATE TABLE` | `DROP TABLE` (yalnız tekrar-önleme geçmişi kaybolur) | PG yarış testleri |
| `Idempotency-Key` başlığı (opsiyonel) | Eski istemciler etkilenmez | — | — | integration |
| Aynı `seq` + farklı içerik → `409` (eskiden eski olay `200` dönüyordu) | **Davranış değişikliği**: içeriği sessizce kaybetmek yerine hata. Aynı içerikle retry hâlâ `200 idempotent:true`. | — | Kod geri alma | integration |
| Açık `seq` mevcut en büyük seq'ten küçükse `409` | Zinciri bozan geriye ekleme artık reddediliyor (eskiden kabul edilip zinciri kırıyordu) | — | Kod geri alma | integration |
| Tamamlanmış çalışmaya tekrar `complete` | Aynı durum → `200`, değişiklik yok; farklı durum/`endedAt` → `409` | — | Kod geri alma | PG testi |
| Paket `schema_version` `1.1` → `1.2` (`capture` alanları eklendi) | Zincir hash kapsamı **değişmedi**; 1.1 paketleri aynen doğrulanır | — | — | unit |

Zincir/kanonikleştirme algoritmasına dokunulmadı; yeni alanlar zincir hash'ine **dahil değil**
(paket `content_hash` kapsamında). Bütünlük kapsamının genişletilmesi Aşama 4'e bırakıldı.

Üretim migration'ı bu teslimde çalıştırılmadı; yalnızca yerel `aer_test` veritabanına uygulandı.
