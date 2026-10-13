# Aşama 1 — Maskeleme düzeltmesi ve veri toplama sözleşmesi

## 1. Ondalık değerlerin yanlış maskelenmesi

**Kök neden.** Kart deseni `\b(?:\d[ -]?){13,19}\b` noktadan sonraki rakam dizisini ayrı bir
"kelime" olarak görüyordu. Ondalık haneler 13–19 uzunlukta ve Luhn-geçerliyse değer
`"0.[REDACTED_CREDIT_CARD]"` oluyordu. Sayı yolu da `String(value)` üzerinden aynı desene
gidiyordu. Aynı sınıf hata `national_id` (11 hane) deseninde de vardı.

**Düzeltme** (`apps/web/lib/redaction/{patterns,redactJson}.ts`):

| Girdi | Eski | Yeni |
| --- | --- | --- |
| Tamsayı olmayan JSON sayısı (`0.0000246913578`, `-0.51…`, `1.23e21`) | Kart sayılabiliyordu | Hiç taranmaz, sayı olarak kalır |
| Metinde rakam-nokta-rakam (`"0.0000246913578"`, `"4111…111.5"`) | Kart | Sayının parçası, maskelenmez |
| Güvenli tamsayı (`4111111111111111`) | Kart | Kart (değişmedi) |
| 2^53 üstü 13–19 haneli tamsayı | Yuvarlanmış rakamlarla Luhn şansına kalıyordu | **Fail-closed**: kart sayılır. JSON.parse rakamları zaten yuvarladığı için kontrol edilemez. Büyük kimlikler metin olarak gönderilmeli. |
| Virgülden sonra kart (`"ayse,4111…,12/29"`) | Kart | Kart (CSV ayırıcısı; korumada bilinçli olarak yok) |
| Metinde virgüllü ondalık (`"0,0000246913578"`) | Kart | **Hâlâ kart** — bilinen yanlış pozitif; virgülü korumak CSV satırlarında atlatma açıyordu |

İlk düzeltme commit'i (`47968fa`) virgülü de koruyordu; arka plan güvenlik incelemesi bunun CSV
satırlarında kart atlatması yarattığını işaret etti ve `7b2338d` ile daraltıldı.

**Kanıt.** `lib/redaction/numbers.test.ts`: deterministik Luhn-geçerli ondalık fixture'lar.
Bu dosya düzeltme öncesi kodda **11 test kırmızı**, sonrasında yeşil (yerelde çalıştırıldı).

Değer tahmin edilmez, yuvarlanmaz, eski kayıt onarılmaz. Mühürlü eski satırlar yeniden
maskelenmez: politika yalnızca yeni yazımlarda uygulanır.

## 2. Politika sürümü

- Sunucu politikası: `REDACTION_POLICY = "aer-redaction/2"`; her yeni `AgentRun` ve `AgentEvent`
  satırına `redactionPolicy` olarak yazılır. `null` = etiketsiz eski satır (v1 davranışı).
- Pakette (schema 1.2) her çalışma/olay için:

```json
"capture": {
  "server_applied": { "layer": "server", "policy": "aer-redaction/2" },
  "client_declared": { "layer": "client", "mode": "allowlist", "policy": "collector-js/0.3.0:allowlist", "status": "applied" }
}
```

`server_applied` AER'in kendi kaydıdır. `client_declared` istemcinin **beyanıdır**; AER
istemcinin göndermeden önce ne yaptığını doğrulayamaz. İkisi de paket `content_hash`
kapsamındadır, **olay zinciri hash'ine dahil değildir** (zincir v1 değişmedi; kapsam genişletmesi Aşama 4).

## 3. Alan kuralları (sunucu)

`password`, `passwd`, `secret`, `apiKey`, `accessKey`, `privateKey`, `*token`, `credentials`,
`authorization`, `cookie`, `sessionId`, `pin`, `otp`, `cvv`… adlı anahtarların değeri, türü ne
olursa olsun bütünüyle `[REDACTED_SECRET]` olur (`secret` bulgusu, `high`). Ad karşılaştırması
küçük harf + alfasayısal olmayanlar atılarak yapılır (`X-Api-Key` = `api_key` = `apiKey`).
Çoğul sayaçlar görünür kalır (`completion_tokens`, `maxTokens`).

Sunucu listesi kodda sabittir (`patterns.ts`). Proje bazlı sunucu yapılandırması bu teslimde yok;
istemci tarafında `secretFields` ile genişletilir.

**Hash politikası.** Desen bulguları önceki gibi `sha256(eşleşen değer)` saklar. Bu düz bir hash'tir:
düşük entropili değerler (kısa e-posta, telefon) tahmin edilerek bulunabilir ve aynı değer kayıtlar
arasında eşleştirilebilir. `secret` bulgularında hash **hiç kaydedilmez** (`originalHash = ""`,
pakette `null`) çünkü şifre/PIN gibi değerlerin düz hash'i sözlükle geri çözülebilir. HMAC
(anahtarlı hash) anahtar yönetimi kararı gerektirdiği için eklenmedi.

