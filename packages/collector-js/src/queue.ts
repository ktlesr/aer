// Delivery queue: ordered, bounded, never silent. Every write after startRun goes through it, so
// awaited (`event`) and background (`enqueue`) items keep the order they were made in.
//
// - One item in flight at a time (FIFO): the server assigns seq in arrival order, so this IS the
//   evidence chain order. ponytail: head-of-line blocking — a retrying item delays later ones;
//   per-run lanes if throughput across many concurrent runs ever matters.
// - Bounded by items, bytes and per-item age. Full → `throw` (default) or `wait` (backpressure).
//   Nothing is ever dropped silently: an item either lands, or fails visibly (hook + counters +
//   the awaiting promise rejects + complete() refuses to seal that run).
// - Items hold only what is sent: capture-filtered body + Idempotency-Key. Never the API key.

/** Error shape the queue needs from the transport (see RecorderError). */
export interface DeliveryError extends Error {
  code: string;
  status: number;
  retryAfterMs?: number;
}

export interface QueueItem {
  id: string;
  kind: "event" | "complete";
  runId: string;
  path: string;
  body: unknown;
  idempotencyKey: string;
  enqueuedAt: number;
  /** Background items retry until maxItemAgeMs; awaited items get one transport pass and report. */
  background: boolean;
}

/** What the optional persistent store keeps. */
export interface QueueState {
  version: 1;
  items: QueueItem[];
  /** Runs with an undelivered background item: complete() will not seal them. */
  failedRuns: string[];
}

/** Optional persistence. Load once at resume(); save after every change. */
export interface QueueStore {
  load(): Promise<QueueState | null>;
  save(state: QueueState): Promise<void>;
}

/** Passed to onDeliveryError — identifiers and the error, never the payload. */
export interface DeliveryFailure {
  kind: QueueItem["kind"];
  runId: string;
  idempotencyKey: string;
  reason: "rejected" | "retry_exhausted" | "undelivered_events" | "closed";
  error: DeliveryError;
}

export interface DeliveryOptions {
  /** Max queued items. Default 1000. */
  maxQueueItems?: number;
  /** Max queued payload size (JSON characters). Default 5_000_000. */
  maxQueueBytes?: number;
  /** A background item that has not landed within this long fails visibly. Default 600_000 (10 min). */
  maxItemAgeMs?: number;
  /** Cap on any single wait between attempts, including a server's Retry-After. Default 30_000. */
  maxRetryDelayMs?: number;
  /** When the queue is full: `throw` (default, QueueFullError) or `wait` until there is room. */
  whenFull?: "throw" | "wait";
  /** Optional persistence (Node: `fileQueueStore` from "@ktlsr/collector-js/file-store"). */
  store?: QueueStore;
  /** Called for every item that will never be delivered. Must not throw. */
  onDeliveryError?: (failure: DeliveryFailure) => void;
}

export interface QueueStats {
  queued: number;
  queuedBytes: number;
  delivered: number;
  failed: number;
  retries: number;
  /** Store saves that failed after delivery (the item may be redelivered after a restart — a replay). */
  storeErrors: number;
}

export interface FlushResult {
  delivered: number;
  failed: number;
  /** Still queued when flush gave up (timeout). In memory they are lost on exit unless a store is set. */
  pending: number;
  /**
   * Store saves still running when a timed flush/shutdown returned. Non-zero after a timed
   * shutdown: a save may still land — don't open another recorder on the same store until the
   * process exits or a later flush reports 0. An untimed shutdown() always waits them out.
   */
  checkpointsPending: number;
}

interface Waiter {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}


