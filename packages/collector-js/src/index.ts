// collector-js — Agent Evidence Recorder collector SDK.
// Small, dependency-light client over the v1 API. Uses the global fetch (Node 18+).
import { applyCapture, capturePolicy, type CaptureOptions } from "./capture.js";
import { DeliveryQueue, type DeliveryOptions, type FlushResult, type QueueItem, type QueueStats } from "./queue.js";

export type { CaptureDeclaration, CaptureMode, CaptureOptions, CapturePayload } from "./capture.js";
export type {
  DeliveryFailure,
  DeliveryOptions,
  FlushResult,
  QueueItem,
  QueueState,
  QueueStats,
  QueueStore,
} from "./queue.js";

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
export const SDK_VERSION = "0.6.0";

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
  /**
   * Quick retries per request on network error/timeout, 408, 429 or 5xx (never other 4xx).
   * Default 2. Waits honour Retry-After, capped by `delivery.maxRetryDelayMs`.
   */
  maxRetries?: number;
  /** Override fetch (for tests). Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Client-side capture policy, applied before anything is sent. Omitted = `full` (send as
   * given; the server still redacts). See CaptureOptions.
   */
  capture?: CaptureOptions;
  /**
   * Ordering, limits and persistence for writes after startRun (see DeliveryOptions). Defaults:
   * in memory, 1000 items / 5 MB, background items retried up to 10 minutes, full → throw.
   */
  delivery?: DeliveryOptions;
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
  /** Your conversation/turn identifiers (1–200 chars of A-Z a-z 0-9 . _ : -), not text. */
  conversationRef?: string;
  turnRef?: string;
  /** The AER run id of the previous step. Shown as `missing_context` if it no longer exists. */
  parentRunId?: string;
}

/** One source document/chunk. `contentHash` needs `hashScope`; `score` needs `scoreMethod`. */
export interface SourceRef {
  id: string;
  version?: string;
  title?: string;
  /** `sha256:<64 lowercase hex>` over the bytes named by `hashScope` (e.g. "chunk_text_utf8"). */
  contentHash?: string;
  hashScope?: string;
  /** Opaque pointer into your archive. Never a signed URL — query strings are rejected. */
  archiveRef?: string;
  /** A retriever's own number — not a probability, not comparable across methods. */
  score?: number;
  scoreMethod?: string;
}

/**
 * Sourced-assistant evidence (profile v1). Send what you actually have; anything left out is
 * shown as "not recorded" — never guessed. Do not put model reasoning/chain-of-thought here.
 */
export interface SourcedEvidence {
  profile: "sourced_assistant";
  version: 1;
  context?: {
    /** Only context the answer actually used, each with where it came from. */
    used?: Array<{
      key: string;
      value: string | number | boolean;
      origin: "user_stated" | "previous_turn" | "retrieved" | "inferred" | "system";
      fromTurnRef?: string;
    }>;
    /** Context you knew you needed but did not have. */
    missing?: string[];
  };
  /** Candidates retrieval returned. */
  retrievedSources?: SourceRef[];
  /** Sources the answer presents as support. */
  citedSources?: SourceRef[];
  /** Claim → ids from `citedSources`; `assessed` requires `assessment`. */
  claimSourceLinks?: Array<{ claim: string; sourceIds: string[]; basis: "model_declared" | "assessed" }>;
  assessment?: { method: string; version: string; result: string };
  generation?: {
    provider?: string;
    model?: string;
    promptTemplateVersion?: string;
    appVersion?: string;
    providerRequestId?: string;
  };
  /** Your clock; AER records its own receive time separately. */
  timing?: { clientStartedAt?: string; clientEndedAt?: string };
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
  sourced?: SourcedEvidence;
}

export interface CompleteInput {
  idempotencyKey?: string;
  status?: "completed" | "failed";
  endedAt?: string;
}

/**
 * What AER states when it seals a run: the run manifest hash (binding events, run context and
 * versions), chain head and event count — optionally Ed25519-signed by the server. Store it
 * yourself (outside AER): `aer-verify packet.json --receipt receipt.json` then detects a packet
 * that was rewritten later, even if it was fully recomputed. `issued_at` is AER's clock.
 * Null from servers older than run manifests.
 */
export interface Receipt {
  statement: {
    receipt_version: string;
    run_id: string;
    organization_id: string;
    project_id: string;
    manifest_version: string;
    manifest_hash: string;
    chain_head: string;
    event_count: number;
    issued_at: string;
    clock: string;
  };
  signature: { alg: "Ed25519"; key_id: string; value: string } | null;
}

