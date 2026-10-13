// Stage 5 acceptance: collector-js delivery queue against the real routes and PostgreSQL.
// Outage + lost response + process restart (file store) → every event exactly once, in order,
// chain verified; an undeliverable event keeps the run unsealed. Synthetic tenant only.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyChain } from "@ktlsr/evidence-chain";
import { prisma } from "@/lib/prisma";
import { POST as createRun } from "@/app/api/v1/runs/route";
import { POST as addEvent } from "@/app/api/v1/runs/[run_id]/events/route";
import { POST as completeRun } from "@/app/api/v1/runs/[run_id]/complete/route";
import { toChainLink } from "@/lib/audit/chainAdapter";
import { AgentEvidenceRecorder, RecorderError } from "../../../packages/collector-js/src/index";
import { fileQueueStore } from "../../../packages/collector-js/src/file-store";
import { ctx, dropTenants, makeTenant } from "./support";

const ORG = "org_sdk_delivery";
const KEY = "aer_test_sdkdelivery1sdkdelivery2sd";

beforeAll(() => makeTenant(ORG, KEY));
afterAll(async () => {
  await dropTenants(ORG);
  await prisma.$disconnect();
});

/** fetch → real route handlers. `outage` answers network errors; `dropNext` commits then loses the response. */
function bridge() {
  const state = { outage: false, dropNext: 0 };
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    if (state.outage) throw new TypeError("connect ECONNREFUSED");
    const request = new Request(String(url), init);
    const m = /^\/api\/v1\/runs\/([^/]+)\/(events|complete)$/.exec(new URL(String(url)).pathname);
    const res = !m ? await createRun(request) : m[2] === "events" ? await addEvent(request, ctx({ run_id: m[1] })) : await completeRun(request, ctx({ run_id: m[1] }));
    if (state.dropNext > 0 && m) {
      state.dropNext--;
      throw new TypeError("socket hang up"); // the server committed; the client never hears
    }
    return res;
  }) as typeof fetch;
  return { state, fetchImpl };
}

async function stored(runId: string) {
  const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
  const events = await prisma.agentEvent.findMany({ where: { runId }, orderBy: { seq: "asc" } });
  const findings = await prisma.redactionFinding.findMany({ where: { runId } });
  return { run, events, verdict: verifyChain(events.map((e) => toChainLink(e, findings)), run.seal, runId) };
}

describe("collector-js 0.6 delivery against the real API", () => {
  it("outage, lost response and a restart: each event once, in order; then sealed and verified", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "aer-sdk-delivery-")), "queue.json");
    const net = bridge();
    const a = new AgentEvidenceRecorder({ baseUrl: "http://aer.test", apiKey: KEY, fetchImpl: net.fetchImpl, maxRetries: 0, delivery: { store: fileQueueStore(file), maxRetryDelayMs: 20 } });
    expect(await a.resume()).toBe(0);
    const run = await a.startRun({ agentName: "delivery", idempotencyKey: "job-7:start" });

    net.state.dropNext = 1; // event 1 lands, its response is lost
    await run.enqueue({ type: "tool_call", title: "1" });
    await a.flush(300); // event 1 is retried with the same key → replay, not a second row
    net.state.outage = true;
    await run.enqueue({ type: "tool_call", title: "2" });
    await run.enqueue({ type: "tool_call", title: "3" });
    const down = await a.shutdown(80); // "process exits" during the outage
    expect(down.pending).toBe(2);
    expect(readFileSync(file, "utf8")).not.toContain(KEY);

    // New process, AER back. Re-opening the run with the same key returns the same run.
    net.state.outage = false;
    const b = new AgentEvidenceRecorder({ baseUrl: "http://aer.test", apiKey: KEY, fetchImpl: net.fetchImpl, delivery: { store: fileQueueStore(file) } });
    expect(await b.resume()).toBe(2);
    const again = await b.startRun({ agentName: "delivery", idempotencyKey: "job-7:start" });
    expect(again.id).toBe(run.id);
    await again.enqueue({ type: "tool_call", title: "4" });
    await again.complete();

    const { run: row, events, verdict } = await stored(run.id);
    expect(events.map((e) => [e.title, e.seq])).toEqual([["1", 1], ["2", 2], ["3", 3], ["4", 4]]);
    expect(row.status).toBe("completed");
    expect(verdict).toMatchObject({ ok: true, status: "verified" });
    expect(b.stats()).toMatchObject({ queued: 0, failed: 0 });
  });

  it("an event the server rejects keeps the run unsealed: complete() refuses, nothing is sealed", async () => {
    const net = bridge();
    const failures: string[] = [];
    const r = new AgentEvidenceRecorder({
      baseUrl: "http://aer.test",
      apiKey: KEY,
      fetchImpl: net.fetchImpl,
      delivery: { onDeliveryError: (f) => failures.push(`${f.reason}:${f.error.status}`) },
    });
    const run = await r.startRun({ agentName: "rejected" });
    await run.enqueue({ type: "tool_call", title: "ok" });
    await run.enqueue({ type: "tool_call", title: "t", seq: 1 }); // seq 1 already taken, different content → 409
    await r.flush(2000);
    expect(failures).toEqual(["rejected:409"]);
    await expect(run.complete()).rejects.toSatisfy((e: RecorderError) => e.code === "undelivered_events");
    const { run: row } = await stored(run.id);
    expect(row.status).toBe("running");
    expect(row.seal).toBeNull();
  });
});