export class DeliveryQueue {
  private items: QueueItem[] = [];
  private bytes = 0;
  private readonly sizes = new Map<string, number>();
  private readonly waiters = new Map<string, Waiter>();
  private readonly failedRuns = new Set<string>();
  private readonly spaceWaiters: Array<() => void> = [];
  private readonly idleWaiters: Array<() => void> = [];
  private running = false;
  private closed = false;
  /** With a store, nothing is written until it was loaded: a failed load must never be overwritten. */
  private loaded: boolean;
  /** The one load of the store (explicit resume() or implicitly on the first write). */
  private loadPromise?: Promise<number>;
  /** Places taken by adds whose save is still in progress (counted against the limits). */
  private reserved = 0;
  /** add() calls between their first check and their outcome (loading, waiting, saving). */
  private inflightAdds = 0;
  /** Store saves started and not yet finished. shutdown() never returns while one is running. */
  private pendingSaves = 0;
  /** A store load (explicit resume() or implicit) is in progress. */
  private loading = false;
  /** Saves run one at a time, each with a snapshot taken when it runs. */
  private saveChain: Promise<void> = Promise.resolve();
  /** Aborted by shutdown: cancels the transport's own retry waits and the request in flight. */
  private readonly stopCtl = new AbortController();
  /** Set after shutdown's flush window: the worker stops and leaves the rest where it is. */
  private stopped = false;
  /** Cancels the current between-attempts wait (used by shutdown so exit isn't held by a timer). */
  private wake?: () => void;
  private counters = { delivered: 0, failed: 0, retries: 0, storeErrors: 0 };
  private readonly o: Required<Omit<DeliveryOptions, "store" | "onDeliveryError">> & DeliveryOptions;

  constructor(
    options: DeliveryOptions,
    /** One transport pass (the client's own quick retries included); must stop when `signal` aborts. */
    private readonly send: (item: QueueItem, signal: AbortSignal) => Promise<unknown>,
    private readonly isRetryable: (e: unknown) => e is DeliveryError,
    private readonly makeError: (code: string, message: string) => DeliveryError,
  ) {
    this.o = {
      maxQueueItems: 1000,
      maxQueueBytes: 5_000_000,
      maxItemAgeMs: 600_000,
      maxRetryDelayMs: 30_000,
      whenFull: "throw",
      ...options,
    };
    this.loaded = !options.store;
  }

  stats(): QueueStats {
    return { queued: this.items.length, queuedBytes: this.bytes, ...this.counters };
  }

  hasUndelivered(runId: string): boolean {
    return this.failedRuns.has(runId);
  }

  /**
   * Load persisted items (same Idempotency-Keys) and start delivering them. Returns how many.
   * Happens once: the first write does it implicitly. If it fails, this queue refuses every write
   * and never saves — the damaged file stays as it is until someone deals with it (and a new
   * recorder is created).
   */
  resume(): Promise<number> {
    if (!this.o.store) return Promise.resolve(0);
    if (!this.loadPromise) {
      this.loading = true;
      this.loadPromise = this.load(this.o.store).finally(() => {
        this.loading = false;
        this.notifyIdle();
      });
    }
    return this.loadPromise;
  }

  private async load(store: QueueStore): Promise<number> {
    const state = await store.load();
    // Validate EVERYTHING before touching memory or `loaded`: a structurally damaged state must
    // leave the queue refusing writes, exactly like unreadable JSON.
    const invalid = invalidState(state);
    if (invalid) throw new Error(`Queue store state is invalid (${invalid}); it was left untouched`);
    this.loaded = true;
    if (!state) return 0;
    for (const r of state.failedRuns) this.failedRuns.add(r);
    const known = new Set(this.items.map((i) => i.id));
    for (const item of state.items) {
      if (known.has(item.id)) continue;
      this.items.push(item);
      this.track(item);
    }
    this.kick();
    return state.items.length;
  }

  /** Add an item. Resolves once it is queued (and persisted, if a store is set); `settled` resolves on delivery. */
  async add(item: QueueItem): Promise<{ settled: Promise<unknown> }> {
    if (this.closed) throw this.makeError("recorder_closed", "Recorder is shut down; nothing was queued");
    // Counted by flush()/shutdown(): an add that is loading or saving is pending work, not nothing.
    this.inflightAdds++;
    try {
      return await this.admit(item);
    } finally {
      this.inflightAdds--;
      this.notifyIdle();
    }
  }

