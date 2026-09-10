# @ktlsr/collector-js

Collector SDK for **[Agent Evidence Recorder](https://aer.ktlsr.com)** — record every critical action an AI agent takes (model calls, tool calls, human approvals, redactions, errors, outputs) as an **audit-ready, redacted evidence packet** over the AER v1 API.

- Small and dependency-light — a thin client over `fetch` (Node 18+).
- **Redacted by default**: the server detects and hashes sensitive values; raw input/output is never stored in the clear.
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
x-aer-sdk: collector-js/0.2.0
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
