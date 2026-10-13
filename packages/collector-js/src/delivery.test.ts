// Stage 5: delivery queue, limits, 429/Retry-After, shutdown, persistence across a restart.
// The fake server dedupes on Idempotency-Key like the real API, so "created twice" is observable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentEvidenceRecorder, RecorderError, type DeliveryFailure, type DeliveryOptions } from "./index.js";
import { fileQueueStore } from "./file-store.js";

type Mode = { status: number; headers?: Record<string, string>; commitThenDrop?: boolean } | "network";

/** A tiny AER: runs, events (seq in arrival order), complete; replays by Idempotency-Key. */
function fakeAer() {
  const byKey = new Map<string, { status: number; body: unknown }>();
  const events: Array<{ runId: string; title: string; seq: number; key: string }> = [];
  const completes: string[] = [];
  const attempts: string[] = [];
  let next: Mode[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const key = (init?.headers as Record<string, string>)["idempotency-key"];
    const path = new URL(String(url)).pathname;
    attempts.push(`${path} ${key}`);
    const mode = next.shift();
    if (mode === "network") throw new TypeError("connect ECONNREFUSED");
    if (mode && !mode.commitThenDrop) {
      return new Response(JSON.stringify({ error: { code: "x", message: "synthetic", request_id: "r" } }), { status: mode.status, headers: mode.headers });
    }
    let stored = byKey.get(key);
    if (!stored) {
      const body = JSON.parse(String(init?.body));
      const m = /^\/api\/v1\/runs\/([^/]+)\/(events|complete)$/.exec(path);
      if (!m) stored = { status: 201, body: { run: { id: `run_${byKey.size + 1}` } } };
      else if (m[2] === "events") {
        const seq = events.filter((e) => e.runId === m[1]).length + 1;
        events.push({ runId: m[1], title: body.title, seq, key });
        stored = { status: 201, body: { event: { id: `evt_${events.length}` }, redaction: { findingsCount: 0 } } };
      } else {
        completes.push(m[1]);
        stored = { status: 200, body: { run: { id: m[1] }, receipt: null } };
      }
      byKey.set(key, stored);
    }
    if (mode?.commitThenDrop) throw new TypeError("socket hang up"); // committed, response lost
    return new Response(JSON.stringify(stored.body), { status: stored.status });
  }) as typeof fetch;
  return {
    fetchImpl,
    events,
    completes,
    attempts,
    fail: (...modes: Mode[]) => (next = modes),
  };
}

const rec = (aer: ReturnType<typeof fakeAer>, delivery: DeliveryOptions = {}, maxRetries = 0) =>
  new AgentEvidenceRecorder({ baseUrl: "http://aer.test", apiKey: "aer_synthetic_key_never_persisted", fetchImpl: aer.fetchImpl, maxRetries, delivery });

test("429 with Retry-After is retried with the same key; the wait is capped", async () => {
  const aer = fakeAer();
  const r = rec(aer, { maxRetryDelayMs: 40 }, 2);
  const run = await r.startRun({ agentName: "a" });
  aer.fail({ status: 429, headers: { "retry-after": "120" } });
  const t = Date.now();
  await run.event({ type: "tool_call", title: "one" });
  assert.ok(Date.now() - t < 1000, "Retry-After 120s must be capped by maxRetryDelayMs");
  const keys = aer.attempts.slice(1).map((a) => a.split(" ")[1]);
  assert.equal(keys.length, 2);
  assert.equal(new Set(keys).size, 1);
});

test("retries are bounded: a server that keeps failing ends in a visible error, not a loop", async () => {
  const aer = fakeAer();
  const r = rec(aer, { maxRetryDelayMs: 1 }, 3);
  const run = await r.startRun({ agentName: "a" });
  aer.fail({ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }, { status: 503 });
  await assert.rejects(run.event({ type: "tool_call", title: "x" }), (e: RecorderError) => e.status === 503);
  assert.equal(aer.attempts.length - 1, 4); // 1 + maxRetries
  assert.equal(aer.events.length, 0);
});