export interface CompleteResult {
  receipt: Receipt | null;
}

export interface EventResult {
  eventId: string;
  findingsCount: number;
  /**
   * False when you sent `sourced` but the server did not store it (an AER server older than
   * this profile ignores unknown fields). Undefined when nothing was sent.
   */
  sourcedStored?: boolean;
}

export class RecorderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
    /** From a 429/503 Retry-After header, in ms. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RecorderError";
  }
}

/**
 * Worth retrying with the same Idempotency-Key: the server may not have seen the request
 * (network/timeout), is overloaded (408, 429, 5xx), or the response was unreadable. Any other
 * 4xx (401, 404, 409, 422…) will fail the same way again.
 */
export function isRetryable(e: unknown): e is RecorderError {
  return (
    e instanceof RecorderError &&
    (e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500 || e.code === "invalid_response")
  );
}

/** Retry-After: delta-seconds or an HTTP date. Unparseable → undefined (own backoff applies). */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** Wait `ms`, or until `stop` aborts — then the timer is cleared so it can't hold the process open. */
const sleep = (ms: number, stop?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (stop?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      stop?.removeEventListener("abort", done);
      resolve();
    }
    stop?.addEventListener("abort", done, { once: true });
  });

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
  private readonly maxRetryDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RecorderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.maxRetryDelayMs = options.delivery?.maxRetryDelayMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * One attempt. The timeout covers the whole exchange — headers AND body — so a server that
   * stalls mid-body can't hang the caller. Network/timeout failures throw RecorderError(network).
   */
  private async attempt<T>(method: string, path: string, body: unknown, idempotencyKey: string, stop?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onStop = () => controller.abort();
    stop?.addEventListener("abort", onStop, { once: true });
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
      stop?.removeEventListener("abort", onStop);
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
        retryAfterMs(res.headers.get("retry-after")),
      );
    }
    return json as T;
  }

  /**
   * One logical operation. Its Idempotency-Key is fixed here, once, and reused by every retry, so
   * a retry after a lost response returns the first result instead of writing twice.
   * Retries (isRetryable): network/timeout, 408, 429, 5xx, unreadable 2xx — never other 4xx.
   * Bounded: maxRetries attempts, each wait ≤ maxRetryDelayMs even if Retry-After asks for more.
   */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey: string = newIdempotencyKey(),
    /** Aborts the request in flight and any wait between attempts (recorder shutdown). */
    stop?: AbortSignal,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (stop?.aborted) throw new RecorderError("recorder_closed", "Recorder shut down", 0);
      try {
        return await this.attempt<T>(method, path, body, idempotencyKey, stop);
      } catch (err) {
        lastError = err;
        if (!isRetryable(err) || attempt === this.maxRetries) throw err;
        await sleep(Math.min(err.retryAfterMs ?? 200 * (attempt + 1), this.maxRetryDelayMs), stop);
      }
    }
    throw lastError;
  }
}

/** Apply the recorder's capture policy (if any) and attach the declaration the server records. */
function captured<T extends object>(body: T, capture: CaptureOptions | undefined, generic: string): T {
  if (!capture) return body;
  const { payload, declaration } = applyCapture(
    body,
    capture,
    capturePolicy(SDK_HEADER, capture),
    generic,
  );
  return { ...payload, capture: declaration };
}

/** A live run handle. Emit events, then complete it. */
export class AgentRun {
  constructor(
    private readonly queue: DeliveryQueue,
    public readonly id: string,
    private readonly capture?: CaptureOptions,
    /** False when lineage refs were sent but the server did not store them (older server). */
    public readonly lineageStored?: boolean,
  ) {}

  private item(kind: QueueItem["kind"], path: string, body: unknown, key: string | undefined, background: boolean): QueueItem {
    return {
      id: newIdempotencyKey(),
      kind,
      runId: this.id,
      path,
      body,
      idempotencyKey: key ?? newIdempotencyKey(),
      enqueuedAt: Date.now(),
      background,
    };
  }

  /**
   * Record an event and wait until AER has accepted it (in order, after anything queued before).
   * Throws if it cannot be delivered — use this for steps that must not proceed unrecorded.
   */
  async event(input: EventInput): Promise<EventResult> {
    const [event, key] = withoutKey(input);
    const body = captured(event, this.capture, input.type);
    const { settled } = await this.queue.add(this.item("event", `/api/v1/runs/${this.id}/events`, body, key, false));
    const res = (await settled) as { event: { id: string; sourcedStored?: boolean }; redaction: { findingsCount: number } };
    const result: EventResult = { eventId: res.event.id, findingsCount: res.redaction.findingsCount };
    if ((body as { sourced?: unknown }).sourced !== undefined) result.sourcedStored = res.event.sourcedStored === true;
    return result;
  }

