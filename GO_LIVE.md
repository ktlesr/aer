# GO_LIVE.md — Demo'dan Tam Fonksiyonel Sisteme

> RUNBOOK.md çalışan demo'yu üretir. Bu dosya onu **gerçekten fonksiyonel** hale getiren
> eksik parçaları ve her adımı **kanıtlatma** disiplinini ekler.
> Önemli: "Tam fonksiyonel" = mevcut hattın gerçekten çalışması. **Kapsam büyütmek DEĞİL**
> (RBAC, SSO, billing hâlâ ertelenmiş). Bir adım bunları gerektiriyormuş gibi gelirse: yanlış yoldasın.

---

## 0. "Tam fonksiyonel" tanımı

### Seviye A — Lokalde gerçek (asıl hedef)
1. PostgreSQL gerçekten çalışıyor (Docker veya hosted), migration'lar uygulanmış.
2. Bir organizasyon + proje + **API key** üretebiliyorsun; key'in açık hali bir kez gösteriliyor.
3. `demo-agent` o key ile **gerçek HTTP** çağrıları yapıyor; backend gerçek bir run + event'ler kaydediyor.
4. Redaction **sunucu tarafında** her event'te çalışıyor; bulgular hash olarak saklanıyor; DB'de/exportta ham PII yok.
5. Dashboard bu gerçek run'ı gösteriyor (refresh ile), varsayılan redacted, raw toggle çalışıyor.
6. JSON audit packet **indirilebilir bir dosya** olarak iniyor, `content_hash` içeriyor; bir test ham PII olmadığını doğruluyor.
7. İstek yolunun hiçbir yerinde mock/stub yok.

