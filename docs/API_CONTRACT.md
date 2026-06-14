# API_CONTRACT.md — Agent Evidence Recorder

Base path: `/api/v1`. All bodies are JSON. All responses are JSON.

## Authentication
- Header: `Authorization: Bearer <api_key>`.
- The server hashes the presented key (sha256) and looks up `ApiKey.keyHash`.
- On match and `revokedAt == null`: `organizationId` + `projectId` are resolved **from the key**.
- The client **cannot** set org/project in the body; any such fields are ignored.
- Missing/invalid/revoked key → `401 unauthorized`.
- A run that belongs to another org/project → `404 not_found` (do not leak existence).

## Error Format (all errors)
```json
{ "error": { "code": "string_snake_case", "message": "human readable", "request_id": "req_..." } }
```
Common codes: `unauthorized` (401), `forbidden` (403), `not_found` (404),
`validation_error` (422), `rate_limited` (429), `internal_error` (500).
Every response carries a `request_id` (also echoed in logs — but **never** the key/payload).

## Idempotency
- `POST /runs` and `POST /runs/{id}/events` accept an optional `Idempotency-Key` header.
- Replaying the same key for the same route returns the original result instead of duplicating.
- Events also enforce per-run `seq` uniqueness as a second guard.

---

## POST /runs — create a run
Request:
```json
{ "agentName": "Customer Data Deletion Agent", "riskLevel": "medium", "metadata": { "env": "demo" } }
```
Response `201`:
```json
{ "run": { "id": "run_abc", "agentName": "Customer Data Deletion Agent",
           "status": "running", "riskLevel": "medium", "startedAt": "2026-06-14T10:00:00Z" } }
```
Validation: `agentName` required (1–200 chars); `riskLevel` optional enum.

## POST /runs/{run_id}/events — add an event
The server runs `redactJson()` on `input` and `output`, stores the **redacted** snapshots,
persists any redaction findings (hash only), and returns the findings count.
Request:
```json
{
  "type": "user_input",
  "title": "Customer requests deletion",
  "seq": 2,
  "input": { "user": { "email": "jane@acme.com", "phone": "+1 415 555 0100" } },
  "output": null,
  "riskLevel": "medium",
  "costMicroUsd": 0,
  "metadata": { "channel": "support" }
}
```
Response `201`:
```json
{ "event": { "id": "evt_1", "seq": 2, "type": "user_input", "occurredAt": "..." },
  "redaction": { "findingsCount": 2 } }
```
Validation: `type` required enum; `title` required; `seq` optional (server assigns next if
omitted); `input`/`output` optional JSON. Raw values are redacted **before** persistence.

## POST /runs/{run_id}/complete — finish a run
Request:
```json
{ "status": "completed", "endedAt": "2026-06-14T10:02:00Z" }
```
Server computes `durationMs` and finalizes `eventCount`/`redactionCount`/`costMicroUsd`.
Response `200`:
```json
{ "run": { "id": "run_abc", "status": "completed", "durationMs": 120000,
           "eventCount": 9, "redactionCount": 2, "costMicroUsd": 0 } }
```
Validation: `status` enum (`completed | failed`); a completed run rejects further events
with `422 validation_error` (`run_already_completed`).

## POST /runs/{run_id}/exports?type=json — generate audit packet
Builds the JSON audit packet (see DATA_MODEL → packet shape), computes `content_hash`,
stores an `AuditExport`, and returns its metadata.
Response `201`:
```json
{ "export": { "id": "exp_1", "type": "json", "status": "ready",
              "contentHash": "sha256:…", "downloadPath": "/api/v1/runs/run_abc/exports/exp_1/download" } }
```
`type=pdf` → `202` with `status: "pending"` (placeholder only for MVP).

## GET /runs/{run_id}/exports/{export_id}/download — download packet
Returns the stored packet JSON with header `X-Content-Hash: sha256:…`.
The packet contains **no raw sensitive values**. (Signed URLs deferred after MVP.)

---

## Notes
- All list/detail reads are scoped to the resolved org+project; cross-tenant reads → `404`.
- Inputs are validated (e.g. with zod) before any DB write.
- Logs record `request_id`, route, status, org/project IDs — **never** keys or raw payloads.
