# SECURITY.md — Agent Evidence Recorder

These rules are **non-negotiable** and mirror `CLAUDE.md` → Güvenlik. Any change that
touches redaction, API keys, or tenant isolation **must** pass Codex security review
before merge (AGENTS.md §4).

## Sensitive Data Types (detected & redacted)
| Type | `FindingType` | Detection (regex/pattern) |
|------|---------------|----------------------------|
| Email | `email` | RFC-ish `local@domain.tld` |
| Phone | `phone` | international/grouped digit runs (`+1 415 555 0100`, etc.) |
| API key | `api_key` | high-entropy prefixed tokens (e.g. `aer_live_…`, `sk-…`) |
| Bearer token | `bearer_token` | `Bearer <token>` / JWT-like `xxxxx.yyyyy.zzzzz` |
| Credit-card-like | `credit_card` | 13–19 digit groups passing Luhn |
| National-ID-like | `national_id` | 9–11 digit national-id patterns |

## Redaction Rules
- Redaction runs **server-side** on every event `input`/`output` **before** any persistence.
- The stored snapshot replaces each detected value with a token: `[REDACTED_EMAIL]`,
  `[REDACTED_PHONE]`, `[REDACTED_API_KEY]`, `[REDACTED_BEARER_TOKEN]`,
  `[REDACTED_CREDIT_CARD]`, `[REDACTED_NATIONAL_ID]`.
- For each detected value, a `RedactionFinding` is recorded with:
  `findingType`, `severity`, `fieldPath`, and `originalHash` (sha256 of the raw value).
- **The raw value is never stored** — not in the event, not in the finding, not in logs.
- `redactJson()` is pure and unit-tested per pattern; findings never contain raw values.

## API Key Storage
- Only `keyHash` (sha256) and a short non-secret `prefix` are stored — **never plaintext**.
- The plaintext key is shown **once, at creation**, and never again.
- Auth hashes the presented key and compares to `keyHash`.
- `revokedAt != null` → key rejected (`401`); revoked keys can never be reused.
- Keys are never logged, never returned by any read endpoint, never put in error messages.

## Tenant Isolation
- Every tenant-scoped table has `organizationId` + `projectId`.
- On every request these are **resolved from the API key**, never read from the client body.
- All reads/writes are filtered by the resolved org+project.
- A run/export belonging to another tenant returns `404 not_found` (existence not leaked).

## Logging
Never written to logs under any circumstance:
API keys · raw prompts · raw user input · raw tool output · secrets · tokens · personal data.
Logs may contain: `request_id`, route, HTTP status, org/project IDs, timing, error codes.

## Export & Dashboard Security
- **Default view is redacted** — both dashboard and exports.
- Raw view is available only behind an **explicit warning toggle** in the UI.
- The JSON audit packet contains redacted events + findings (hash only) + export metadata
  with a `sha256` `content_hash` over the canonicalized packet.
- A test asserts **no raw sensitive value** appears anywhere in the packet.
- Exports are not public; downloads carry a content hash. (Signed URLs = defer after MVP.)

## Review Gate
Redaction / API-key / tenant-isolation changes do not merge to `main` without Codex
security review. Each review returns: 1) Major 2) Minor 3) Recommended 4) Defer after MVP.