  private async admit(item: QueueItem): Promise<{ settled: Promise<unknown> }> {
    if (!this.loaded) {
      try {
        await this.resume();
      } catch {
        throw this.makeError("store_not_loaded", "Queue store could not be loaded; nothing was queued and the store was left untouched");
      }
      // Shut down while loading: refuse rather than queue into a stopped recorder.
      if (this.closed) throw this.makeError("recorder_closed", "Recorder is shut down; nothing was queued");
    }
    const size = JSON.stringify(item.body ?? null).length;
    if (size > this.o.maxQueueBytes) throw this.makeError("queue_full", "Item larger than maxQueueBytes; nothing was queued");
    while (this.items.length + this.reserved >= this.o.maxQueueItems || this.bytes + size > this.o.maxQueueBytes) {
      if (this.o.whenFull === "throw") throw this.makeError("queue_full", "Delivery queue is full; nothing was queued");
      await new Promise<void>((r) => this.spaceWaiters.push(r));
      if (this.closed) throw this.makeError("recorder_closed", "Recorder is shut down; nothing was queued");
    }
    // Reserve, persist WITH the item, and only then make it deliverable. A failed save leaves no
    // trace: not in memory, not on disk (saves are atomic, and other saves never include it).
    this.reserved++;
    this.track(item, size);
    try {
      await this.persist([item]);
    } catch {
      this.untrack(item);
      throw this.makeError("store_failed", "Queue store could not save; nothing was queued");
    } finally {
      this.reserved--;
    }
    const settled = new Promise<unknown>((resolve, reject) => this.waiters.set(item.id, { resolve, reject }));
    // An unawaited background item must not surface as an unhandled rejection; failures are
    // reported through the hook and counters instead.
    settled.catch(() => undefined);
    this.items.push(item);
    if (this.stopped) {
      // Shutdown finished while this save was in flight: the item IS durable (it was saved), so the
      // write succeeded — it waits on disk for resume(). Nobody may wait on its delivery here.
      this.releaseWaiter(item, "Recorder shut down before delivery; the item is persisted for resume()");
    } else this.kick();
    return { settled };
  }

  /**
   * Work that can still finish. After shutdown the worker is stopped, so queued (persisted) items
   * are no longer "in progress" — waiting for them would never end; they are reported as pending.
   */
  private busy(): boolean {
    const queuedWork = this.items.length > 0 && !this.stopped;
    return this.running || queuedWork || this.inflightAdds > 0 || this.pendingSaves > 0 || this.loading;
  }

  private notifyIdle(): void {
    if (!this.busy()) for (const w of this.idleWaiters.splice(0)) w();
  }

  /** Reject a caller still awaiting delivery of an item that stays queued (persisted) after shutdown. */
  private releaseWaiter(item: QueueItem, message: string): void {
    this.waiters.get(item.id)?.reject(this.makeError("recorder_closed", message));
    this.waiters.delete(item.id);
  }

  /** Wait until the queue is empty or `timeoutMs` passes. Never throws. */
  async flush(timeoutMs?: number): Promise<FlushResult> {
    const before = { ...this.counters };
    if (this.busy()) {
      const idle = new Promise<void>((r) => this.idleWaiters.push(r));
      if (timeoutMs === undefined) await idle;
      else {
        let t: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([idle, new Promise<void>((r) => (t = setTimeout(r, timeoutMs)))]);
        clearTimeout(t); // a drained queue must not leave a timer holding the process open
      }
    }
    return {
      delivered: this.counters.delivered - before.delivered,
      failed: this.counters.failed - before.failed,
      // A load still running counts as pending work: it may bring persisted items back.
      pending: this.items.length + this.inflightAdds + (this.loading ? 1 : 0),
      checkpointsPending: this.pendingSaves,
    };
  }

