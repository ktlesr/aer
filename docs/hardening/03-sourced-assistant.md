# Aşama 3 — Kaynaklı asistan profili

Branch `feat/stage-3-sourced-assistant`, taban `13d6240` (Aşama 0–2, bağımsız inceleme PASS).

## 1. Ne eklendi

| Alan grubu (talimat §7.1) | Nerede | Kural |
| --- | --- | --- |
| Bağlantı | `AgentRun.conversationRef`, `turnRef`, `parentRunId` | Tanımlayıcı biçimi (`A-Z a-z 0-9 . _ : -`, ≤200). `parentRunId` FK **değil**; okuma anında tenant içinde çözülür |
| Kullanılan bağlam | `sourced.context.used[]` | `{key, value, origin, fromTurnRef?}`; `origin` ∈ `user_stated`, `previous_turn`, `retrieved`, `inferred`, `system`. `context.missing[]` = bilinip elde olmayan bağlam |
| Kaynak | `sourced.retrievedSources[]`, `sourced.citedSources[]` | `{id, version?, title?, contentHash?, hashScope?, archiveRef?, score?, scoreMethod?}` |
| Üretim | `sourced.generation` | `provider`, `model`, `promptTemplateVersion`, `appVersion`, `providerRequestId`; gönderilmeyen her biri `not_recorded` |
| Süre | `sourced.timing` + olayın `occurredAt` | İstemci saati (`clientStartedAt/EndedAt`) ile AER kabul zamanı (`occurredAt`, sunucu damgası) ayrı |
| Dayanak | `sourced.claimSourceLinks[]` + `assessment` | `{claim, sourceIds, basis}`; `basis` = `model_declared` veya `assessed` |

Bütün yeni alanlar opsiyoneldir. `sourced` olayda sürümlü bir bloktur
(`profile: "sourced_assistant"`, `version: 1`) ve **strict** doğrulanır: bilinmeyen alan `422`.

## 2. Kurallar ve gerekçeleri

- **Getirilen ≠ kullanılan.** `retrievedSources` adaylardır; `citedSources` cevabın dayanak olarak
  gösterdikleridir. İki liste hiçbir yerde birleştirilmez. Dashboard'da adaylar "Retrieved
  candidates — not evidence that the answer relied on them" etiketiyle ayrı gösterilir.
- **Puan olasılık değildir.** `score` ancak `scoreMethod` ile kabul edilir; farklı yöntemlerin
  puanları sıralanmaz/karşılaştırılmaz, yalnızca yöntemiyle birlikte gösterilir.
- **Dayanak bağı kimin beyanı?** `claimSourceLinks[].sourceIds` `citedSources` içinde olmalı.
  `basis: "assessed"` için `assessment {method, version, result}` zorunlu; aksi `422`.
  `model_declared` bağlar "declared by the model/app, not independently checked" diye gösterilir.
- **Hash kapsamı ve algoritması belli.** `contentHash` yalnızca `sha256:<64 hex>` biçiminde ve
  `hashScope` (hangi baytlar: ör. `chunk_text_utf8`) ile kabul edilir. Hash içeriği geri getirmez;
  `archiveRef` yoksa yalnızca kimlik/hash kaydedildiği görünür ("no archive ref").