test("a non-retryable 4xx is not retried", async () => {
  const aer = fakeAer();
  const run = await rec(aer, {}, 3).startRun({ agentName: "a" });
  aer.fail({ status: 422 });
  await assert.rejects(run.event({ type: "tool_call", title: "x" }), (e: RecorderError) => e.status === 422);
  assert.equal(aer.attempts.length - 1, 1);
});

test("enqueue() returns while AER is down; delivery resumes in call order, each event once", async () => {
  const aer = fakeAer();
  const r = rec(aer, { maxRetryDelayMs: 5 });
  const run = await r.startRun({ agentName: "a" });
  aer.fail("network", "network", { status: 502 }, { status: 500, commitThenDrop: true });
  await run.enqueue({ type: "tool_call", title: "1" });
  await run.enqueue({ type: "tool_call", title: "2" });
  const third = run.event({ type: "tool_call", title: "3" }); // awaited, but behind the queued ones
  await run.enqueue({ type: "tool_call", title: "4" });
  await third;
  const f = await r.flush(2000);
  assert.deepEqual(f, { delivered: 1, failed: 0, pending: 0, checkpointsPending: 0 });
  assert.deepEqual(aer.events.map((e) => [e.title, e.seq]), [["1", 1], ["2", 2], ["3", 3], ["4", 4]]);
  assert.deepEqual(r.stats(), { queued: 0, queuedBytes: 0, delivered: 4, failed: 0, retries: 4, storeErrors: 0 });
});

test("a background event that never lands is reported (no payload) and complete() refuses to seal", async () => {
  const aer = fakeAer();
  const failures: DeliveryFailure[] = [];
  const r = rec(aer, { maxRetryDelayMs: 5, maxItemAgeMs: 30, onDeliveryError: (f) => failures.push(f) });
  const run = await r.startRun({ agentName: "a" });
  aer.fail(...Array.from({ length: 50 }, () => "network" as const));
  await run.enqueue({ type: "tool_call", title: "synthetic-private-title" });
  await r.flush(2000);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, "retry_exhausted");
  assert.ok(!JSON.stringify(failures).includes("synthetic-private-title"));
  aer.fail();
  await assert.rejects(run.complete(), (e: RecorderError) => e.code === "undelivered_events");
  assert.deepEqual(aer.completes, [], "an incomplete run must not be sealed");
  assert.equal(r.stats().failed, 2);
});

test("a rejected (4xx) background event also blocks complete(); other runs are unaffected", async () => {
  const aer = fakeAer();
  const failures: DeliveryFailure[] = [];
  const r = rec(aer, { onDeliveryError: (f) => failures.push(f) });
  const bad = await r.startRun({ agentName: "a" });
  const good = await r.startRun({ agentName: "b" });
  aer.fail({ status: 422 });
  await bad.enqueue({ type: "tool_call", title: "x" });
  await good.enqueue({ type: "tool_call", title: "y" });
  await r.flush(1000);
  assert.equal(failures[0].reason, "rejected");
  await assert.rejects(bad.complete(), (e: RecorderError) => e.code === "undelivered_events");
  await good.complete();
  assert.deepEqual(aer.completes, [good.id]);
});

test("queue limits: full → queue_full and nothing queued; whenFull: wait applies backpressure", async () => {
  const aer = fakeAer();
  const r = rec(aer, { maxQueueItems: 2, maxRetryDelayMs: 20 });
  const run = await r.startRun({ agentName: "a" });
  aer.fail("network", "network", "network");
  await run.enqueue({ type: "tool_call", title: "1" });
  await run.enqueue({ type: "tool_call", title: "2" });
  await assert.rejects(run.enqueue({ type: "tool_call", title: "3" }), (e: RecorderError) => e.code === "queue_full");
  assert.equal(r.stats().queued, 2);
  await r.flush(2000);
  assert.deepEqual(aer.events.map((e) => e.title), ["1", "2"]);

  const aer2 = fakeAer();
  const r2 = rec(aer2, { maxQueueItems: 1, whenFull: "wait", maxRetryDelayMs: 10 });
  const run2 = await r2.startRun({ agentName: "a" });
  aer2.fail("network", "network");
  await run2.enqueue({ type: "tool_call", title: "1" });
  await run2.enqueue({ type: "tool_call", title: "2" }); // waits for room instead of failing
  await r2.flush(2000);
  assert.deepEqual(aer2.events.map((e) => e.title), ["1", "2"]);

  const r3 = rec(fakeAer(), { maxQueueBytes: 50 });
  const run3 = await r3.startRun({ agentName: "a" });
  await assert.rejects(run3.enqueue({ type: "tool_call", title: "x".repeat(100) }), (e: RecorderError) => e.code === "queue_full");
});