  /** Stop accepting, deliver what can be delivered within `timeoutMs`, report the rest. */
  async shutdown(timeoutMs?: number): Promise<FlushResult> {
    this.closed = true;
    for (const w of this.spaceWaiters.splice(0)) w();
    const result = await this.flush(timeoutMs);
    this.stopped = true;
    this.stopCtl.abort();
    this.wake?.();
    if (result.pending > 0 && !this.o.store) {
      // In memory only: these cannot survive the process. Say so, per item, instead of vanishing.
      for (const item of this.items.splice(0)) {
        this.untrack(item);
        this.fail(item, "closed", this.makeError("recorder_closed", "Shut down before delivery; item not persisted"));
      }
    } else {
      // Persisted for resume(): an awaiting event()/complete() gets a definite answer, not a hang.
      for (const item of this.items) this.releaseWaiter(item, "Recorder shut down before delivery; the item is persisted for resume()");
    }
    // Untimed: every save that started is awaited, so no write of this recorder can land after
    // shutdown() returned (and erase a later owner's state). Timed: the deadline wins and any save
    // still running is reported in checkpointsPending instead of being waited for.
    if (timeoutMs === undefined) {
      await this.saveChain;
      return { ...result, checkpointsPending: 0 };
    }
    return { ...result, checkpointsPending: this.pendingSaves };
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Aborts when the recorder is shut down — shared with requests made outside the queue (startRun). */
  get stopSignal(): AbortSignal {
    return this.stopCtl.signal;
  }

  private track(item: QueueItem, size = JSON.stringify(item.body ?? null).length): void {
    this.sizes.set(item.id, size);
    this.bytes += size;
  }

  private untrack(item: QueueItem): void {
    this.bytes -= this.sizes.get(item.id) ?? 0;
    this.sizes.delete(item.id);
    for (const w of this.spaceWaiters.splice(0)) w();
  }

  /** Serialised save; the snapshot is taken when the save runs. `extra` = an add not yet deliverable. */
  private persist(extra: QueueItem[] = []): Promise<void> {
    const store = this.o.store;
    if (!store || !this.loaded) return Promise.resolve();
    this.pendingSaves++;
    const p = this.saveChain
      .then(() => store.save({ version: 1, items: [...this.items, ...extra], failedRuns: [...this.failedRuns] }))
      .finally(() => {
        this.pendingSaves--;
        this.notifyIdle();
      });
    this.saveChain = p.catch(() => undefined);
    return p;
  }

  private kick(): void {
    if (!this.running) void this.run();
  }

  private fail(item: QueueItem, reason: DeliveryFailure["reason"], error: DeliveryError): void {
    this.counters.failed++;
    // Only an awaited event() whose caller is still waiting has been told. Background items, and
    // items restored from a previous process (their caller is gone), leave the run incomplete.
    const told = !item.background && this.waiters.has(item.id);
    if (item.kind === "event" && !told) this.failedRuns.add(item.runId);
    this.waiters.get(item.id)?.reject(error);
    this.waiters.delete(item.id);
    try {
      this.o.onDeliveryError?.({ kind: item.kind, runId: item.runId, idempotencyKey: item.idempotencyKey, reason, error });
    } catch {
      // A throwing hook must not stop delivery of everything else.
    }
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      while (this.items.length > 0 && !this.stopped) {
        const item = this.items[0];
        let outcome: { ok: true; value: unknown } | { ok: false; reason: DeliveryFailure["reason"]; error: DeliveryError };
        if (item.kind === "complete" && this.failedRuns.has(item.runId)) {
          outcome = {
            ok: false,
            reason: "undelivered_events",
            error: this.makeError("undelivered_events", "Run has events that were never delivered; it was not sealed"),
          };
        } else {
          outcome = await this.deliver(item);
        }
        // Stopped mid-retry: leave the item queued (persisted, if a store is set) — not failed.
        if (this.stopped && !outcome.ok && outcome.reason === "closed") break;
        // Already reported and removed by shutdown() while in flight (it may still have landed —
        // the conservative report stands; a retry with the same key would be a replay).
        if (this.items[0] !== item) break;
        this.items.shift();
        this.untrack(item);
        if (outcome.ok) {
          this.counters.delivered++;
          this.waiters.get(item.id)?.resolve(outcome.value);
          this.waiters.delete(item.id);
        } else {
          this.fail(item, outcome.reason, outcome.error);
        }
        try {
          await this.persist();
        } catch {
          // The item is settled in memory; on disk it may linger and be resent after a restart —
          // with its Idempotency-Key, i.e. a replay. Counted, not fatal.
          this.counters.storeErrors++;
        }
      }
    } finally {
      this.running = false;
      this.notifyIdle();
    }
  }

