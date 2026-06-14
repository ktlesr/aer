# MVP_SPEC.md — Agent Evidence Recorder

## Goal
Record **one** agent run (Customer Data Deletion) end-to-end and prove it:
collector SDK → API → Postgres (via Prisma) → dashboard timeline → redacted JSON audit packet.
One demo run, flawless. No platform breadth.

## User Flow (the demo)
1. Developer runs the demo agent (`packages/demo-agent`).
2. The collector SDK opens a run, emits events, triggers redaction, requests approval, completes.
3. Events hit the API, which redacts sensitive input/output and stores findings.
4. A compliance reviewer opens the dashboard:
   - sees the run in the list,
   - opens the run detail and reads the chronological timeline,
   - sees redaction findings (redacted by default),
   - downloads the JSON audit packet (hash-anchored, no raw sensitive values).

## Dashboard Screens
- **`/runs`** — run list: agent name, status, risk level, started at, duration, cost,
  event count, redaction count.
- **`/runs/[id]`** — run detail:
  - summary (status, risk, cost, duration),
  - vertical **timeline** of events (type, title, time, input/output summary, redaction badge, risk badge),
  - redaction findings panel,
  - export actions (JSON now; PDF placeholder),
  - raw JSON viewer — **redacted by default**, raw only behind an explicit warning toggle.

## API Flow (`/api/v1`)
1. `POST /runs` → create a run (auth: Bearer API key → resolves org+project).
2. `POST /runs/{run_id}/events` → add an event; server runs `redactJson()` on input/output,
   stores redaction findings, returns findings count.
3. `POST /runs/{run_id}/complete` → mark run completed (status, ended_at, totals).
4. `POST /runs/{run_id}/exports?type=json` → generate the JSON audit packet (`content_hash`).
5. Download endpoint returns the packet.

All requests authenticate with a Bearer API key; org+project are derived from the key hash.
Cross-tenant access is rejected. Common error format `{ error: { code, message, request_id } }`.

## Collector Flow (`packages/collector-js`)
`AgentEvidenceRecorder` with:
- `startRun(...)` → returns a `run` handle,
- `run.event(...)` → posts a typed event,
- `run.complete(...)` → finalizes.
Calls the v1 API with the Bearer key. Small, typed, dependency-light.

## Export Flow
JSON audit packet includes: run, events (redacted), redaction_findings (hash only),
and export metadata with a `sha256` `content_hash`. PDF = placeholder only.
A test asserts **no raw sensitive value** appears in the packet.

## Out of Scope (MVP)
See `PRODUCT.md` → Out of Scope. Anything beyond the single demo run is "defer after MVP".

## Acceptance Criteria (AGENTS.md §7)
1. `pnpm --filter demo-agent start` creates a run.
2. The run appears in `/runs`.
3. `/runs/[id]` timeline is chronological.
4. Redaction findings show; redacted view works by default.
5. JSON audit packet downloads and contains no raw sensitive data.
6. Access to another org's run is rejected.
7. API key can submit events; tenant isolation holds.