test("shutdown without a store: pending items are reported, later writes are refused", async () => {
  const aer = fakeAer();
  const failures: DeliveryFailure[] = [];
  const r = rec(aer, { maxRetryDelayMs: 50, onDeliveryError: (f) => failures.push(f) });
  const run = await r.startRun({ agentName: "a" });
  aer.fail(...Array.from({ length: 50 }, () => "network" as const));
  await run.enqueue({ type: "tool_call", title: "1" });
  await run.enqueue({ type: "tool_call", title: "2" });
  const res = await r.shutdown(30);
  assert.equal(res.pending, 2);
  assert.deepEqual(failures.map((f) => f.reason), ["closed", "closed"]);
  await assert.rejects(run.enqueue({ type: "tool_call", title: "3" }), (e: RecorderError) => e.code === "recorder_closed");
});

test("restart with a file store: same Idempotency-Keys, nothing created twice, no API key on disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aer-queue-"));
  const file = join(dir, "queue.json");
  const aer = fakeAer();
  const a = rec(aer, { store: fileQueueStore(file), maxRetryDelayMs: 20 });
  assert.equal(await a.resume(), 0); // first run: no file yet
  const run = await a.startRun({ agentName: "a" });
  // Event 1 commits on the server but the response is lost; then AER is unreachable.
  aer.fail({ status: 200, commitThenDrop: true }, ...Array.from({ length: 50 }, () => "network" as const));
  await run.enqueue({ type: "tool_call", title: "1" });
  await run.enqueue({ type: "tool_call", title: "2" });
  await run.enqueue({ type: "tool_call", title: "3" });
  const firstKeys = JSON.parse(readFileSync(file, "utf8")).items.map((i: { idempotencyKey: string }) => i.idempotencyKey);
  const down = await a.shutdown(60);
  assert.ok(down.pending >= 2, "items stay persisted, not failed");
  const onDisk = readFileSync(file, "utf8");
  assert.ok(!onDisk.includes("aer_synthetic_key_never_persisted"));

  // New process: same file, AER reachable again.
  aer.fail();
  const b = rec(aer, { store: fileQueueStore(file) });
  assert.ok((await b.resume()) >= 2);
  await b.flush(2000);
  assert.deepEqual(aer.events.map((e) => e.title), ["1", "2", "3"]);
  assert.deepEqual(new Set(aer.events.map((e) => e.key)), new Set(firstKeys));
  assert.equal(JSON.parse(readFileSync(file, "utf8")).items.length, 0);
});

test("a damaged queue file is refused, never silently replaced by an empty queue", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aer-queue-"));
  const file = join(dir, "queue.json");
  writeFileSync(file, "{ not json: synthetic-private-content");
  const r = rec(fakeAer(), { store: fileQueueStore(file) });
  await assert.rejects(r.resume(), (e: Error) => !e.message.includes("synthetic-private-content"));
  assert.equal(readFileSync(file, "utf8"), "{ not json: synthetic-private-content");
});

test("a throwing onDeliveryError hook does not stop delivery of other items", async () => {
  const aer = fakeAer();
  const r = rec(aer, { onDeliveryError: () => { throw new Error("hook bug"); } });
  const run = await r.startRun({ agentName: "a" });
  aer.fail({ status: 422 });
  await run.enqueue({ type: "tool_call", title: "bad" });
  await run.enqueue({ type: "tool_call", title: "good" });
  await r.flush(1000);
  assert.deepEqual(aer.events.map((e) => e.title), ["good"]);
});

