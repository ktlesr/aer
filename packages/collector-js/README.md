# @ktlsr/collector-js

Collector SDK for **[Agent Evidence Recorder](https://github.com/ktlesr/aer)** — record every critical action an AI agent takes (model calls, tool calls, human approvals, redactions, errors, outputs) as an **audit-ready, redacted evidence packet** over the AER v1 API.

- Small and dependency-light — a thin client over `fetch` (Node 18+).
- **Redacted by default**: the server detects and hashes sensitive values; raw input/output is never stored in the clear.
- The SDK **never logs** your API key or payloads.
- Built-in timeout (AbortController) and retry on network/5xx errors (never on 4xx).

## Install

```bash
npm install @ktlsr/collector-js
# or: pnpm add @ktlsr/collector-js
```

## Usage

```ts
import { AgentEvidenceRecorder } from "@ktlsr/collector-js";

const recorder = new AgentEvidenceRecorder({
  baseUrl: "https://your-aer-instance.example.com", // your AER web app
  apiKey: process.env.AER_API_KEY!,                 // never hard-code; load from env
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
| `baseUrl`    | `string`   | —                       | Base URL of your AER web app.                                |
| `apiKey`     | `string`   | —                       | Sent as `Authorization: Bearer <apiKey>`. Never logged.      |
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
