// Stage 2 acceptance tests — run against a REAL PostgreSQL (DATABASE_URL). No mocks of the DB.
// Races use a controlled barrier: the test itself holds the run's row lock, queues requests behind
// it, waits (via pg_blocking_pids) until exactly those requests are blocked, then releases.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifyChain } from "@ktlsr/evidence-chain";
import { prisma } from "@/lib/prisma";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST as createRun } from "@/app/api/v1/runs/route";
import { POST as addEvent } from "@/app/api/v1/runs/[run_id]/events/route";
import { POST as completeRun } from "@/app/api/v1/runs/[run_id]/complete/route";
import { toChainLink } from "@/lib/audit/chainAdapter";
import { ctx, dropTenants, makeTenant, req } from "./support";

const ORG_A = "org_order_a";
const ORG_B = "org_order_b";
const KEY_A = "aer_test_orderA1111orderA2222orderA";
const KEY_B = "aer_test_orderB1111orderB2222orderB";

beforeAll(async () => {
  await makeTenant(ORG_A, KEY_A);
  await makeTenant(ORG_B, KEY_B);
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION aer_test_fail_finding() RETURNS trigger AS $$
    BEGIN
      IF NEW."fieldPath" LIKE '%aer_fail_marker%' THEN RAISE EXCEPTION 'injected failure'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS aer_test_fail_finding ON "RedactionFinding"`);
});
beforeEach(() => __resetRateLimit());
afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS aer_test_fail_finding ON "RedactionFinding"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS aer_test_fail_finding()`);
  await dropTenants(ORG_A, ORG_B);
  await prisma.$disconnect();
});

const newRun = async (token = KEY_A, headers?: Record<string, string>): Promise<string> => {
  const res = await createRun(req("POST", "/api/v1/runs", { token, body: { agentName: "race" }, headers }));
  expect(res.status).toBe(201);
  return (await res.json()).run.id;
};

const postEvent = (runId: string, body: unknown, opts: { token?: string; key?: string } = {}) =>
  addEvent(
    req("POST", `/api/v1/runs/${runId}/events`, {
      token: opts.token ?? KEY_A,
      body,
      headers: opts.key ? { "idempotency-key": opts.key } : undefined,
    }),
    ctx({ run_id: runId }),
  );

const complete = (runId: string, body: unknown = { status: "completed" }, key?: string) =>
  completeRun(
    req("POST", `/api/v1/runs/${runId}/complete`, {
      token: KEY_A,
      body,
      headers: key ? { "idempotency-key": key } : undefined,
    }),
    ctx({ run_id: runId }),
  );

async function chainOf(runId: string) {
  const run = await prisma.agentRun.findFirstOrThrow({ where: { id: runId } });
  const events = await prisma.agentEvent.findMany({ where: { runId }, orderBy: { seq: "asc" } });
  const findings = await prisma.redactionFinding.findMany({ where: { runId } });
  return { run, events, findings, verdict: verifyChain(events.map((e) => toChainLink(e, findings)), run.seal, runId) };
}