// Review of the Stage 5 working tree: extra regressions around the fixes.
test("store + explicit capture 'full' is refused; store without capture defaults to redacted_content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aer-queue-"));
  assert.throws(
    () => new AgentEvidenceRecorder({ baseUrl: "http://x", apiKey: "k", fetchImpl: fakeAer().fetchImpl, capture: { mode: "full" }, delivery: { store: fileQueueStore(join(dir, "q.json")) } }),
    /capture.mode "full"/,
  );
  const aer = fakeAer();
  const sent: string[] = [];
  const spy = (async (u: string | URL | Request, init?: RequestInit) => { sent.push(String(init?.body)); return aer.fetchImpl(u, init); }) as typeof fetch;
  const r = new AgentEvidenceRecorder({ baseUrl: "http://x", apiKey: "k", fetchImpl: spy, delivery: { store: fileQueueStore(join(dir, "q2.json")) } });
  const run = await r.startRun({ agentName: "a" });
  await run.event({ type: "tool_call", title: "t", input: { password: "synthetic-pw" } });
  assert.ok(!sent.join("").includes("synthetic-pw"));
  assert.match(sent[1], /"mode":"redacted_content"/);
});

test("a failed save under concurrency: the rejected item is never delivered and never left on disk", async () => {
  const aer = fakeAer();
  let disk: { items: Array<{ body: { title?: string } }> } = { items: [] };
  const store = {
    load: async () => null,
    save: async (s: { items: Array<{ body: { title?: string } }> }) => {
      await new Promise((r) => setTimeout(r, 2));
      if (s.items.some((i) => i.body.title === "bad")) throw new Error("disk full");
      disk = structuredClone(s);
    },
  };
  const r = rec(aer, { store: store as never, maxRetryDelayMs: 5 });
  const run = await r.startRun({ agentName: "a" });
  const results = await Promise.allSettled([
    run.enqueue({ type: "tool_call", title: "a" }),
    run.enqueue({ type: "tool_call", title: "bad" }),
    run.enqueue({ type: "tool_call", title: "b" }),
  ]);
  assert.deepEqual(results.map((x) => x.status), ["fulfilled", "rejected", "fulfilled"]);
  assert.equal((results[1] as PromiseRejectedResult).reason.code, "store_failed");
  await r.flush(1000);
  assert.deepEqual(aer.events.map((e) => e.title), ["a", "b"]);
  assert.ok(!JSON.stringify(disk).includes('"bad"'));
});

test("shutdown with a store: an awaiting event() gets a definite answer instead of hanging", async () => {
  const aer = fakeAer();
  let saved: unknown = null;
  const store = { load: async () => null, save: async (s: unknown) => { saved = structuredClone(s); } };
  const r = rec(aer, { store: store as never, maxRetryDelayMs: 1000, maxItemAgeMs: 60_000 });
  const run = await r.startRun({ agentName: "a" });
  aer.fail(...Array.from({ length: 50 }, () => "network" as const));
  await run.enqueue({ type: "tool_call", title: "bg" });
  const awaited = run.event({ type: "tool_call", title: "fg" });
  const res = await r.shutdown(20);
  assert.equal(res.pending, 2);
  await assert.rejects(awaited, (e: RecorderError) => e.code === "recorder_closed");
  assert.equal((saved as { items: unknown[] }).items.length, 2, "both stay persisted for resume()");
});

