# @ktlsr/collector-js

Collector SDK for **[Agent Evidence Recorder](https://aer.ktlsr.com)** — record every critical action an AI agent takes (model calls, tool calls, human approvals, redactions, errors, outputs) as an **audit-ready, redacted evidence packet** over the AER v1 API.

- Small and dependency-light — a thin client over `fetch` (Node 18+).
- **Server-side redaction on every write**: the server masks the sensitive values it can recognise (emails, phones, cards, ids, keys/tokens, secret-named fields) before storage. Recognition is pattern- and field-name-based, **not universal**: names, free-text passwords and trade secrets in prose are not detected. Use a client-side `capture` policy (below) to keep such content from being sent at all.
- The SDK **never logs** your API key or payloads.
- Built-in timeout (AbortController) and retry on network/5xx errors (never on 4xx).

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
| `maxRetries` | `number`   | `2`                     | Retries on network error / 5xx. Never retries 4xx.           |
| `fetchImpl`  | `typeof fetch` | global `fetch`      | Override for testing.                                         |
| `capture`    | `CaptureOptions` | — (`full`)        | Client-side capture policy, applied before anything is sent. See below. |

### Capture policy (`capture`)

Decides what leaves your process. It runs on a deep copy — your objects are never mutated — and the
server still redacts again on arrival.

| `mode` | What is sent |
| --- | --- |
| `full` (default) | Everything you pass; only server-side redaction applies. |
| `redacted_content` | Values under secret-named keys (`password`, `apiKey`, `authorization`, `*token`, `credentials`…) are replaced by `[REDACTED_SECRET]`; tokens/keys, Luhn-valid cards and emails are masked in strings and object keys. |
| `allowlist` | Only the `allow` paths of `input` / `output` / `metadata` (e.g. `"output.sources.*.id"`), then masked as above. Unknown fields are dropped. |
| `metadata_only` | No `input` / `output` at all. `metadata` keeps only allowlisted keys with number, boolean or ≤200-char string values. |

Other fields: `secretFields` (extra key names to mask whole), `redact(payload)` (your own scrubber,
applied last), `onRedactionError` — `drop_content` (default: the step is still recorded with its
title replaced and all content withheld) or `throw` (nothing is sent). Raw content is never sent
when masking fails. `title` and `agentName` are always sent (masked in non-`full` modes) — keep
content out of them.

Each run/event then carries `capture: { mode, policy, status }`. AER stores and exports it as a
**client declaration**: the server cannot verify what the client did before sending.

```ts
const recorder = new AgentEvidenceRecorder({
  baseUrl, apiKey,
  capture: { mode: "allowlist", allow: ["input.question", "output.answer", "output.sources.*.id", "metadata.model"] },
});
```

### `recorder.startRun(input) → Promise<AgentRun>`

`input`: `{ agentName: string; riskLevel?: "low" | "medium" | "high" | "critical"; metadata?: Record<string, unknown> }`

### `run.event(input) → Promise<{ eventId: string; findingsCount: number }>`

`input`: `{ type: EventType; title: string; seq?: number; input?: unknown; output?: unknown; riskLevel?: RiskLevel; costMicroUsd?: number; metadata?: Record<string, unknown> }`

`EventType` is one of: `run_started`, `user_input`, `model_call`, `tool_call`, `redaction_applied`, `human_approval_requested`, `human_approval_granted`, `error`, `final_output`, `run_completed`.

### `run.complete(input?) → Promise<void>`

`input`: `{ status?: "completed" | "failed"; endedAt?: string }` (defaults to `completed`).

## What the SDK sends

Besides your API key and the run/event payloads you pass in, every request carries one header:

```
x-aer-sdk: collector-js/0.3.0
```

It tells the AER server which SDK and version created a run. Nothing else is collected — no
machine identifiers, no hostnames, no telemetry to any other destination. Requests only ever go
to the `baseUrl` you configure.

## Errors

Failed requests throw `RecorderError` with `code`, `message`, `status`, and optional `requestId`. Network/timeout failures use `code: "network"` and `status: 0`. The error never echoes the request URL or your API key.

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