### Seviye B — Uzak / gerçek (opsiyonel)
8. Recorder deploy edilmiş (ör. Vercel) + hosted Postgres + env değişkenleri.
9. SDK `baseUrl`'i deploy edilmiş API'yi gösteriyor.
10. Gerçek bir agent (ör. OpenAI tabanlı kendi bot'un) SDK ile enstrümante edilmiş, gerçek run üretiyor.

Seviye A geçerse sistem fonksiyonel sayılır. Seviye B "production'da gerçek kullanım" demek.

---

## 1. RUNBOOK'a eklenecek eksik parçalar (her biri bir Claude Code prompt'u)

Bunları RUNBOOK'un ilgili adımlarının yanına/sonrasına ekle. Her prompt'tan önce **plan iste, onayla**; sonra **çalıştırıp kanıt göster** de.

### G1 — Lokal veritabanı + env
```
Add a local Postgres setup so the app runs for real:
- docker-compose.yml with a postgres service (volume-persisted)
- .env and .env.example with DATABASE_URL, AER_API_BASE_URL
- wire Prisma to DATABASE_URL and run the migration
Show me the exact commands to start the DB and apply migrations, and their real output.
```
✅ Kanıt: `docker compose up -d` + `prisma migrate dev` gerçekten çalışıyor, tablolar oluştu.

### G2 — API key üretimi (gerçek kullanım için şart)
```
Add a way to issue credentials: a script `pnpm key:create` that creates one organization,
one project, and one API key. Store only the key hash; print the PLAINTEXT key to stdout ONCE.
Make it idempotent-ish (reuse org/project if exists, always mint a fresh key).
Show me the command and a sample run that prints a usable aer_... key.
```
✅ Kanıt: komut çalışınca `aer_...` formatında bir key basılıyor; DB'de sadece hash var.

### G3 — Collector SDK gerçek ağ çağrısı yapsın
```
Make packages/collector-js perform REAL HTTP calls (fetch) to AER_API_BASE_URL with the
Bearer API key. Add: request timeout, retry on network/5xx (max 2), typed errors, and
no logging of raw input/output or the key. No mocks. Add a tiny smoke test that hits a running API.
```
✅ Kanıt: SDK çalışan API'ye gerçekten event yolluyor; key/PII loglanmıyor.

### G4 — API yazma yolu: auth + redaction + validation
```
Harden the API write path so it is actually correct:
- every route requires a valid API key; resolve org+project from the key hash; reject cross-tenant
- on POST events, run redactJson on input AND output server-side; persist redacted_* + findings (hash only)
- validate all bodies with zod; reject invalid with the common error format
- idempotency: a duplicate (run_id, step_index) must not create a second event
Show me curl examples proving auth rejection, redaction-on-write, and idempotency.
```
✅ Kanıt: yanlış key reddediliyor; gönderilen e-posta DB'de maskeli; aynı event iki kez yazılmıyor.

### G5 — Dashboard gerçek veriyi okusun
```
Make the dashboard read REAL data from Postgres (server components / server queries, no mock arrays).
/runs lists real runs; /runs/[id] renders the real timeline. Default to redacted view; raw view behind
an explicit toggle. Revalidate or refresh so a newly recorded run appears.
Show me by recording a run, then loading /runs and /runs/[id].
```
✅ Kanıt: demo-agent çalıştıktan sonra run dashboard'da gerçekten beliriyor.

### G6 — JSON export gerçek dosya + güvenlik testi
```
Implement POST /runs/{id}/exports (json) to return a downloadable file:
- include run, redacted events, findings (hash only), export metadata with a sha256 content_hash
- serve via a download endpoint with Content-Disposition
- add a test asserting the packet contains NO raw email/phone/key, and that server logs never print PII or keys
Show me the downloaded file and the passing test.
```
✅ Kanıt: inen JSON'da ham PII yok, `content_hash` var, test geçiyor.

### G7 — Uçtan uca doğrulama scripti
```
Add `pnpm e2e:demo` that: (1) ensures an API key exists, (2) runs the demo agent against the live API,
(3) polls the API until the run is complete, (4) triggers a JSON export, (5) asserts the run has the
expected events + 2 redaction findings + a content hash, and prints PASS/FAIL.
Run it and show me the real output.
```
✅ Kanıt: tek komutla tüm hat çalışıyor ve PASS yazıyor.

---

## 2. Doğrulama disiplini (en kritik kısım)

Claude Code "tamamlandı" demesin — **kanıt göstersin**. Her adımda şunu iste:

1. Çalıştırılacak **tam komut**.
2. **Beklenen çıktı** (ne göreceğim?).
3. Komutun **gerçek çıktısı** (çalıştırıp yapıştırsın).

Bunu sağlamak için:
- `verification-before-completion` skill'ini kullandır: "Run the verification command and show output before claiming done."
- İstek yolunda **mock/stub yasak**: "No mocks or stubbed data in the request path; use the real DB."
- Bir şey patlarsa `systematic-debugging` / `diagnose`: körlemesine yama yok, önce tekrar üret.
- Fonksiyonel demeden önce **Codex güvenlik geçişi**: tenant isolation + export'ta ham PII yok + log temiz.

---

## 3. Deploy (Seviye B — opsiyonel)

Gerçekten uzaktan çalışsın istiyorsan:
```
Prepare deployment without adding enterprise features:
- choose a hosted Postgres (e.g. Neon/Supabase/Railway) and document the DATABASE_URL env
- deploy apps/web to Vercel; set DATABASE_URL and run migrate on deploy
- document setting AER_API_BASE_URL in the SDK to the deployed URL
Give me a step-by-step deploy checklist and the env vars I must set.
```
Not: Hosting sağlayıcıların güncel ücretsiz limitleri/fiyatları değişebilir; deploy ederken sağlayıcının güncel dokümanını kontrol et.

✅ Kanıt: deploy edilmiş URL'e SDK'dan event yollayınca uzak dashboard'da görünüyor.

---

## 4. Gerçek agent'ı bağlama (Seviye B)

Demo-agent yerine kendi gerçek agent'ını kaydetmek için, agent'ının adımlarının yanına SDK çağrıları koy:
```
Create examples/integrate-real-agent.ts showing how to wrap a real OpenAI-based agent:
startRun at the beginning; run.event for each model call and tool call with real input/output;
run.complete at the end. Keep it minimal and copy-pasteable. Do NOT auto-instrument frameworks (defer).
```
✅ Kanıt: örnek dosyayı kendi agent'ına uyarlayınca gerçek run'lar dashboard'a düşüyor.

---

## 5. "Nasıl talimat vereceğim" — kısa kart

- **Sonuç odaklı yaz:** "X'i çalıştırınca dashboard'da Y'yi, inen dosyada Z'yi görmeliyim."
- **Kanıt iste:** "Komutu ve gerçek çıktısını göster" — ekran çıktısı olmadan "bitti" kabul etme.
- **Tek faz, önce plan:** her seferinde bir parça, plan → onay → kod → kanıt → commit.
- **Mock yasağı:** "İstek yolunda mock/stub yok, gerçek DB kullan."
- **Kapsamı koru:** "Auth provider/RBAC/billing ekleme; fonksiyonel = mevcut hattın gerçekten çalışması."
- **Tekrar üretilebilirlik:** ".env.example ve setup adımlarını ver ki sıfırdan kurabileyim."
- **Hata olursa:** "Önce reproduce et (systematic-debugging), sonra düzelt."

---

## 6. Bitti sayılır mı? (Seviye A checklist)
- [ ] `docker compose up -d` + migrate çalışıyor
- [ ] `pnpm key:create` gerçek bir `aer_...` key veriyor
- [ ] `pnpm e2e:demo` PASS yazıyor
- [ ] Dashboard'da gerçek run + timeline görünüyor
- [ ] Redacted view default, raw toggle çalışıyor
- [ ] İnen JSON'da ham PII yok, content hash var
- [ ] Yanlış API key reddediliyor (tenant isolation)
- [ ] Codex güvenlik geçişi temiz

Hepsi işaretliyse: sistemin gerçekten fonksiyonel. Seviye B'ye (deploy + gerçek agent) ancak bundan sonra geç.