// Round-3 review T3-2 (repro B), adapted: shutdown() never returns while one of its saves is still
// running, so a stale save can't land after a later recorder took over the same store.
test("shutdown waits for an in-flight save; no stale write lands after it returns", async () => {
  let state: { items: Array<{ idempotencyKey: string }> } | null = null;
  let saves = 0;
  let release!: () => void;
  const blocked = new Promise<void>((r) => (release = r));
  let entered!: () => void;
  const enteredP = new Promise<void>((r) => (entered = r));
  const store = {
    load: async () => structuredClone(state),
    save: async (v: { items: Array<{ idempotencyKey: string }> }) => {
      const snap = structuredClone(v);
      if (++saves === 2) { entered(); await blocked; }
      state = snap;
    },
  };
  const aer = fakeAer();
  const first = rec(aer, { store: store as never });
  const run = await first.startRun({ agentName: "a" });
  await run.enqueue({ type: "tool_call", title: "one" });
  await enteredP; // the post-delivery checkpoint is running
  // Timed shutdown: the deadline wins, the running save is reported, not hidden.
  const timed = await first.shutdown(0);
  assert.equal(timed.checkpointsPending, 1);
  // Untimed shutdown: does not return until that save has finished.
  let returned = false;
  const closing = first.shutdown().then(() => (returned = true));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(returned, false, "shutdown must not return while its save is running");
  release();
  await closing;

  const next = rec(aer, { store: store as never, maxRetryDelayMs: 5 });
  const again = await next.startRun({ agentName: "a" });
  aer.fail(...Array.from({ length: 50 }, () => "network" as const));
  await again.enqueue({ type: "tool_call", title: "two", idempotencyKey: "next-item" });
  await next.shutdown(0); // still undelivered (outage) → must stay on disk
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(state!.items.some((i) => i.idempotencyKey === "next-item"), "nothing from the first recorder overwrote it");
});

test("a second shutdown after a timed one settles (persisted items are reported, not awaited)", async () => {
  const aer = fakeAer();
  const store = { load: async () => null, save: async () => undefined };
  const r = rec(aer, { store: store as never, maxRetryDelayMs: 1000 });
  const run = await r.startRun({ agentName: "a" });
  aer.fail(...Array.from({ length: 50 }, () => "network" as const));
  await run.enqueue({ type: "tool_call", title: "x" });
  assert.equal((await r.shutdown(0)).pending, 1);
  const again = await r.shutdown();
  assert.deepEqual([again.pending, again.checkpointsPending], [1, 0]);
  assert.equal((await r.flush()).pending, 1);
});

test("file store: temp files are unpredictable and exclusively created; no temp file is left behind", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aer-queue-"));
  const file = join(dir, "queue.json");
  // A planted file at the old predictable temp name must be neither written nor needed.
  const planted = `${file}.${process.pid}.tmp`;
  writeFileSync(planted, "planted");
  const store = fileQueueStore(file);
  await store.save({ version: 1, items: [], failedRuns: ["r1"] });
  assert.equal(readFileSync(planted, "utf8"), "planted");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).failedRuns, ["r1"]);
  const { readdirSync } = await import("node:fs");
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".tmp") && f !== `queue.json.${process.pid}.tmp`), []);
});

// Review (temp-file fix) S1: the reviewer's partial-write test patched fs.writeFile; the fix (as the
// reviewer recommended) writes through an exclusively opened handle, so the same intent is tested here.
test("file store: a partial write through the owned handle is cleaned up; old snapshot and recovery intact", async () => {
  const fsp = (await import("node:fs/promises")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const dir = mkdtempSync(join(tmpdir(), "aer-queue-"));
  const file = join(dir, "queue.json");
  const store = fileQueueStore(file);
  await store.save({ version: 1, items: [], failedRuns: ["old"] });
  const original = fsp.open;
  try {
    fsp.open = (async (...args: Parameters<typeof original>) => {
      const fh = await original(...args);
      const write = fh.writeFile.bind(fh);
      fh.writeFile = (async () => {
        await write("{partial");
        throw Object.assign(new Error("synthetic"), { code: "ENOSPC" });
      }) as typeof fh.writeFile;
      return fh;
    }) as typeof original;
    syncBuiltinESMExports();
    await assert.rejects(store.save({ version: 1, items: [], failedRuns: ["new"] }), (e: NodeJS.ErrnoException) => e.code === "ENOSPC");
  } finally {
    fsp.open = original;
    syncBuiltinESMExports();
  }
  const { readdirSync } = await import("node:fs");
  assert.deepEqual(readdirSync(dir), ["queue.json"]);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).failedRuns, ["old"]);
  await store.save({ version: 1, items: [], failedRuns: ["recovered"] });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).failedRuns, ["recovered"]);
});