- **Hassas URI yok.** `archiveRef` opak bir işaretçidir: sorgu dizgesi (`?`, `=`, `&`), kimlik
  bilgisi (`@`), boşluk reddedilir. Kaynağın **diğer bütün metin alanları** (`id`, `version`,
  `title`, `hashScope`, `scoreMethod`) ve `claimSourceLinks[].sourceIds` de sorgu parametresi
  (`?x=` / `&x=`, şemasız olsa bile) veya kimlik bilgili URI (`scheme://user:pass@`) taşıyamaz:
  `422`, hiçbir şey yazılmaz, değer yankılanmaz. Fragment/matrix parametresi (`#access_token=`,
  `;jsessionid=`) ve yüzde kodlu ayraçlar (`%3F`, `%23`, `%26`, `%3B`, `%3D`, `%40`) da reddedilir.
  Sorgusuz düz URL, `#madde-9` gibi parametresiz fragment ve dosya adları kabul edilir.
  Kontrol doğrusal zamanlıdır ve uzunluk sınırından sonra çalışır (Zod, `max()` başarısız olsa da
  `refine` çalıştırır; ilk sürüm 1 MB'lık bir id ile dakikalarca CPU harcayabiliyordu).
  Sınır: `context.used[].value` ve `claim` serbest metindir; bu kural onlara uygulanmaz.
- **Çıkarım doğrulanmış gibi gösterilmez.** `origin: "inferred"` "inferred — not confirmed" olarak
  gösterilir.
- **Uydurma yok.** Gönderilmeyen üretim alanları ve bölümler pakette `not_recorded` listesinde,
  dashboard'da "not recorded" olarak görünür. Sunucu hiçbir değeri tahmin etmez.
- **Gerekçe kapsamı (§7.3).** Model düşünce zinciri istenmez ve kabul edilmez (strict şema;
  örn. `reasoning` alanı `422`). Kayıt; kaynakları, bağlamı ve kullanıcıya sunulan cevabı tutar.
- **Maskeleme.** `sourced` ve bağlantı alanları diğer alanlar gibi sunucuda maskelenir
  (`aer-redaction/2`); bağlamdaki e-posta `[REDACTED_EMAIL]` olur, ondalık puan korunur.
  Bulgular olayın bulgularına eklenir (`sourced.context.used[4].value`).
- **Ad/değer çiftleri.** Bağlam alanının adı veridir (`{key: "password", value}`). `key` veya
  `name` gizli alan kuralına uyan bir nesnenin `value`'su bütünüyle `[REDACTED_SECRET]` olur ve
  hash'i kaydedilmez (sunucu ve SDK, her yerde — ör. başlık listeleri `{name: "Authorization"}`).

## 3. Eksik bağlam (`missing_context`)

`parentRunId` saklanır ama doğrulanmaz. Okuma anında (dashboard, JSON/PDF export) **aynı
org+proje içinde** aranır:

- bulunursa `{status: "linked"}` ve önceki adıma bağlantı;
- bulunamazsa `{status: "missing_context"}`: hiç kaydedilmemiş, saklama süresiyle silinmiş veya
  başka tenant'a ait — bu üçü bilerek ayırt edilmez, böylece API başka tenant'ta bir run'ın var
  olup olmadığını sızdırmaz. Test: aynı çıktıyı hem uydurma id hem gerçek yabancı run id verir.

Çözümleme export anında yapılır; paket, o anki durumu taşır.

## 4. Bütünlük kapsamı

**Zincir hash'i değişmedi.** `sourced` ve bağlantı alanları olay zincirinin dışında; paketin
`content_hash`'i kapsar (Aşama 1'deki `capture` ile aynı durum). Sonuç:

- Eski sürüm referansı **depolamada korunur** (append-only olay; güncelleme yolu yok). Test:
  sonraki bir tur aynı kaynağın `v2`'sini gösterdikten sonra önceki turun paketi `v1` + `H1`
  göstermeye devam eder.
- Ama bu alanlar zincir doğrulamasıyla **korunmaz**: veritabanını değiştirebilen biri `sourced`'ı
  zinciri bozmadan değiştirebilir. Önemli alanların zincir kapsamına alınması (yeni hash sürümü,
  eski mühürlerin eski algoritmayla doğrulanması) Aşama 4'tür.
- Maskeleme bulguları zincirin içindedir (mevcut davranış), değerlerin kendisi değil.

## 5. SDK (collector-js 0.4.0) ve uyumluluk

- `startRun({ conversationRef, turnRef, parentRunId })`, `run.event({ sourced })`; tipler
  `SourcedEvidence`, `SourceRef`.
- **Sessiz düşürme yok:** eski sunucu bilinmeyen alanları atar (Zod non-strict). SDK bunu
  `run.lineageStored === false` ve `EventResult.sourcedStored === false` ile bildirir; sunucu
  `serializeRun` içinde bağlantıları, `serializeEvent` içinde `sourcedStored` onayını döndürür
  (içeriği değil — yanıtlar idempotency defterinde saklanır).
- Capture modları: `allowlist` yalnız listelenen `sourced.*` yollarını gönderir (profil etiketi
  korunur); `metadata_only` `sourced` göndermez; `conversationRef`/`turnRef` kısıtlı modlarda
  yalnız listelenirse gider; `parentRunId` (AER'in kendi id'si) başarılı maskelemeden sonra gider.
  Maskeleme hatasında (`failed_closed`) yalnızca içerik taşımayan alanlar gönderilir: `type`,
  `seq`, `riskLevel`, `costMicroUsd`, `status` ve genel `title`/`agentName` — `parentRunId` dahil
  diğer her alan düşer. Bu bir izin listesidir; ileride eklenecek alanlar varsayılan olarak düşer.