  /**
   * Queue an event for background delivery and return as soon as it is queued (and persisted, with
   * a store). Capture policy is applied before queueing. Delivery is retried within the limits;
   * an event that never lands is reported (onDeliveryError, stats) and blocks complete() for this
   * run. Throws `queue_full` (or waits, with whenFull: "wait") when the queue is at its limits.
   */
  async enqueue(input: EventInput): Promise<{ idempotencyKey: string }> {
    const [event, key] = withoutKey(input);
    const body = captured(event, this.capture, input.type);
    const item = this.item("event", `/api/v1/runs/${this.id}/events`, body, key, true);
    await this.queue.add(item);
    return { idempotencyKey: item.idempotencyKey };
  }

  /**
   * Seal the run, after everything queued before it. Refuses (`undelivered_events`, nothing sent)
   * when an event queued with enqueue() for this run was never delivered: an incomplete run is
   * never presented as complete. Keep the returned receipt somewhere you control.
   */
  async complete(input: CompleteInput = {}): Promise<CompleteResult> {
    const body = { status: input.status ?? "completed", endedAt: input.endedAt };
    const { settled } = await this.queue.add(this.item("complete", `/api/v1/runs/${this.id}/complete`, body, input.idempotencyKey, false));
    const res = (await settled) as { receipt?: Receipt | null };
    return { receipt: res?.receipt ?? null };
  }
}

/** Entry point: create a recorder bound to a project (via the API key), then start runs. */
export class AgentEvidenceRecorder {
  private readonly client: ApiClient;
  private readonly queue: DeliveryQueue;
  private readonly environment?: string;
  private readonly capture?: CaptureOptions;

  constructor(options: RecorderOptions) {
    // A store writes queued bodies to disk BEFORE the server redacts them. So with a store the
    // client policy defaults to redacted_content (declared to the server as such), and an explicit
    // "full" is refused — raw passwords/tokens must not reach the disk by default or by accident.
    if (options.delivery?.store && options.capture?.mode === "full") {
      throw new Error('delivery.store cannot be combined with capture.mode "full": queued bodies are written to disk before server redaction');
    }
    this.client = new ApiClient(options);
    this.environment = options.environment;
    this.capture = options.capture ?? (options.delivery?.store ? { mode: "redacted_content" } : undefined);
    this.queue = new DeliveryQueue(
      options.delivery ?? {},
      (item, signal) => this.client.request("POST", item.path, item.body, item.idempotencyKey, signal),
      isRetryable,
      (code, message) => new RecorderError(code, message, 0),
    );
  }

  /** Delivery counters: queued items/bytes, delivered, failed, retries. */
  stats(): QueueStats {
    return this.queue.stats();
  }

  /** Wait for the queue to drain (or `timeoutMs`). Reports what is still pending; never throws. */
  flush(timeoutMs?: number): Promise<FlushResult> {
    return this.queue.flush(timeoutMs);
  }

  /**
   * Stop accepting writes and deliver what can be delivered within `timeoutMs`. Without a store,
   * anything still pending is reported as failed (onDeliveryError) — it cannot outlive the process.
   * With a store it stays persisted for resume(). Call before the process exits.
   */
  shutdown(timeoutMs?: number): Promise<FlushResult> {
    return this.queue.shutdown(timeoutMs);
  }

  /** Load items a previous process persisted and deliver them with their original Idempotency-Keys. */
  resume(): Promise<number> {
    return this.queue.resume();
  }

  async startRun(input: StartRunInput): Promise<AgentRun> {
    // A shut-down recorder sends nothing — startRun included (it does not go through the queue).
    if (this.queue.isClosed) throw new RecorderError("recorder_closed", "Recorder is shut down; no run was started", 0);
    const [run, key] = withoutKey(input);
    const body = captured(run, this.capture, "agent");
    const res = await this.client.request<{ run: { id: string } & Record<string, unknown> }>(
      "POST",
      "/api/v1/runs",
      this.environment === undefined ? body : { ...body, environment: this.environment },
      key,
      this.queue.stopSignal,
    );
    const sent = body as Record<string, unknown>;
    const refs = (["conversationRef", "turnRef", "parentRunId"] as const).filter((k) => sent[k] !== undefined);
    const lineageStored = refs.length ? refs.every((k) => res.run[k] === sent[k]) : undefined;
    return new AgentRun(this.queue, res.run.id, this.capture, lineageStored);
  }
}
