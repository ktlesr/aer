# @ktlsr/collector-js

Collector SDK for **[Agent Evidence Recorder](https://aer.ktlsr.com)** — record every critical action an AI agent takes (model calls, tool calls, human approvals, redactions, errors, outputs) as an **audit-ready, redacted evidence packet** over the AER v1 API.

- Small and dependency-light — a thin client over `fetch` (Node 18+).
- **Server-side redaction on every write**: the server masks the sensitive values it can recognise (emails, phones, cards, ids, keys/tokens, secret-named fields) before storage. Recognition is pattern- and field-name-based, **not universal**: names, free-text passwords and trade secrets in prose are not detected. Use a client-side `capture` policy (below) to keep such content from being sent at all.
- The SDK **never logs** your API key or payloads.
- Built-in timeout (AbortController, covering the response body too) and bounded retries on network errors, 408, 429 (honouring `Retry-After`) and 5xx — never on other 4xx.
- Safe retries: every call carries one `Idempotency-Key`, reused across its retries, so a retry after a lost response never records twice.

## Quick start

AER runs as a hosted service at **[aer.ktlsr.com](https://aer.ktlsr.com)** — there is no server to set up.

1. **Create an account** at [aer.ktlsr.com/signup](https://aer.ktlsr.com/signup).
2. **Create an API key** on the [API keys](https://aer.ktlsr.com/keys) page. It is shown once — put it in your environment as `AER_API_KEY`.
3. **Install the SDK** and point it at `https://aer.ktlsr.com`:

```bash
npm install @ktlsr/collector-js
# or: pnpm add @ktlsr/collector-js
```

Recorded runs appear on your dashboard at [aer.ktlsr.com/runs](https://aer.ktlsr.com/runs).

**Self-hosting:** AER is open source. Run your own instance from [the repository](https://github.com/ktlesr/aer) and set `baseUrl` to it instead.

## Upgrading

```bash
npm install @ktlsr/collector-js@latest
```

No code change is needed: the hosted AER accepts every earlier SDK version, and the calls you
already make (`startRun`, `event`, `complete`) keep their signatures. What changes when you move
to the latest version:

| From | What you get |
| --- | --- |
| ≤ 0.2 | Every call carries an `Idempotency-Key`, so a retry after a lost response never records twice. An explicit `seq` lower than the run's last one is now refused (`409`) instead of silently breaking the chain. |
| 0.3 – 0.4 | `run.complete()` returns `{ receipt }`. Keep it to verify an exported packet later with [`@ktlsr/aer-verify`](https://www.npmjs.com/package/@ktlsr/aer-verify). |
| 0.5 | `429` (honouring `Retry-After`) and `408` are retried. New, all optional: `run.enqueue()`, `recorder.flush()` / `shutdown()` / `stats()`, and a file store that keeps queued events across restarts. Call `await recorder.shutdown()` before your process exits. |
| 0.6 | Verified human approval: `requestApproval`, `waitForApproval`, `consumeApproval`, `reportApprovalOutcome`. |

Runs sealed before receipts existed still verify, as `verified_partial` (their manifest cannot be
reconstructed after the fact).

## Usage

```ts
import { AgentEvidenceRecorder } from "@ktlsr/collector-js";

const recorder = new AgentEvidenceRecorder({
  baseUrl: "https://aer.ktlsr.com",   // or your self-hosted instance
  apiKey: process.env.AER_API_KEY!,   // never hard-code; load from env
  environment: "production",          // optional deployment label
});

// Start a run for one agent execution.
const run = await recorder.startRun({
  agentName: "Customer Data Deletion Agent",
  riskLevel: "high",
});

// Emit events as the agent works. Sensitive values are redacted server-side.
const { findingsCount } = await run.event({
  type: "user_input",
  title: "Deletion request received",
  input: { email: "jane@example.com" }, // detected + hashed, not stored raw
});

await run.event({
  type: "tool_call",
  title: "search_customer",
  output: { customerId: "cus_123" },
});

// Complete the run.
await run.complete({ status: "completed" });
```

## API

### `new AgentEvidenceRecorder(options)`

| Option       | Type       | Default                 | Notes                                                        |
| ------------ | ---------- | ----------------------- | ------------------------------------------------------------ |
| `baseUrl`    | `string`   | —                       | `https://aer.ktlsr.com`, or your self-hosted AER web app.    |
| `apiKey`     | `string`   | —                       | Sent as `Authorization: Bearer <apiKey>`. Never logged.      |
| `environment` | `string`  | —                       | Deployment label (`production`, `staging`…) recorded on every run. 1–40 chars: letters, digits, `.` `_` `-`. |
| `timeoutMs`  | `number`   | `10000`                 | Per-request timeout via `AbortController`.                   |
| `maxRetries` | `number`   | `2`                     | Retries on network error, 408, 429 and 5xx; no other 4xx.    |
| `fetchImpl`  | `typeof fetch` | global `fetch`      | Override for testing.                                         |
| `capture`    | `CaptureOptions` | — (`full`)        | Client-side capture policy, applied before anything is sent. See below. |

### Capture policy (`capture`)

Decides what leaves your process. It runs on a deep copy — your objects are never mutated — and the
server still redacts again on arrival.

| `mode` | What is sent |
| --- | --- |
| `full` (default) | Everything you pass; only server-side redaction applies. |
| `redacted_content` | Values under secret-named keys (`password`, `apiKey`, `authorization`, `*token`, `credentials`…) are replaced by `[REDACTED_SECRET]`; tokens/keys, Luhn-valid cards and emails are masked in strings and object keys. |
| `allowlist` | Only the `allow` paths of `input` / `output` / `metadata` (e.g. `"output.sources.*.id"`), then masked as above. Unknown fields are dropped. `title` / `agentName` are replaced by the event type / `"agent"` unless you list `"title"` / `"agentName"`. |
| `metadata_only` | No `input` / `output`, never the original `title` (the event type is sent). `agentName` only if listed and identifier-shaped (no spaces, ≤64 chars). `metadata`: allowlisted numbers and booleans; strings only under `model`, `provider`, `tool`, `toolName`, `status`, `version`, `environment` and only identifier-shaped. |

Other fields: `secretFields` (extra key names to mask whole), `redact(payload)` (your own scrubber,
applied last), `onRedactionError` — `drop_content` (default: the step is still recorded with its
title replaced and all content withheld) or `throw` (nothing is sent). Raw content is never sent
when masking fails. In `full` and `redacted_content`, `title` and `agentName` are sent (masked in
`redacted_content`) — keep content out of them, or use `allowlist` / `metadata_only`.

Each run/event then carries `capture: { mode, policy, status }`. AER stores and exports it as a
**client declaration**: the server cannot verify what the client did before sending.

```ts
const recorder = new AgentEvidenceRecorder({
  baseUrl, apiKey,
  capture: { mode: "allowlist", allow: ["input.question", "output.answer", "output.sources.*.id", "metadata.model"] },
});
```

### `recorder.startRun(input) → Promise<AgentRun>`

`input`: `{ agentName: string; riskLevel?: "low" | "medium" | "high" | "critical"; metadata?: Record<string, unknown>; conversationRef?: string; turnRef?: string; parentRunId?: string; idempotencyKey?: string }`

`conversationRef` / `turnRef` are your identifiers (1–200 chars `A-Z a-z 0-9 . _ : -` — not text).
`parentRunId` is the AER run id of the previous step; the dashboard and packet link to it, or show
`missing_context` if that run doesn't exist in your project (never recorded, pruned, or not yours).
`run.lineageStored` is `false` if you sent these and the server didn't store them (older server).

### `run.event(input) → Promise<{ eventId: string; findingsCount: number; sourcedStored?: boolean }>`

`input`: `{ type: EventType; title: string; seq?: number; input?: unknown; output?: unknown; riskLevel?: RiskLevel; costMicroUsd?: number; metadata?: Record<string, unknown>; sourced?: SourcedEvidence; idempotencyKey?: string }`

`seq` is the event's position in the run's evidence chain. Leave it out: the server assigns the next
one atomically. If you do send it, it must be higher than every earlier `seq` of the run (gaps are
allowed); resending an existing `seq` with identical content returns the original event, with
different content it fails with `409`. Put your own step numbers in `metadata`, not in `seq`.

### Sourced answers (`sourced`)

For assistants that answer from documents. Send what you actually have — every omitted part is
shown as "not recorded", never guessed.

```ts
await run.event({
  type: "model_call",
  title: "answer",
  sourced: {
    profile: "sourced_assistant",
    version: 1,
    context: {
      used: [
        { key: "ilce", value: "Milas", origin: "user_stated" },
        { key: "yatirim_konusu", value: "soğuk hava deposu", origin: "previous_turn", fromTurnRef: "t1" },
        { key: "il", value: "Muğla", origin: "inferred" },
      ],
      missing: ["yatirim_tutari"],
    },
    retrievedSources: [{ id: "9903.md9", score: 12.4, scoreMethod: "bm25" }],
    citedSources: [{ id: "9903.md9", version: "2024-v1", contentHash: "sha256:…", hashScope: "chunk_text_utf8", archiveRef: "kb:9903/md9" }],
    claimSourceLinks: [{ claim: "…", sourceIds: ["9903.md9"], basis: "model_declared" }],
    generation: { provider: "…", model: "…", promptTemplateVersion: "answer@7", appVersion: "1.12.0" },
    timing: { clientStartedAt: "…", clientEndedAt: "…" },
  },
});
```

- `origin: "inferred"` is shown as *inferred — not confirmed*; use it for anything the user didn't say.
- `retrievedSources` are candidates, `citedSources` are what the answer presents as support — the
  two are never merged. A `score` is your retriever's number, not a probability.
- `claimSourceLinks[].sourceIds` must be in `citedSources`. `basis: "assessed"` requires an
  `assessment: { method, version, result }` describing the separate check.
- `contentHash` must be `sha256:<hex>` with a `hashScope` naming the bytes hashed. A hash proves
  which version was cited, not what it said — keep `archiveRef` to retrieve it. No source field
  (`id`, `title`, `archiveRef`…) may contain a query string or credentials — a signed URL is
  rejected with `422` wherever it is put.
- A context entry with a secret-named `key` (`password`, `apiToken`…) is masked whole.
- Do not send model reasoning / chain of thought; record the sources, tool results and the
  explanation the user was shown.
- Capture modes: `allowlist` keeps only the `sourced.*` paths you list; `metadata_only` sends no
  `sourced` block; `conversationRef` / `turnRef` are sent in restricted modes only if listed.
- The block is stored redacted and exported in the packet, but it is **not yet covered by the event
  chain hash** (planned).

### Delivery: awaited, queued, and what happens when AER is unreachable

Every write after `startRun` goes through one ordered queue, so events reach AER in the order you
made them (that order is the evidence chain).

| Call | Returns when | If AER can't take it |
| --- | --- | --- |
| `startRun()` | the run exists on AER | throws after `maxRetries` — decide whether to proceed |
| `run.event()` | AER **accepted** the event (after anything queued before it) | throws — use it for steps that must not happen unrecorded |
| `run.enqueue()` | the event is **queued** (and persisted, with a store) | retried in the background within the limits; if it never lands: `onDeliveryError`, `stats().failed`, and `complete()` refuses that run |
| `run.complete()` | AER sealed the run | throws; `undelivered_events` (nothing sent) if an enqueued event of this run was never delivered |

```ts
import { AgentEvidenceRecorder } from "@ktlsr/collector-js";
import { fileQueueStore } from "@ktlsr/collector-js/file-store"; // Node only, optional

const recorder = new AgentEvidenceRecorder({
  baseUrl, apiKey,
  delivery: {
    store: fileQueueStore("./var/aer-queue.json"),   // survive restarts; omit for in-memory
    maxQueueItems: 1000, maxQueueBytes: 5_000_000,   // limits (defaults shown)
    maxItemAgeMs: 600_000,                          // give up on a background event after 10 min
    maxRetryDelayMs: 30_000,                        // cap on any wait, Retry-After included
    whenFull: "throw",                              // or "wait" (backpressure)
    onDeliveryError: (f) => log.warn("AER evidence not delivered", f.reason, f.runId),
  },
});
await recorder.resume();                 // with a store: deliver what a previous process left
// …
const { delivered, failed, pending } = await recorder.flush(5_000);
const closed = await recorder.shutdown(5_000); // before exit: stop accepting, drain, report the rest
if (closed.checkpointsPending > 0) {
  // A store save was still running at the deadline and may still land. Do NOT hand the same store
  // to another recorder until this process has exited (or call shutdown() again without a timeout).
}
recorder.stats();                        // { queued, queuedBytes, delivered, failed, retries }
```

- **Retries:** network/timeout, 408, 429 and 5xx are retried with the same `Idempotency-Key`
  (`Retry-After` honoured, each wait capped by `maxRetryDelayMs`); other 4xx (401, 404, 409, 422…)
  are not. Never unbounded: awaited calls stop after `maxRetries`, queued events after `maxItemAgeMs`.
- **Full queue:** `enqueue()` throws `queue_full` and queues nothing (or waits, with `whenFull: "wait"`).
  Nothing is dropped silently.
- **Exit:** pending retries keep a Node process alive (up to `maxItemAgeMs`) rather than lose
  evidence; `shutdown(timeoutMs)` bounds that. Without a store, events still pending at shutdown are
  reported through `onDeliveryError` (`reason: "closed"`); with a store they stay on disk.
- **Shutdown and the store:** `shutdown()` without a timeout waits for every save it started, so
  nothing of this recorder can be written after it returns. With a timeout the deadline wins and
  any save still running is reported in `checkpointsPending`; while that is non-zero, don't give
  the same store to another recorder (that save could overwrite the newer state). There is no
  cross-process lock: never use one store file from two processes at the same time.
- **Restart:** queued items keep their `Idempotency-Key`, so a resumed delivery of something that
  had already landed is a replay, not a duplicate. Re-open the run with the same
  `startRun({ idempotencyKey })` to keep adding to it.
- **The store file** holds the capture-filtered request bodies and keys — never the API key. It is
  written before AER's own redaction, so with a store the capture policy defaults to
  `redacted_content` and `capture.mode: "full"` is refused. Keep it on a private path.
- **Loading:** the store is loaded once — by `resume()` or implicitly on the first write. A damaged
  file is refused: that recorder then accepts no writes (`store_not_loaded`) and never touches the
  file. A failed save rejects the write (`store_failed`) and leaves no trace of it.
- **Which to use:** `event()` for anything you must be able to prove (approvals, irreversible
  actions); `enqueue()` for steps where continuing with a delivery warning is acceptable.

### Verified human approval

For actions a person must sign off (refunds, deletions, outbound messages):

```ts
const approval = await run.requestApproval({
  action: "refund",
  params: { orderId: "ord-1001", amountMinor: 4200, currency: "TRY" }, // exact values, see below
  ttlSeconds: 900, // 30–86400
  maxUses: 1,      // 1–10
});
// A signed-in user of your AER workspace approves or rejects it in the dashboard.
// Your API key cannot approve.
const decided = await run.waitForApproval(approval.id, { timeoutMs: 5 * 60_000 });

// Right BEFORE acting, with the same action and parameters:
await run.consumeApproval(approval.id, { action: "refund", params: { orderId: "ord-1001", amountMinor: 4200, currency: "TRY" } });
// ...perform the refund only if consumeApproval did not throw...
await run.reportApprovalOutcome(approval.id, { status: "succeeded", externalRef: "psp-tx-778" });
```

- `consumeApproval` throws `RecorderError` (status `409`, `message` = reason: `approval_pending`,
  `_rejected`, `_revoked`, `_expired`, `_used_up`, `_action_mismatch`, `_params_mismatch`).
  **AER does not block the action** — your code must stop when it throws.
- The approval is bound to salted hashes of the **real** action name and parameter values, so
  `params` are sent as given, not through the capture policy. AER stores only a redacted copy.
  Send identifiers and amounts, not free text. Numbers are compared as JSON doubles: send exact
  decimals or integers beyond 2^53 as strings (non-finite numbers, such integers and malformed
  Unicode are refused with 422).
- Approval events you send yourself (`human_approval_granted` …) are shown as *reported by the agent*;
  only decisions made in the dashboard are shown as *verified by AER*.
- The outcome you report is stored and shown as your claim, not verified by AER.
- Approval calls are not queued; `flush()` first if strict ordering with `enqueue()`d events matters.

### Idempotency and retries

Each `startRun` / `event` / `complete` call sends an `Idempotency-Key` header, generated once per
call and reused by that call's retries. If the server committed but the response was lost, the
retry gets the original result back (`Idempotent-Replayed: true`) instead of a second record.
Pass `idempotencyKey` yourself (1–200 chars `A-Z a-z 0-9 . _ : -`) to keep it stable across a
process restart. Keys are scoped to your project and kept for 24 hours; reusing a key for a
different request fails with `409 conflict`. Completing an already completed run with the same
status is a no-op; a different status or `endedAt` is `409`.

`EventType` is one of: `run_started`, `user_input`, `model_call`, `tool_call`, `redaction_applied`, `human_approval_requested`, `human_approval_granted`, `error`, `final_output`, `run_completed`.

### `run.complete(input?) → Promise<{ receipt: Receipt | null }>`

`input`: `{ status?: "completed" | "failed"; endedAt?: string; idempotencyKey?: string }` (defaults to `completed`).

Sealing returns a **receipt**: the run manifest hash (which commits to every event, the run's
context and the algorithm versions), the chain head and the event count — Ed25519-signed if the
server has a signing key. **Store it somewhere you control.** Later,
`npx @ktlsr/aer-verify packet.json --receipt receipt.json --trusted-key key.json` shows whether an
exported packet is still the run you were handed a receipt for — a packet rewritten and fully
recomputed afterwards will not match. `issued_at` is AER's own clock, not an independent timestamp.
`receipt` is `null` from servers that predate run manifests. Repeating `complete` returns the same
receipt.

## What the SDK sends

Besides your API key and the run/event payloads you pass in, every request carries two headers:

```
x-aer-sdk: collector-js/0.7.1
idempotency-key: <random UUID, or your idempotencyKey>
```

It tells the AER server which SDK and version created a run. Nothing else is collected — no
machine identifiers, no hostnames, no telemetry to any other destination. Requests only ever go
to the `baseUrl` you configure.

## Errors

Failed requests throw `RecorderError` with `code`, `message`, `status`, and optional `requestId` / `retryAfterMs`. Queue codes: `queue_full`, `recorder_closed`, `undelivered_events`. Network/timeout failures use `code: "network"` and `status: 0`. A non-JSON response (e.g. a proxy error page) keeps its HTTP `status` and is never quoted in the message. The error never echoes the request URL, your API key or the response body.

```ts
import { RecorderError } from "@ktlsr/collector-js";

try {
  await run.event({ type: "tool_call", title: "..." });
} catch (err) {
  if (err instanceof RecorderError) {
    console.error(err.code, err.status, err.requestId);
  }
}
```

## License

MIT