| İstemci → Sunucu | ≤ 13d6240 (bu teslim öncesi) | Bu teslim |
| --- | --- | --- |
| collector-js ≤ 0.3 / ham API (yeni alan yok) | Değişmedi | Değişmedi; paket `links` boş, `sourced: null` |
| collector-js 0.4 | Yeni alanlar atılır; SDK `lineageStored/sourcedStored = false` döner | Saklanır, onaylanır |
| Ham API + `sourced` | Sessizce atılır (eski sunucu, değiştirilemez) | Strict doğrulama; yanıtta `sourcedStored: true` |
| Paket 1.1/1.2 | — | Aynen doğrulanır (zincir algoritması aynı) |
| Paket 1.3 | — | `run.links`, `events[].sourced` eklendi |

Idempotency ve aynı-`seq` tekrarı `sourced`'ı da içerir: aynı anahtar/aynı `seq` ile farklı
`sourced` → `409`.

## 6. Migration ve geri dönüş

`20261013180000_sourced_assistant_profile`: üç nullable `TEXT` (`AgentRun`) + bir nullable
`JSONB` (`AgentEvent`). Yalnız ekleme; mevcut satırlara dokunmaz. Geri dönüş: kodu geri al,
sütunlar düşürülebilir (yalnız bu alanların verisi kaybolur). Üretim migration'ı bu teslimde
çalıştırılmadı.

**Upgrade testi (yerelde çalıştırıldı):** `13d6240` koduyla boş `aer_upgrade3` veritabanına 9
migration + seed (mühürlü `run_demo`, 9 olay); ardından bu teslimin migration'ı ve yeni kodla:
eski run DB ve paket yolundan `verified`, `links` boş, tüm olaylarda `sourced: null`; yeni bir tur
`parentRunId: run_demo` ile oluşturuldu ve `linked` çözüldü. Geçici veritabanı ve worktree silindi.

## 7. Testler

| Dosya | Kapsam | Gerçek DB |
| --- | --- | --- |
| `apps/web/tests/sourced.integration.test.ts` | Sentetik devam sorusu (önceki tur bağlantısı, `previous_turn`/`inferred` kökeni, eksik bağlam, aday/kullanılan ayrımı, `not_recorded`), kaynak güncellemesi sonrası eski sürüm, `missing_context` (uydurma + yabancı tenant), eski run, 8 reddedilmesi gereken girdi (422, yankısız), lineage biçimi, `seq`/idempotency tekrarı, SDK uçtan uca | **Evet** |
| `apps/web/components/sourced-evidence.test.tsx` | Dashboard etiketleri: çıkarım, aday/dayanak ayrımı, "not recorded", `missing_context` link değil | Hayır |
| `packages/collector-js/src/sourced.test.ts` | Onay bayrakları (yeni/eski sunucu), `metadata_only`, `allowlist`, fail-closed | Hayır |

## 8. Bağımsız inceleme düzeltmeleri (e8ea465 sonrası)

| Bulgu | Kök neden | Düzeltme | Regresyon |
| --- | --- | --- | --- |
| P1 hata yolunda ham `parentRunId` | `failed_closed` ham gövdeyi yayıp bilinen içerik alanlarını siliyordu (kara liste) | İçeriksiz alan izin listesi | `sourced.test.ts` |
| P1 `key: "password"` bağlam değeri açık | Alan kuralı yalnızca JSON anahtarına bakıyordu; çiftte ad veri olarak duruyor | Ad/değer çifti kuralı (sunucu + SDK) | `fieldRules.test.ts`, `sourced.integration.test.ts`, `sourced.test.ts` |
| P1 imzalı URL `id` alanında | Kural yalnız `archiveRef`'teydi | Tüm kaynak metin alanlarına erişim-URI reddi | `sourced.integration.test.ts` (6 varyant + kabul edilen düz URL) |

İnceleyicinin dört repro testi değiştirilmeden yeni kodda çalıştırıldı: 4/4 geçti.

## 9. Sınırlar

- AER uygulamanın bildirdiğini kaydeder: kaynağın doğru, güncel veya hukuken uygulanabilir olduğunu,
  bağlamın gerçekten kullanıldığını ya da dayanak bağının doğru olduğunu doğrulamaz
  (`assessed` bile yalnızca uygulamanın bildirdiği ayrı bir kontrolün sonucudur).
- `sourced` ve bağlantılar zincir hash'i dışında (Aşama 4).
- PDF export'u yeni alanları henüz göstermiyor; JSON paket ve dashboard gösteriyor.
- Bir konuşmanın bütün turlarını listeleyen görünüm yok; yalnız önceki adıma bağlantı var.
- `context.used[].value` serbest metin olabilir (≤500); maskeleme yalnızca tanınan desenleri
  yakalar. Hassas bağlam için SDK `allowlist`/`metadata_only` kullanılmalı.
- İstemci saati doğrulanamaz; saat sapması yalnızca `occurredAt` ile yan yana gösterilir.
