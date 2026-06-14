# RUNBOOK.md — Agent Evidence Recorder'ı Claude Code ile Sıfırdan Başlat

> Her şeyi **Claude Code** ile yürüteceksin. Aşağıdaki adımları sırayla yap.
> Her fazda: prompt'u Claude Code'a yapıştır → **planı oku ve onayla** → kodu üret → kontrol et → commit at.
> Codex ve Gemini yalnızca belirtilen review noktalarında devreye girer.

---

## Skill Kullanımı — Başlangıç Sırası

Skill'lerin çoğu **model-invoked**: elle çağırmana gerek yok, Claude Code prompt'a göre kendisi yükler.
Sadece şu üçünü bilinçli yönet:

1. **Oturum açılışında** `using-superpowers` otomatik tetiklenir (skill disiplinini kurar). Bırak çalışsın.
2. **Bir kez, başta (opsiyonel):** `setup-matt-pocock-skills` çalıştır — `to-issues`/`to-prd`/`triage`/`tdd`/`diagnose` gibi mühendislik skill'lerinin ihtiyaç duyduğu issue-tracker + domain-doc düzenini kurar. (AGENTS.md/CLAUDE.md'ye kendi "Agent skills" bloğunu ekler; bizimkiyle çakışmaz, tamamlar.)
3. **Dashboard adımında** UI skill'lerini gerekirse açıkça `/frontend-design`, `/shadcn`, `/ui-ux-pro-max` ile tetikle.

