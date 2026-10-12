// collector-js — Agent Evidence Recorder collector SDK.
// Small, dependency-light client over the v1 API. Uses the global fetch (Node 18+).
import { applyCapture, capturePolicy, type CaptureOptions } from "./capture.js";

export type { CaptureDeclaration, CaptureMode, CaptureOptions, CapturePayload } from "./capture.js";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type EventType =
  | "run_started"
  | "user_input"
  | "model_call"
  | "tool_call"
  | "redaction_applied"
  | "human_approval_requested"
  | "human_approval_granted"
  | "error"
  | "final_output"
  | "run_completed";

/** Must match package.json "version" — src/index.test.ts fails if they drift. */
export const SDK_VERSION = "0.3.0";

/** Sent on every request so the server can tell collector-js runs from raw API calls. */
const SDK_HEADER = `collector-js/${SDK_VERSION}`;

export interface RecorderOptions {
  /** Base URL of the AER web app, e.g. http://localhost:3000 */
  baseUrl: string;
  /** Bearer API key. Sent as Authorization: Bearer <apiKey>; never logged by this SDK. */
  apiKey: string;
  /**
   * Deployment label recorded on every run this recorder starts, e.g. "production" or
   * "staging". 1–40 chars: letters, digits, `.`, `_`, `-`. Optional.
   */
  environment?: string;
  /** Per-request timeout in ms (via AbortController). Default 10000. */
  timeoutMs?: number;
  /** Max retries on network error or 5xx (never on 4xx). Default 2. */
  maxRetries?: number;
  /** Override fetch (for tests). Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Client-side capture policy, applied before anything is sent. Omitted = `full` (send as
   * given; the server still redacts). See CaptureOptions.
   */
  capture?: CaptureOptions;
}

/**
 * `idempotencyKey` (optional, on every input): your own key for this logical operation, e.g. to
 * resume after a process restart. Omitted = the SDK generates one per call and reuses it across
 * that call's retries. 1–200 chars of A-Z a-z 0-9 . _ : -; scoped to your project.
 */
export interface StartRunInput {
  idempotencyKey?: string;
  agentName: string;
  riskLevel?: RiskLevel;
  metadata?: Record<string, unknown>;
}

export interface EventInput {
  idempotencyKey?: string;
  type: EventType;
  title: string;
  seq?: number;
  input?: unknown;
  output?: unknown;
  riskLevel?: RiskLevel;
  costMicroUsd?: number;
  metadata?: Record<string, unknown>;
}

export interface CompleteInput {
  idempotencyKey?: string;
  status?: "completed" | "failed";
  endedAt?: string;
}

export interface EventResult {
  eventId: string;
  findingsCount: number;
}

export class RecorderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "RecorderError";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function newIdempotencyKey(): string {
  // ponytail: Web Crypto is global on Node >= 19 and in browsers/edge runtimes; the fallback only
  // has to be unique within one project, not secret.
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  );
}

/** Split the optional caller-chosen key off the body (it travels as a header, not content). */
function withoutKey<T extends { idempotencyKey?: string }>(
  input: T,
): [Omit<T, "idempotencyKey">, string | undefined] {
  const { idempotencyKey, ...rest } = input;
  return [rest, idempotencyKey];
}

class ApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RecorderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * One attempt. The timeout covers the whole exchange — headers AND body — so a server that
   * stalls mid-body can't hang the caller. Network/timeout failures throw RecorderError(network).
   */
  private async attempt<T>(method: string, path: string, body: unknown, idempotencyKey: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    let text: string;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "x-aer-sdk": SDK_HEADER,
          "idempotency-key": idempotencyKey,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      text = await res.text();
    } catch {
      // Network failure or timeout. Do not include the cause — it could echo the URL/key.
      throw new RecorderError("network", `Request failed: ${method} ${path}`, 0);
    } finally {
      clearTimeout(timer);
    }

    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      // Proxy HTML, truncated body… Never quote it: an error page can echo the request.
      throw new RecorderError(
        res.ok ? "invalid_response" : "request_failed",
        `HTTP ${res.status}: response was not JSON`,
        res.status,
      );
    }

    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string; request_id?: string } })
        .error;
      throw new RecorderError(
        err?.code ?? "request_failed",
        err?.message ?? `HTTP ${res.status}`,
        res.status,
        err?.request_id,
      );
    }
    return json as T;
  }

  /**
   * One logical operation. Its Idempotency-Key is fixed here, once, and reused by every retry, so
   * a retry after a lost response returns the first result instead of writing twice.
   * Retries: network/timeout (status 0), 5xx, and a 2xx whose body was unreadable. Never 4xx.
   */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey: string = newIdempotencyKey(),
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.attempt<T>(method, path, body, idempotencyKey);
      } catch (err) {
        lastError = err;
        const retryable =
          err instanceof RecorderError &&
          (err.status === 0 || err.status >= 500 || err.code === "invalid_response");
        if (!retryable || attempt === this.maxRetries) throw err;
        await sleep(200 * (attempt + 1));
      }
    }
    throw lastError;
  }
}

/** Apply the recorder's capture policy (if any) and attach the declaration the server records. */
function captured<T extends object>(body: T, capture: CaptureOptions | undefined, failedTitle: string): T {
  if (!capture) return body;
  const { payload, declaration } = applyCapture(
    body,
    capture,
    capturePolicy(SDK_HEADER, capture),
    failedTitle,
  );
  return { ...payload, capture: declaration };
}

/** A live run handle. Emit events, then complete it. */
export class AgentRun {
  constructor(
    private readonly client: ApiClient,
    public readonly id: string,
    private readonly capture?: CaptureOptions,
  ) {}

  async event(input: EventInput): Promise<EventResult> {
    const [event, key] = withoutKey(input);
    const body = captured(event, this.capture, `${input.type} (content withheld: client redaction failed)`);
    const res = await this.client.request<{
      event: { id: string };
      redaction: { findingsCount: number };
    }>("POST", `/api/v1/runs/${this.id}/events`, body, key);
    return { eventId: res.event.id, findingsCount: res.redaction.findingsCount };
  }

  async complete(input: CompleteInput = {}): Promise<void> {
    await this.client.request(
      "POST",
      `/api/v1/runs/${this.id}/complete`,
      { status: input.status ?? "completed", endedAt: input.endedAt },
      input.idempotencyKey,
    );
  }
}

/** Entry point: create a recorder bound to a project (via the API key), then start runs. */
export class AgentEvidenceRecorder {
  private readonly client: ApiClient;
  private readonly environment?: string;
  private readonly capture?: CaptureOptions;

  constructor(options: RecorderOptions) {
    this.client = new ApiClient(options);
    this.environment = options.environment;
    this.capture = options.capture;
  }

  async startRun(input: StartRunInput): Promise<AgentRun> {
    const [run, key] = withoutKey(input);
    const body = captured(run, this.capture, "agent (name withheld: client redaction failed)");
    const res = await this.client.request<{ run: { id: string } }>(
      "POST",
      "/api/v1/runs",
      this.environment === undefined ? body : { ...body, environment: this.environment },
      key,
    );
    return new AgentRun(this.client, res.run.id, this.capture);
  }
}
