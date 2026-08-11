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
docs/                 PRODUCT.md (product positioning)
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
Positioning and product direction: [`docs/PRODUCT.md`](docs/PRODUCT.md).

The remaining documents (spec, data model, API contract, security notes, agent roles,
build runbook, design system) are internal and deliberately kept out of this repository,
so they are not linked here.
