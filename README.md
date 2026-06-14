# Agent Evidence Recorder

Audit-ready evidence layer for AI agent runs. Turns every critical agent action
(model call, tool call, human approval, redaction, error, output) into a redacted,
hash-anchored **audit packet**.

> Not an observability tool. See [`docs/PRODUCT.md`](docs/PRODUCT.md) for positioning.

## Repo Layout
```
apps/web              Next.js (App Router) + TS strict + Tailwind + shadcn/ui + Prisma
packages/collector-js Collector SDK (startRun / run.event / run.complete)
packages/demo-agent   Customer Data Deletion demo agent
docs/                 PRODUCT, MVP_SPEC, DATA_MODEL, API_CONTRACT, SECURITY
```

## Prerequisites
- Node.js >= 20, pnpm 10+
- PostgreSQL (local, Docker, or hosted) — set `DATABASE_URL` in `apps/web/.env`

## Commands
```bash
pnpm install                 # install all workspaces
pnpm dev                     # run apps/web (http://localhost:3000)
pnpm build                   # build apps/web
pnpm lint                    # lint apps/web
pnpm db:migrate              # prisma migrate dev (apps/web)
pnpm db:seed                 # seed one demo run (apps/web)
pnpm demo                    # run the demo agent end-to-end
```

## Docs
Product/spec/data-model/API/security live in [`docs/`](docs). Agent roles and review
flow are in [`AGENTS.md`](AGENTS.md); the step-by-step build runbook is in
[`RUNBOOK.md`](RUNBOOK.md). Project rules are in [`CLAUDE.md`](CLAUDE.md).
