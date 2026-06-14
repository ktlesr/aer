# CLAUDE.md — Agent Evidence Recorder

> Bu dosya Claude Code tarafından her oturum başında otomatik yüklenir.
> Burada yazanlar projenin **değişmez kuralları**dır. Detaylı roller için `AGENTS.md`,
> adım adım akış için `RUNBOOK.md` dosyalarına bak.

## Proje Nedir
**Agent Evidence Recorder**: AI agent'ların her kritik işlemini (model call, tool call,
human approval, redaction, hata, çıktı) **denetlenebilir bir kanıt paketine** dönüştüren sistem.

- Bu bir **AI observability** aracı **DEĞİLDİR**.
- Konumlandırma: **Audit-ready evidence layer for AI agent runs.**
- İlk demo senaryosu: **Customer Data Deletion Request Agent**
- İlk teknik hedef: Next.js + Prisma dashboard + timeline + redaction + **JSON** audit packet.

## Tech Stack
Next.js · TypeScript (strict) · Tailwind CSS · shadcn/ui · PostgreSQL · Prisma · Node.js · pnpm workspaces.

## Repo Yapısı
```
apps/web/{app,components,lib,prisma,public}
packages/collector-js
packages/demo-agent
docs/{PRODUCT,MVP_SPEC,DATA_MODEL,API_CONTRACT,SECURITY,AGENTS}.md
```

## KAPSAM — Yapılacaklar (MVP)
agent run kaydı · agent event kaydı · model/tool/human-approval/error event · redaction finding ·
basit risk seviyesi · timeline dashboard · JSON export · PDF export placeholder · collector SDK ·
demo agent · mock data · basit API key mantığı.

## KAPSAM — YAPMA (MVP dışı, ısrar edilse de "defer after MVP" de)
billing · SSO · multi-cloud · RBAC · gerçek zamanlı WebSocket · takım yönetimi · API marketplace ·
blockchain/immutable audit · LangChain/CrewAI/n8n/Zapier/Make entegrasyonları · SOC2/GDPR tam uyum iddiası ·
Redis · Kafka · Temporal · Kubernetes · Elasticsearch · ClickHouse · microservices.

## Değişmez Davranış Kuralları
1. Önce kısa implementasyon planı üret, **onay bekle**, sonra kod yaz.
2. Yeni bağımlılık eklemeden önce gerekçesini yaz.
3. Diff'leri açık göster; hangi dosyaya neden dokunulduğunu belirt.
4. Kapsamı büyütme. Tek demo run'ı kusursuz yapmaya odaklan.
5. Tüm projeyi gerekçesiz baştan yazma.

## GÜVENLİK — Pazarlık Yok
- API key veritabanında **açık saklanmaz**, sadece `key_hash` saklanır; key yalnızca oluşturulduğunda gösterilir; revoke edilen key tekrar kullanılamaz.
- Orijinal hassas veri redaction_findings'te açık saklanmaz; sadece `original_hash` saklanır.
- Her tabloda `organization_id` + `project_id` bulunur; API isteğinde bunlar **API key'den çözülür**. Kullanıcı başka org'un run'ını göremez.
- Loglara ASLA yazılmaz: API key, raw prompt, raw user input, raw tool output, secret, token, personal data.
- Export & dashboard varsayılanı **redacted view**; raw view yalnızca açık uyarıyla.
- Export dosyaları signed URL ile indirilir, public olmaz, content hash içerir.

## Kod Standardı
- TypeScript strict; `any` yerine açık tipler.
- Ortak API error formatı: `{ "error": { "code", "message", "request_id" } }`.
- Commit mesajları kapsam belirten kısa formda: `feat(api): add create run endpoint`.

## Skills — Kurulu Skill Kullanım Kuralı
Skill'ler model-invoked'dır: faza uygun olanı kendin yükle, playbook'unu izle, ad-hoc yöntem uydurmadan önce mevcut skill'i tercih et. Bir skill MVP kapsamını büyütmeye çalışırsa uygulama; kapsam bu dosyaya tabidir.

**Her oturum başında / planlama:**
- `using-superpowers` (oturum başında otomatik; skill bulma/kullanma disiplinini kurar)
- `brainstorming` (özellik/komponent yazmadan ÖNCE zorunlu — gereksinim & tasarım)
- `writing-plans` (çok adımlı işe başlamadan plan üret)
- opsiyonel: `grill-with-docs` (planı domain'e karşı sertleştir), `ubiquitous-language` (run/event/redaction/audit terimlerini netle)

**Planı işe dökme:**
- `to-prd` (context → PRD), `to-issues` (plan → bağımsız issue), `triage`
- `executing-plans` / `subagent-driven-development` (planı checkpoint'lerle uygula)
- `using-git-worktrees` (her feature/ajan izole çalışsın — AGENTS.md §5 ile birebir)

**Repo kurulumu / güvenlik:**
- `setup-pre-commit` (Husky + lint-staged + typecheck + test)
- `git-guardrails-claude-code` (push/reset --hard gibi tehlikeli git komutlarını blokla)

**Frontend / dashboard (Adım 9):**
- `frontend-design` (ana — kurumsal, generic-AI olmayan UI)
- `shadcn` (component ekleme/styling/components.json)
- `ui-ux-pro-max` (stil/renk/tipografi/layout kütüphanesi)
- `vercel-react-best-practices` (Next.js performans pattern'leri)
- opsiyonel: `design-an-interface` / `prototype` (dashboard düzenini denemek)

**Test & review (çoğunlukla Codex tarafı):**
- `test-driven-development` (≈ `tdd`) — test-first
- `verification-before-completion` — "tamamlandı" demeden önce kanıt
- `review` (Standards + Spec ekseninde branch review), `requesting-code-review`, `receiving-code-review`

**Debug / mimari:**
- `systematic-debugging`, `diagnose` (bug/test failure'da)
- `improve-codebase-architecture`, `zoom-out` (gerektiğinde)

**Ajanlar arası devir:**
- `handoff` (Claude Code → Codex/Gemini'ye geçerken konuşmayı sıkıştır)
- `finishing-a-development-branch` (merge/PR/cleanup), `dispatching-parallel-agents`

**Bu projede KULLANMA (ilgisiz):** tüm `firecrawl-*` (web scraping), `analyzing-financial-statements`, `creating-financial-models`, `remotion*`, `obsidian-vault`, `canvas-design`, `caveman`, `teach`, `scaffold-exercises`, `edit-article`, `writing-beats/fragments/shape`, `applying-brand-guidelines`, `cookbook-audit`, `migrate-to-shoehorn`, skill yazma skill'leri (`write-a-skill`, `writing-skills`, `skill-creator`, `find-skills`).

## Komutlar (kurulduktan sonra doldur/güncelle)
- Install: `pnpm install`
- Dev: `pnpm --filter web dev`
- DB migrate: `pnpm --filter web prisma migrate dev`
- Seed: `pnpm --filter web prisma db seed`
- Demo agent: `pnpm --filter demo-agent start`

## Referanslar
- Roller ve sınırlar: `AGENTS.md`
- Adım adım akış ve hazır prompt'lar: `RUNBOOK.md`
- Ürün/spec/veri modeli/api/güvenlik: `docs/*.md`
