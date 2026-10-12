// SDK → real route handlers → real PostgreSQL. The fetch bridge commits every first attempt on the
// server and then "loses" the response, so each SDK call must be saved by its retry + key.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyChain } from "@ktlsr/evidence-chain";
import { prisma } from "@/lib/prisma";
import { POST as createRun } from "@/app/api/v1/runs/route";
import { POST as addEvent } from "@/app/api/v1/runs/[run_id]/events/route";
import { POST as completeRun } from "@/app/api/v1/runs/[run_id]/complete/route";
import { toChainLink } from "@/lib/audit/chainAdapter";
import { AgentEvidenceRecorder } from "../../../packages/collector-js/src/index";
import { ctx, dropTenants, makeTenant } from "./support";

const ORG_A = "org_sdk_retry";
const KEY_A = "aer_test_sdkretry11sdkretry22sdkre";

beforeAll(() => makeTenant(ORG_A, KEY_A));
afterAll(async () => {
  await dropTenants(ORG_A);
  await prisma.$disconnect();
});

async function chainOf(runId: string) {
  const run = await prisma.agentRun.findFirstOrThrow({ where: { id: runId } });
  const events = await prisma.agentEvent.findMany({ where: { runId }, orderBy: { seq: "asc" } });
  const findings = await prisma.redactionFinding.findMany({ where: { runId } });
  return { run, events, verdict: verifyChain(events.map((e) => toChainLink(e, findings)), run.seal, runId) };
}

describe("SDK retry after a lost response", () => {
  it("SDK end to end: server commits, the response is dropped, the SDK retry creates nothing new", async () => {
    // fetch bridge: real route handlers + real DB; every first attempt "loses" its response.
    const seen = new Map<string, number>();
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const request = new Request(String(url), init);
      const m = /^\/api\/v1\/runs\/([^/]+)\/(events|complete)$/.exec(path);
      const res = !m
        ? await createRun(request)
        : m[2] === "events"
          ? await addEvent(request, ctx({ run_id: m[1] }))
          : await completeRun(request, ctx({ run_id: m[1] }));
      const key = new Headers(init?.headers).get("idempotency-key") ?? "";
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n === 1) throw new TypeError("socket hang up"); // committed, but the client never hears
      return res;
    }) as typeof fetch;

    const recorder = new AgentEvidenceRecorder({ baseUrl: "http://aer.test", apiKey: KEY_A, fetchImpl });
    const run = await recorder.startRun({ agentName: "sdk-lost-response" });
    await run.event({ type: "tool_call", title: "one" });
    await run.event({ type: "tool_call", title: "two" });
    await run.complete();

    expect(await prisma.agentRun.count({ where: { organizationId: ORG_A, agentName: "sdk-lost-response" } })).toBe(1);
    const { run: stored, events, verdict } = await chainOf(run.id);
    expect(events.map((e) => e.title)).toEqual(["one", "two"]);
    expect(stored.status).toBe("completed");
    expect(verdict).toMatchObject({ ok: true, status: "verified" });
    expect([...seen.values()].every((n) => n === 2)).toBe(true);
  });
});
