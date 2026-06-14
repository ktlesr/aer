// collector-js — Agent Evidence Recorder collector SDK.
// Small, dependency-light client over the v1 API. Uses the global fetch (Node 18+).

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

export interface RecorderOptions {
  /** Base URL of the AER web app, e.g. http://localhost:3000 */
  baseUrl: string;
  /** Bearer API key. Sent as Authorization: Bearer <apiKey>; never logged by this SDK. */
  apiKey: string;
  /** Per-request timeout in ms (via AbortController). Default 10000. */
  timeoutMs?: number;
  /** Max retries on network error or 5xx (never on 4xx). Default 2. */
  maxRetries?: number;
  /** Override fetch (for tests). Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface StartRunInput {
  agentName: string;
  riskLevel?: RiskLevel;
  metadata?: Record<string, unknown>;
}

export interface EventInput {
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

  /** One attempt with an AbortController timeout. Network/timeout failures throw RecorderError(network). */
  private async attempt<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch {
      // Network failure or timeout. Do not include the cause — it could echo the URL/key.
      throw new RecorderError("network", `Request failed: ${method} ${path}`, 0);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const json = (text ? JSON.parse(text) : {}) as unknown;

    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string; request_id?: string } })
        .error;
      throw new RecorderError(
        err?.code ?? "request_failed",
        err?.message ?? res.statusText,
        res.status,
        err?.request_id,
      );
    }
    return json as T;
  }

  /** Retry on network error / 5xx (max `maxRetries`); never retry on 4xx (a client/auth error). */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.attempt<T>(method, path, body);
      } catch (err) {
        lastError = err;
        const retryable =
          err instanceof RecorderError && (err.status === 0 || err.status >= 500);
        if (!retryable || attempt === this.maxRetries) throw err;
        await sleep(200 * (attempt + 1));
      }
    }
    throw lastError;
  }
}

/** A live run handle. Emit events, then complete it. */
export class AgentRun {
  constructor(
    private readonly client: ApiClient,
    public readonly id: string,
  ) {}

  async event(input: EventInput): Promise<EventResult> {
    const res = await this.client.request<{
      event: { id: string };
      redaction: { findingsCount: number };
    }>("POST", `/api/v1/runs/${this.id}/events`, input);
    return { eventId: res.event.id, findingsCount: res.redaction.findingsCount };
  }

  async complete(input: CompleteInput = {}): Promise<void> {
    await this.client.request("POST", `/api/v1/runs/${this.id}/complete`, {
      status: input.status ?? "completed",
      endedAt: input.endedAt,
    });
  }
}

/** Entry point: create a recorder bound to a project (via the API key), then start runs. */
export class AgentEvidenceRecorder {
  private readonly client: ApiClient;

  constructor(options: RecorderOptions) {
    this.client = new ApiClient(options);
  }

  async startRun(input: StartRunInput): Promise<AgentRun> {
    const res = await this.client.request<{ run: { id: string } }>(
      "POST",
      "/api/v1/runs",
      input,
    );
    return new AgentRun(this.client, res.run.id);
  }
}