  /** Retry a background item with backoff (Retry-After honoured, capped) until its age limit. */
  private async deliver(
    item: QueueItem,
  ): Promise<{ ok: true; value: unknown } | { ok: false; reason: DeliveryFailure["reason"]; error: DeliveryError }> {
    for (let attempt = 0; ; attempt++) {
      try {
        return { ok: true, value: await this.send(item, this.stopCtl.signal) };
      } catch (err) {
        if (this.stopped) {
          // Shut down mid-request: whether it landed is unknown — keep it (store: resent with the
          // same key → replay at worst) or report it (no store). Never counted as a server answer.
          return { ok: false, reason: "closed", error: this.makeError("recorder_closed", "Shut down during delivery") };
        }
        const retryable = this.isRetryable(err);
        const error = (retryable || isDeliveryError(err) ? err : this.makeError("request_failed", "Delivery failed")) as DeliveryError;
        if (!retryable) return { ok: false, reason: "rejected", error };
        const delay = Math.min(error.retryAfterMs ?? 500 * 2 ** Math.min(attempt, 6), this.o.maxRetryDelayMs);
        if (!item.background || Date.now() + delay - item.enqueuedAt > this.o.maxItemAgeMs) {
          return { ok: false, reason: "retry_exhausted", error };
        }
        this.counters.retries++;
        // Deliberately NOT unref'd: pending retries keep the process alive (up to maxItemAgeMs) so
        // an exit can't quietly drop queued evidence. shutdown(timeoutMs) bounds it and wakes this.
        await new Promise<void>((r) => {
          const t = setTimeout(r, delay);
          this.wake = () => {
            clearTimeout(t);
            r();
          };
        });
        this.wake = undefined;
        if (this.stopped) return { ok: false, reason: "closed", error };
      }
    }
  }
}

function isDeliveryError(e: unknown): e is DeliveryError {
  return e instanceof Error && typeof (e as DeliveryError).code === "string" && typeof (e as DeliveryError).status === "number";
}

/** Structural check of a loaded state; returns what is wrong, or null. Never echoes contents. */
function invalidState(state: unknown): string | null {
  if (state === null) return null;
  if (typeof state !== "object" || Array.isArray(state)) return "not an object";
  const st = state as Partial<QueueState>;
  if (st.version !== 1) return "unknown version";
  if (!Array.isArray(st.items) || !Array.isArray(st.failedRuns)) return "items/failedRuns missing";
  if (!st.failedRuns.every((r) => typeof r === "string")) return "failedRuns entry is not a string";
  const ids = new Set<string>();
  for (let i = 0; i < st.items.length; i++) {
    const it = st.items[i] as Partial<QueueItem> | null;
    const ok =
      !!it && typeof it === "object" &&
      typeof it.id === "string" && it.id.length > 0 && !ids.has(it.id) &&
      (it.kind === "event" || it.kind === "complete") &&
      typeof it.runId === "string" && it.runId.length > 0 &&
      typeof it.path === "string" && it.path.startsWith(`/api/v1/runs/${it.runId}/`) &&
      typeof it.idempotencyKey === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(it.idempotencyKey) &&
      typeof it.enqueuedAt === "number" && Number.isFinite(it.enqueuedAt) &&
      typeof it.background === "boolean" &&
      "body" in it;
    if (!ok) return `items[${i}] is malformed`;
    ids.add(it!.id as string);
  }
  return null;
}