### Adım → Skill Cheat-Sheet
| Adım | Devreye girecek skill(ler) |
|------|----------------------------|
| 1 (kickoff) | `using-superpowers`, `brainstorming`, `writing-plans` |
| 2 (docs) | `to-prd` → `writing-plans`; opsiyonel `ubiquitous-language`, `grill-with-docs` |
| 2b (issue'a dökme) | `to-issues`, `triage` |
| 3 (scaffold) | `using-git-worktrees`, `setup-pre-commit`, `git-guardrails-claude-code`, `shadcn` (init) |
| 4–5 (Prisma+seed) | (özel skill yok) `writing-plans` + `verification-before-completion` |
| 6 (redaction) | `test-driven-development` / `tdd` |
| 7 (API) | `test-driven-development`, `vercel-react-best-practices` |
| 8 (SDK+demo) | `subagent-driven-development` / `executing-plans` |
| 9 (dashboard) | `frontend-design`, `shadcn`, `ui-ux-pro-max`, `vercel-react-best-practices` |
| 10 (export) | `test-driven-development`, `verification-before-completion` |
| Codex review (4b,6,7,10) | `review`, `requesting-code-review`, `verification-before-completion` |
| Bug çıkarsa | `systematic-debugging`, `diagnose` |
| Ajan devri | `handoff` (Claude Code → Codex/Gemini) |
| Branch bitişi | `finishing-a-development-branch` |

> Not: Prisma/DB ve redaction/PII için **özel skill yok**; bu adımlarda CLAUDE.md kuralları + test-first disiplini esas. Firecrawl ve diğer ilgisiz skill'leri bu projede tetikleme.

---

## ADIM 0 — Hazırlık (terminalde, bir kez)

1. Gerekli araçlar kurulu mu kontrol et (sürüm gereksinimleri için resmi dokümana bak):
   - Node.js (LTS), pnpm, PostgreSQL, git.
   - Claude Code kurulu değilse: `npm install -g @anthropic-ai/claude-code` (Antigravity içinde zaten varsa atla).
2. Proje klasörünü oluştur ve içine gir:
   ```bash
   mkdir agent-evidence-recorder && cd agent-evidence-recorder
   git init
   ```
3. Hazırladığım üç dosyayı **kök dizine** koy: `CLAUDE.md`, `AGENTS.md`, `RUNBOOK.md`.
   (Claude Code, `CLAUDE.md`'yi her oturumda otomatik bağlama yükler.)
4. Antigravity IDE'de bu klasörü aç, entegre terminalde `claude` yazıp Claude Code'u başlat.

> İpucu: İstersen `/init` çalıştırıp Claude Code'un mevcut CLAUDE.md'yi okumasını sağla; ama benim verdiğim CLAUDE.md zaten hazır, üzerine yazdırma.

---

## ADIM 1 — Oturumu başlat (Claude Code'a ilk mesaj)

```
Read CLAUDE.md and AGENTS.md fully. You are the lead developer for this MVP.
Do NOT write any code yet. Confirm in 5 bullet points:
1) what the product is and is NOT,
2) the in-scope vs out-of-scope list,
3) the non-negotiable security rules,
4) the 7 data models we need,
5) the build order you will follow.
Then wait for my "go".
```

✅ Kontrol: Özet kapsamı doğru anlatıyor mu, MVP dışı şeyleri "out of scope" sayıyor mu? Yanlışsa düzelt, sonra `go` yaz.

---

## ADIM 2 — Dokümanlar (`docs/*.md`)

```
Create branch feature/initial-docs.
Create these docs based on CLAUDE.md and AGENTS.md, concise and consistent:
- docs/PRODUCT.md (product, target user, problem, value prop, differentiation, demo scenario, out-of-scope)
- docs/MVP_SPEC.md (goal, user flow, dashboard screens, API flow, collector flow, export flow, out-of-scope, acceptance criteria)
- docs/DATA_MODEL.md (the 7 tables, fields, enums, relations, JSON field shapes)
- docs/API_CONTRACT.md (auth, error format, endpoints with request/response examples, idempotency notes)
- docs/SECURITY.md (sensitive data types, redaction rules, API key storage, tenant isolation, export & log security)
First give me a 1-paragraph plan, then write the files. Do not start app scaffolding yet.
```

✅ Kontrol: 5 doküman oluştu mu, veri modeli 7 tabloyu içeriyor mu, güvenlik kuralları CLAUDE.md ile birebir mi?
Sonra commit: `git add -A && git commit -m "docs: initial product and spec docs"`

---

## ADIM 3 — Monorepo + Next.js iskelet

```
Create branch feature/scaffold.
Set up a pnpm-workspaces monorepo:
- apps/web : Next.js (App Router) + TypeScript strict + Tailwind + shadcn/ui + Prisma
- packages/collector-js : empty TS package skeleton
- packages/demo-agent : empty TS package skeleton
- root: package.json, pnpm-workspace.yaml, .gitignore, README.md
Configure scripts: dev, build, lint, prisma migrate, db seed.
Give a short plan and the exact dependency list with reasons BEFORE installing. No enterprise tooling.
```

✅ Kontrol: `pnpm install` çalışıyor mu, `pnpm --filter web dev` boş Next.js sayfasını açıyor mu?
Commit: `git commit -am "scaffold: monorepo + next.js + tailwind + prisma"`

---

## ADIM 4 — Prisma schema (7 model)

```
Create branch feature/prisma-schema.
Implement prisma/schema.prisma with models: Organization, Project, ApiKey, AgentRun,
AgentEvent, RedactionFinding, AuditExport — exactly per docs/DATA_MODEL.md.
Every tenant-scoped table must include organizationId + projectId.
Use enums for status, risk_level, event_type, finding_type, severity, export_type.
ApiKey stores keyHash only (never plaintext). RedactionFinding stores originalHash only.
Plan first, then write schema, then run a dev migration.
```

✅ Kontrol: `prisma migrate dev` hatasız mı, tüm enum'lar ve `*_id` alanları var mı?
**→ Bu noktada Codex review'u öneririm (ADIM 4b).**

### ADIM 4b — Codex'e Prisma güvenlik review'u (opsiyonel ama önerilir)
Codex'e ver:
```
Act as the security reviewer. Review prisma/schema.prisma against docs/SECURITY.md.
Check: tenant isolation fields present everywhere, ApiKey never stores plaintext,
RedactionFinding never stores raw sensitive values, sane indexes.
Return: 1) Security risks 2) Missing constraints 3) Small patches only 4) Defer after MVP.
```
Çıkan küçük yamaları Claude Code'a geri ver, uygulat. Commit.

---

## ADIM 5 — Seed data (1 demo run)

```
Create seed data for ONE demo run: "Customer Data Deletion Agent" with:
1 run, 9 events (run_started, user_input, model_call, tool_call x2, redaction_applied,
human_approval_requested, final_output, run_completed), 2 redaction findings (email + phone),
1 audit_export placeholder. Use one org + one project + one API key (store hash only).
Make `prisma db seed` idempotent. Plan first, then implement.
```

✅ Kontrol: `pnpm --filter web prisma db seed` veriyi yüklüyor mu?
Commit: `git commit -am "seed: customer data deletion demo run"`

---

## ADIM 6 — Redaction layer

```
Create branch feature/api-and-redaction.
Implement apps/web/lib/redaction/redactJson(input) using regex/pattern detection for:
email, phone, api_key, bearer_token, credit-card-like, national-id-like numbers.
Return both the redacted object and a list of findings ({finding_type, severity, field_path, original_hash}).
Never include raw sensitive values in findings — hash only. Add unit tests for each pattern.
Plan first, then implement.
```

✅ Kontrol: örnek `{email, phone}` girince `[REDACTED_EMAIL]` / `[REDACTED_PHONE]` dönüyor mu, findings'te ham değer YOK mu?
**→ Codex review zorunlu (redaction'a dokunduk).**

---

## ADIM 7 — API endpoint'leri

```
Implement API routes under apps/web/app/api/v1, per docs/API_CONTRACT.md:
- POST /runs (create run)
- POST /runs/{run_id}/events (add event; run redactJson on input/output, store findings, return findings count)
- POST /runs/{run_id}/complete
- POST /runs/{run_id}/exports (json for now)
Auth: Bearer API key -> resolve org+project from key hash. Reject cross-tenant access.
Common error format { error: { code, message, request_id } }. Validate all inputs.
Plan first, then implement.
```

✅ Kontrol: `curl` ile run oluştur → event ekle → complete et → export al; başka org'un run'ına erişim reddediliyor mu?
**→ Codex review zorunlu (tenant isolation + API key).**
Commit: `git commit -am "feat(api): runs/events/complete/exports + redaction"`

---

## ADIM 8 — Collector SDK + demo agent

```
Create branch feature/collector-and-demo.
1) packages/collector-js: AgentEvidenceRecorder with startRun(), run.event(), run.complete().
   It calls the v1 API with the Bearer API key. Typed inputs. Small, dependency-light.
2) packages/demo-agent: a script that runs the Customer Data Deletion scenario end-to-end:
   start run -> user_input -> tool_call(search_customer) -> tool_call(check_data_policy)
   -> redaction triggers -> human_approval_requested -> final_output -> complete.
Plan first, then implement.
```

✅ Kontrol: `pnpm --filter demo-agent start` çalışınca backend'de gerçek bir run + event'ler + redaction oluşuyor mu?
Commit.

---

## ADIM 9 — Dashboard + timeline

```
Create branch feature/dashboard.
Build with shadcn/ui:
- /runs : list (agent name, status, risk level, started at, duration, cost, event count, redaction count)
- /runs/[id] : run summary + risk + cost + duration, vertical Timeline component,
  redaction findings, export actions, raw JSON viewer.
Default to REDACTED view; raw view only behind an explicit warning toggle.
Timeline shows: event type, title, time, input/output summary, redaction badge, risk badge.
Plan first, then implement. Keep it clean and corporate, no flashy dashboard clichés.
```

✅ Kontrol: `/runs` listede demo run görünüyor mu, `/runs/[id]` timeline + redaction badge'leri gösteriyor mu, varsayılan redacted mı?
**→ Gemini'ye UI/browser review verebilirsin (ADIM 9b).**

### ADIM 9b — Gemini'ye UI + mimari ikinci görüş
```
Review the /runs and /runs/[id] pages in the browser and the data model.
Focus on: visual consistency (shadcn/ui), timeline readability, redacted-by-default behavior,
and whether the data model supports the audit packet without changes.
Do NOT redesign the data model yourself; report findings only.
Return: 1) UI issues 2) Architecture concerns 3) Recommended small changes 4) Defer after MVP.
```

---

## ADIM 10 — JSON audit packet export

```
Implement JSON audit packet generation for POST /runs/{run_id}/exports?type=json:
include run, events (redacted), redaction_findings (hash only), and export metadata with a sha256 content_hash.
Add a download endpoint returning the packet. PDF export = placeholder only for now.
Plan first, then implement + a test that asserts NO raw sensitive value appears in the packet.
```

✅ Kontrol: indirilen JSON'da ham e-posta/telefon YOK, `content_hash` var, redaction findings hash içeriyor.
**→ Codex'e son güvenlik taraması:**
```
Final security pass: verify audit exports and server logs contain NO raw sensitive values,
tenant isolation holds across all endpoints, and API keys are never logged or returned.
Return small patches only.
```

---

## ADIM 11 — Demo provası (kabul kriterleri)

Sırayla doğrula (AGENTS.md §7):
1. `pnpm --filter demo-agent start` → run oluşuyor.
2. `/runs` listede görünüyor.
3. `/runs/[id]` timeline kronolojik.
4. Redaction tespitleri ve redacted view çalışıyor.
5. JSON audit packet indiriliyor, ham hassas veri içermiyor.
6. Başka org'un run'ına erişim reddediliyor.

Hepsi geçtiyse: `git commit -am "mvp: working demo"` → MVP tamam. 🎉

---

## Sonraki Aşama (MVP sonrası, şimdi DEĞİL)
PDF export · signed export links · OpenAI Agents SDK tracing · LangChain/LangGraph · RBAC ·
advanced redaction · risk scoring · immutable hash chain. Claude Code bunları önerirse: "defer after MVP".

---

## Hızlı Hatırlatma Kartı
- Her faz: **plan → onay → kod → kontrol → commit.**
- Redaction / API key / tenant isolation'a dokunan her şey → **Codex zorunlu**.
- UI ve mimari teyit → **Gemini**.
- Kapsam genişlemesi gördüğünde tek cevap: **"defer after MVP".**
