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

class ApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RecorderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

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
