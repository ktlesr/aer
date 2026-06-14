# DATA_MODEL.md — Agent Evidence Recorder

Seven models. Every tenant-scoped table carries `organizationId` + `projectId`, both
**resolved from the API key** on write — never trusted from the client body.

All IDs are `cuid()` strings. All timestamps are UTC. Money/cost stored as integer
**micro-USD** (`costMicroUsd`) to avoid float drift. JSON columns are Prisma `Json`.

## Enums
```
RunStatus     = running | completed | failed | needs_approval
RiskLevel     = low | medium | high | critical
EventType     = run_started | user_input | model_call | tool_call |
                redaction_applied | human_approval_requested | human_approval_granted |
                error | final_output | run_completed
FindingType   = email | phone | api_key | bearer_token | credit_card | national_id
Severity      = low | medium | high
ExportType    = json | pdf
ExportStatus  = pending | ready | failed
```

## 1. Organization
| field | type | notes |
|-------|------|-------|
| id | String @id cuid | |
| name | String | |
| createdAt | DateTime @default(now()) | |
Relations: `projects[]`, `apiKeys[]`, `runs[]`.

## 2. Project
| field | type | notes |
|-------|------|-------|
| id | String @id cuid | |
| organizationId | String | FK → Organization |
| name | String | |
| createdAt | DateTime | |
Relations: `organization`, `apiKeys[]`, `runs[]`. Index: `(organizationId)`.

## 3. ApiKey — **stores hash only**
| field | type | notes |
|-------|------|-------|
| id | String @id cuid | |
| organizationId | String | FK |
| projectId | String | FK |
| name | String | label, e.g. "demo key" |
| keyHash | String @unique | sha256 of the secret; **plaintext never stored** |
| prefix | String | first ~8 chars for display, e.g. `aer_live_a1b2` |
| revokedAt | DateTime? | revoked keys are rejected at auth |
| createdAt | DateTime | |
| lastUsedAt | DateTime? | |
Index: `(keyHash)`, `(organizationId, projectId)`.
The plaintext key is shown **only once at creation**.

## 4. AgentRun
| field | type | notes |
|-------|------|-------|
| id | String @id cuid | |
| organizationId | String | FK (from key) |
| projectId | String | FK (from key) |
| agentName | String | e.g. "Customer Data Deletion Agent" |
| status | RunStatus @default(running) | |
| riskLevel | RiskLevel @default(low) | simple level, not a score |
| startedAt | DateTime @default(now()) | |
| endedAt | DateTime? | |
| durationMs | Int? | computed on complete |
| costMicroUsd | Int @default(0) | sum of model_call costs |
| eventCount | Int @default(0) | denormalized for list view |
| redactionCount | Int @default(0) | denormalized for list view |
| metadata | Json? | small, non-sensitive |
Relations: `events[]`, `findings[]`, `exports[]`.
Index: `(organizationId, projectId, startedAt)`.

## 5. AgentEvent
| field | type | notes |
|-------|------|-------|
| id | String @id cuid | |
| organizationId | String | FK |
| projectId | String | FK |
| runId | String | FK → AgentRun |
| seq | Int | per-run monotonic order (1,2,3…) |
| type | EventType | |
| title | String | short human label |
| occurredAt | DateTime @default(now()) | |
| inputRedacted | Json? | **redacted** input snapshot |
| outputRedacted | Json? | **redacted** output snapshot |
| riskLevel | RiskLevel? | per-event risk if relevant |
| costMicroUsd | Int? | for model_call events |
| metadata | Json? | non-sensitive (model name, tool name, latency) |
Index: `(runId, seq)`, `(organizationId, projectId)`.
**Raw, unredacted payloads are never persisted** — only the redacted snapshots above.

## 6. RedactionFinding — **stores hash only**
| field | type | notes |
|-------|------|-------|
| id | String @id cuid | |
| organizationId | String | FK |
| projectId | String | FK |
| runId | String | FK |
| eventId | String? | FK → AgentEvent (where found) |
| findingType | FindingType | |
| severity | Severity | |
| fieldPath | String | JSON path, e.g. `input.user.email` |
| originalHash | String | sha256 of the raw value; **raw value never stored** |
| createdAt | DateTime | |
Index: `(runId)`, `(organizationId, projectId)`.

## 7. AuditExport
| field | type | notes |
|-------|------|-------|
| id | String @id cuid | |
| organizationId | String | FK |
| projectId | String | FK |
| runId | String | FK |
| type | ExportType @default(json) | pdf = placeholder |
| status | ExportStatus @default(pending) | |
| contentHash | String? | sha256 of the packet bytes |
| packet | Json? | the generated audit packet (redacted) |
| createdAt | DateTime | |
Index: `(runId)`, `(organizationId, projectId)`.

## JSON Field Shapes
**`AgentEvent.inputRedacted` / `outputRedacted`** — arbitrary redacted object, e.g.
```json
{ "user": { "email": "[REDACTED_EMAIL]", "phone": "[REDACTED_PHONE]" }, "reason": "deletion request" }
```
**`AuditExport.packet`** — the audit packet:
```json
{
  "schema_version": "1.0",
  "run": { "id": "...", "agentName": "...", "status": "completed", "riskLevel": "high",
           "startedAt": "...", "endedAt": "...", "durationMs": 0, "costMicroUsd": 0 },
  "events": [ { "seq": 1, "type": "run_started", "title": "...", "occurredAt": "...",
                "inputRedacted": {}, "outputRedacted": {} } ],
  "redaction_findings": [ { "findingType": "email", "severity": "medium",
                            "fieldPath": "input.user.email", "originalHash": "sha256:..." } ],
  "export": { "type": "json", "generatedAt": "...", "content_hash": "sha256:..." }
}
```
`content_hash` is computed over the canonicalized packet **excluding** the `content_hash`
field itself.