/** Hold the run row lock until release(); report the holder's backend pid. */
function holdRunLock(runId: string) {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let pidReady!: (pid: number) => void;
  const pid = new Promise<number>((r) => (pidReady = r));
  const done = prisma.$transaction(
    async (tx) => {
      const [{ pid: p }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT 1 FROM "AgentRun" WHERE "id" = ${runId} FOR UPDATE`;
      pidReady(p);
      await released;
    },
    { timeout: 30_000 },
  );
  return { pid, release, done };
}

/**
 * Wait until exactly `n` sessions are queued behind the holder (polling a condition, not sleeping
 * as synchronisation). Transitive: on a row lock, the 2nd waiter is blocked by the 1st waiter's
 * tuple lock, not directly by the holder.
 */
async function waitBlocked(holderPid: number, n: number): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const [{ c }] = await prisma.$queryRaw<{ c: number }[]>`
      WITH RECURSIVE queued(pid) AS (
        SELECT pid FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids(pid))
        UNION
        SELECT a.pid FROM pg_stat_activity a JOIN queued q ON q.pid = ANY(pg_blocking_pids(a.pid))
      ) SELECT count(*)::int AS c FROM queued`;
    if (c === n) return;
    if (c > n) throw new Error(`expected ${n} blocked sessions, saw ${c}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${n} blocked sessions`);
}

describe("1. 100 parallel events on one run", () => {
  it("loses nothing, counts right, orders 1..100, and the sealed chain verifies", async () => {
    const runId = await newRun();
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => postEvent(runId, { type: "tool_call", title: `step ${i}` })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(100).fill(201));
    expect((await complete(runId)).status).toBe(200);

    const { run, events, verdict } = await chainOf(runId);
    expect(events.map((e) => e.seq)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(new Set(events.map((e) => e.title)).size).toBe(100);
    expect(run.eventCount).toBe(100);
    expect(verdict).toMatchObject({ ok: true, status: "verified", checkedCount: 100 });
  }, 60_000);
});

describe("2. same Idempotency-Key in parallel", () => {
  it("creates exactly one event; every response names it", async () => {
    const runId = await newRun();
    const res = await Promise.all(
      Array.from({ length: 20 }, () => postEvent(runId, { type: "model_call", title: "once" }, { key: "evt-once" })),
    );
    const bodies = await Promise.all(res.map((r) => r.json()));
    expect(new Set(bodies.map((b) => b.event.id)).size).toBe(1);
    // Replays return the first response verbatim (same 201), marked by a header.
    expect(res.map((r) => r.status)).toEqual(Array(20).fill(201));
    expect(res.filter((r) => r.headers.get("idempotent-replayed") === "true")).toHaveLength(19);
    expect(await prisma.agentEvent.count({ where: { runId } })).toBe(1);
  });

  it("creates exactly one run", async () => {
    const res = await Promise.all(
      Array.from({ length: 10 }, () =>
        createRun(req("POST", "/api/v1/runs", { token: KEY_A, body: { agentName: "once-run" }, headers: { "idempotency-key": "run-once" } })),
      ),
    );
    const ids = new Set((await Promise.all(res.map((r) => r.json()))).map((b) => b.run.id));
    expect(ids.size).toBe(1);
    expect(await prisma.agentRun.count({ where: { organizationId: ORG_A, agentName: "once-run" } })).toBe(1);
  });
});

describe("3. same key, different content", () => {
  it("answers 409 and leaves the stored event untouched", async () => {
    const runId = await newRun();
    expect((await postEvent(runId, { type: "tool_call", title: "original" }, { key: "evt-conflict" })).status).toBe(201);
    const second = await postEvent(runId, { type: "tool_call", title: "changed" }, { key: "evt-conflict" });
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("conflict");
    const rows = await prisma.agentEvent.findMany({ where: { runId } });
    expect(rows.map((r) => r.title)).toEqual(["original"]);
  });

  it("legacy explicit seq: same content replays, different content is 409 (was: silent success)", async () => {
    const runId = await newRun();
    expect((await postEvent(runId, { type: "tool_call", title: "a", seq: 5 })).status).toBe(201);
    const same = await postEvent(runId, { type: "tool_call", title: "a", seq: 5 });
    expect(same.status).toBe(200);
    expect((await same.json()).idempotent).toBe(true);
    expect((await postEvent(runId, { type: "tool_call", title: "b", seq: 5 })).status).toBe(409);
    // Going backwards would break the chain order — refused, not silently accepted.
    expect((await postEvent(runId, { type: "tool_call", title: "c", seq: 3 })).status).toBe(409);
    // A gap forward is allowed (legacy step numbers), and server-assigned seq continues after it.
    expect((await postEvent(runId, { type: "tool_call", title: "d", seq: 9 })).status).toBe(201);
    const next = await postEvent(runId, { type: "tool_call", title: "e" });
    expect((await next.json()).event.seq).toBe(10);
    await complete(runId);
    expect((await chainOf(runId)).verdict).toMatchObject({ ok: true });
  });
});

describe("4. response lost after commit, then retry", () => {
  it("API: the retry with the same key returns the first result; no second row", async () => {
    const runId = await newRun();
    const first = await postEvent(runId, { type: "final_output", title: "answer" }, { key: "evt-lost" });
    const firstId = (await first.json()).event.id; // response "lost" — client never saw it
    const retry = await postEvent(runId, { type: "final_output", title: "answer" }, { key: "evt-lost" });
    expect(retry.status).toBe(201);
    expect(retry.headers.get("idempotent-replayed")).toBe("true");
    expect((await retry.json()).event.id).toBe(firstId);
    expect(await prisma.agentEvent.count({ where: { runId } })).toBe(1);
  });
});

describe("5. event vs complete race (controlled barrier)", () => {
  it("event queued first → it is inside the sealed chain", async () => {
    const runId = await newRun();
    const hold = holdRunLock(runId);
    const pid = await hold.pid;
    const ev = postEvent(runId, { type: "tool_call", title: "racer" });
    await waitBlocked(pid, 1);
    const done = complete(runId);
    await waitBlocked(pid, 2);
    hold.release();
    await hold.done;
    const [evRes, doneRes] = await Promise.all([ev, done]);
    expect(evRes.status).toBe(201);
    expect(doneRes.status).toBe(200);
    const { run, events, verdict } = await chainOf(runId);
    expect(events.map((e) => e.title)).toEqual(["racer"]);
    expect(run.eventCount).toBe(1);
    expect(run.seal).toBe(events[0].hash);
    expect(verdict).toMatchObject({ ok: true, status: "verified" });
  });

  it("complete queued first → the event is rejected and nothing is added after the seal", async () => {
    const runId = await newRun();
    expect((await postEvent(runId, { type: "tool_call", title: "before" })).status).toBe(201);
    const hold = holdRunLock(runId);
    const pid = await hold.pid;
    const done = complete(runId);
    await waitBlocked(pid, 1);
    const ev = postEvent(runId, { type: "tool_call", title: "late" });
    await waitBlocked(pid, 2);
    hold.release();
    await hold.done;
    const [doneRes, evRes] = await Promise.all([done, ev]);
    expect(doneRes.status).toBe(200);
    expect(evRes.status).toBe(422);
    expect((await evRes.json()).error.message).toBe("run_already_completed");
    const { run, events, verdict } = await chainOf(runId);
    expect(events.map((e) => e.title)).toEqual(["before"]);
    expect(run.eventCount).toBe(1);
    expect(verdict).toMatchObject({ ok: true, status: "verified" });
  });
});

describe("6. repeated complete", () => {
  it("returns the same result without moving endedAt, status or seal; a different result is 409", async () => {
    const runId = await newRun();
    await postEvent(runId, { type: "tool_call", title: "x" });
    expect((await complete(runId)).status).toBe(200);
    const before = await prisma.agentRun.findFirstOrThrow({ where: { id: runId } });

    const again = await complete(runId);
    expect(again.status).toBe(200);
    const conflict = await complete(runId, { status: "failed" });
    expect(conflict.status).toBe(409);
    const otherEnd = await complete(runId, { status: "completed", endedAt: "2020-01-01T00:00:00.000Z" });
    expect(otherEnd.status).toBe(409);

    const after = await prisma.agentRun.findFirstOrThrow({ where: { id: runId } });
    expect(after.endedAt?.toISOString()).toBe(before.endedAt?.toISOString());
    expect(after.seal).toBe(before.seal);
    expect(after.status).toBe("completed");
  });

  it("a retry of an accepted event still returns its result after the run is sealed; a new event does not", async () => {
    const runId = await newRun();
    const first = await postEvent(runId, { type: "tool_call", title: "accepted" }, { key: "evt-after-seal" });
    expect(first.status).toBe(201);
    await complete(runId);
    const retry = await postEvent(runId, { type: "tool_call", title: "accepted" }, { key: "evt-after-seal" });
    expect(retry.status).toBe(201);
    expect(retry.headers.get("idempotent-replayed")).toBe("true");
    const fresh = await postEvent(runId, { type: "tool_call", title: "new" }, { key: "evt-new-after-seal" });
    expect(fresh.status).toBe(422);
  });
});

describe("7. failure in the middle of the write", () => {
  it("leaves no event, finding, counter change or idempotency claim; the retry then succeeds once", async () => {
    const runId = await newRun();
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER aer_test_fail_finding BEFORE INSERT ON "RedactionFinding" FOR EACH ROW EXECUTE FUNCTION aer_test_fail_finding()`,
    );
    const body = { type: "user_input", title: "boom", input: { aer_fail_marker: "victim@example.com" } };
    let res: Response;
    try {
      res = await postEvent(runId, body, { key: "evt-midfail" });
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS aer_test_fail_finding ON "RedactionFinding"`);
    }
    expect(res.status).toBe(500);
    const run = await prisma.agentRun.findFirstOrThrow({ where: { id: runId } });
    expect(run.eventCount).toBe(0);
    expect(run.redactionCount).toBe(0);
    expect(await prisma.agentEvent.count({ where: { runId } })).toBe(0);
    expect(await prisma.redactionFinding.count({ where: { runId } })).toBe(0);
    expect(await prisma.idempotencyRecord.count({ where: { organizationId: ORG_A, key: "evt-midfail" } })).toBe(0);

    expect((await postEvent(runId, body, { key: "evt-midfail" })).status).toBe(201);
    const after = await prisma.agentRun.findFirstOrThrow({ where: { id: runId } });
    expect([after.eventCount, after.redactionCount]).toEqual([1, 1]);
  });
});

describe("8. tenant isolation", () => {
  it("the same key in two orgs gives two independent runs", async () => {
    const a = await newRun(KEY_A, { "idempotency-key": "shared-key" });
    const b = await newRun(KEY_B, { "idempotency-key": "shared-key" });
    expect(a).not.toBe(b);
    expect((await prisma.agentRun.findFirstOrThrow({ where: { id: b } })).organizationId).toBe(ORG_B);
  });

  it("another org can neither write to nor replay results from a run it does not own", async () => {
    const runId = await newRun();
    await postEvent(runId, { type: "tool_call", title: "mine" }, { key: "evt-private" });
    const intruder = await postEvent(runId, { type: "tool_call", title: "mine" }, { token: KEY_B, key: "evt-private" });
    expect(intruder.status).toBe(404);
    expect(JSON.stringify(await intruder.json())).not.toContain("mine");
    const done = await completeRun(
      req("POST", `/api/v1/runs/${runId}/complete`, { token: KEY_B, body: { status: "completed" } }),
      ctx({ run_id: runId }),
    );
    expect(done.status).toBe(404);
  });

  it("a key used for one operation cannot be replayed for another (409)", async () => {
    const runId = await newRun(KEY_A, { "idempotency-key": "op-bound" });
    expect((await postEvent(runId, { type: "tool_call", title: "x" }, { key: "op-bound" })).status).toBe(409);
  });

  it("rejects a malformed Idempotency-Key (422)", async () => {
    const runId = await newRun();
    expect((await postEvent(runId, { type: "tool_call", title: "x" }, { key: "has spaces & ünicode" })).status).toBe(422);
  });
});