**Nesne anahtarları.** Anahtarlar da maskelenir. İki anahtar aynı belirtece dönüşürse
(`{"a@x.io":1,"b@x.io":2}`) ikincisi ezilmez: girdi sırasıyla `#2`, `#3` soneki alır; sonek
zaten varsa bir sonraki boş numara seçilir. `__proto__` anahtarı veri olarak kalır.

## 4. Veri toplama modları (SDK, collector-js 0.3.0)

| Mod | Davranış |
| --- | --- |
| `full` (varsayılan, 0.2 ile aynı) | Gövde olduğu gibi gider; yalnızca sunucu maskelemesi |
| `redacted_content` | Gizli adlı alanlar + desteklenen desenler (JWT/Bearer, `sk-`/`aer_`/`*_live_` anahtarlar, Luhn kart, e-posta) göndermeden önce maskelenir; sunucu ikinci kez kontrol eder |
| `allowlist` | Yalnızca `allow` yolları (`input.question`, `output.sources.*.id`); bilinmeyen alanlar atılır; kalan içerik `redacted_content` gibi maskelenir. `title`/`agentName` listede (`"title"`, `"agentName"`) yoksa olay türü / `"agent"` gönderilir |
| `metadata_only` | `input`/`output` ve özgün `title` hiç gönderilmez (olay türü gider). `agentName` yalnız listede ve tanımlayıcı biçimindeyse (boşluksuz, ≤64). `metadata`: allowlist'teki sayı/boolean; metin yalnız `model`, `provider`, `tool`, `toolName`, `status`, `version`, `environment` anahtarlarında ve tanımlayıcı biçimindeyse |

- Temizleme `structuredClone` kopyası üzerinde çalışır; çağıranın nesnesi değişmez.
- `redact(payload)` hook'u en son uygulanır ve kopya alır.
- **Hata politikası** (`onRedactionError`): varsayılan `drop_content` — adım yine kaydedilir,
  başlık `"<type> (content withheld: client redaction failed)"`, `input`/`output`/`metadata`
  gönderilmez, beyan `status: "failed_closed"`. `throw` seçilirse hiçbir istek gönderilmez ve
  hata mesajı içeriği yansıtmaz.
- `full` ve `redacted_content` modlarında `title` ve `agentName` gönderilir (ikincisinde maskelenir);
  serbest metin içeriyorsa `allowlist` / `metadata_only` kullanılmalı.
- **İnceleme düzeltmesi (9d9a527 sonrası):** önceki sürümde `metadata_only`, allowlist'e eklenen
  herhangi bir anahtardaki ≤200 karakter metni (ör. `metadata.prompt`) gönderiyor; `allowlist` ve
  `metadata_only` serbest metin `title`/`agentName`'i her zaman gönderiyordu. Sabit operasyonel
  anahtar kümesi + tanımlayıcı biçimi bu kapıyı kapatır. Sınır: tanımlayıcı biçimine uyan kısa
  bir değer (`model: "gizli-proje-adi"`) yine gider; anahtar kümesi bilinçli olarak dar tutuldu.
- SDK desen kümesi sunucununkinin alt kümesidir (telefon/kimlik yalnız sunucuda).

## 5. Sınırlar

- Kişi adı, serbest metindeki şifre ("şifrem Kedi123!"), iş sırrı ve bağlama bağlı kişisel veri
  **tespit edilmez**. Bu bir hukuki uyumluluk garantisi değildir.
- `client_declared` doğrulanamaz.
- Sunucu tarafında maskeleme hatası (ör. aşırı derin JSON) isteği `500` ile reddeder; hiçbir şey
  yazılmaz (fail-closed).
- Eski sunucuya 0.3 SDK'sı bağlanırsa `capture` beyanı Zod tarafından sessizce atılır; istemci
  maskelemesi yine uygulanır.

## 6. Testler

| Dosya | Kapsam | Gerçek DB |
| --- | --- | --- |
| `apps/web/lib/redaction/numbers.test.ts` | Ondalık regresyonu, negatif/küçük/büyük/bilimsel, 2^53, metin sınırları, CSV atlatması | Hayır |
| `apps/web/lib/redaction/fieldRules.test.ts` | Gizli alan adları, tür bağımsız maskeleme, hash kaydedilmemesi, anahtar çakışması, `__proto__`, kaynak değişmezliği | Hayır |
| `apps/web/lib/audit/packet.test.ts` | `null` hash'li bulgu ile paketten zincir doğrulama, schema 1.2 | Hayır |
| `apps/web/tests/capture.integration.test.ts` | API → DB → export: politika + beyan, gizli alan, ondalık skor, paket doğrulama, beyan doğrulaması (422), etiketsiz eski satır | **Evet** |
| `packages/collector-js/src/capture.test.ts` | Sahte fetch'e ulaşan gövdede hassas fixture yok; allowlist; metadata_only; hook hatası fail-closed; `throw`; kopya; anahtar çakışması | Hayır |
