// Stage 6 acceptance: verified human approval, real routes + PostgreSQL. Synthetic tenants only.
// The dashboard decision is exercised through the service the server actions call (the actions
// only add the session: requireDashboardAccess + auth()).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyChain, verifyPacket } from "@ktlsr/evidence-chain";
import { prisma } from "@/lib/prisma";
import { POST as createRun } from "@/app/api/v1/runs/route";
import { POST as addEvent } from "@/app/api/v1/runs/[run_id]/events/route";
import { POST as completeRun } from "@/app/api/v1/runs/[run_id]/complete/route";
import { POST as requestApprovalRoute } from "@/app/api/v1/runs/[run_id]/approvals/route";
import { GET as getApprovalRoute } from "@/app/api/v1/approvals/[approval_id]/route";
import { POST as consumeRoute } from "@/app/api/v1/approvals/[approval_id]/consume/route";
import { POST as outcomeRoute } from "@/app/api/v1/approvals/[approval_id]/outcome/route";
import { POST as createExport } from "@/app/api/v1/runs/[run_id]/exports/route";
import { GET as downloadExport } from "@/app/api/v1/runs/[run_id]/exports/[export_id]/download/route";
import { decideApproval, revokeApproval } from "@/lib/approvals/service";
import { approvalBadge } from "@/lib/approvals/badge";
import { toChainLink } from "@/lib/audit/chainAdapter";
import { ctx, dropTenants, makeTenant, req } from "./support";

const A = { org: "org_approvals_a", key: "aer_test_approvalsA1approvalsA2appr" };
const B = { org: "org_approvals_b", key: "aer_test_approvalsB1approvalsB2appr" };
const scopeA = { organizationId: A.org, projectId: `${A.org}_proj` };
const scopeB = { organizationId: B.org, projectId: `${B.org}_proj` };
const USER_A = "user_synthetic_a"; // the session user id the server action would pass

beforeAll(async () => {
  await makeTenant(A.org, A.key);
  await makeTenant(B.org, B.key);
});
afterAll(async () => {
  await dropTenants(A.org, B.org);
  await prisma.$disconnect();
});

const PAY_A = { action: "refund", params: { orderId: "ord-1001", amountMinor: 4200, currency: "TRY" } };
const PAY_B = { action: "refund", params: { orderId: "ord-1001", amountMinor: 999900, currency: "TRY" } };

async function newRun(key = A.key) {
  const res = await createRun(req("POST", "/api/v1/runs", { token: key, body: { agentName: "refund-agent" } }));
  return (await res.json()).run.id as string;
}
async function ask(runId: string, body: Record<string, unknown> = PAY_A, key = A.key, headers?: Record<string, string>) {
  const res = await requestApprovalRoute(req("POST", `/api/v1/runs/${runId}/approvals`, { token: key, body, headers }), ctx({ run_id: runId }));
  return { status: res.status, body: await res.json(), headers: res.headers };
}
async function consume(id: string, body: Record<string, unknown> = PAY_A, key = A.key, headers?: Record<string, string>) {
  const res = await consumeRoute(req("POST", `/api/v1/approvals/${id}/consume`, { token: key, body, headers }), ctx({ approval_id: id }));
  return { status: res.status, body: await res.json(), headers: res.headers };
}

describe("verified approval: request → decide (signed-in user) → consume", () => {
  it("full happy path, every step a server-written chain event; the chain verifies", async () => {
    const runId = await newRun();
    const asked = await ask(runId);
    expect(asked.status).toBe(201);
    expect(asked.body.approval).toMatchObject({ status: "pending", verified: false, uses: 0, maxUses: 1 });
    const id = asked.body.approval.id as string;

    expect((await consume(id)).body.error.message).toBe("approval_pending");

    await decideApproval(scopeA, USER_A, id, "approve");
    const used = await consume(id);
    expect(used.status).toBe(200);
    expect(used.body.approval).toMatchObject({ status: "used_up", uses: 1, verified: true });

    const events = await prisma.agentEvent.findMany({ where: { runId }, orderBy: { seq: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["human_approval_requested", "human_approval_granted", "human_approval_used"]);
    const granted = events[1].metadata as { aer_approval: Record<string, unknown> };
    expect(granted.aer_approval).toMatchObject({ id, state: "approved", decided_by_user_id: USER_A, recorded_by: "aer-server" });
    const findings = await prisma.redactionFinding.findMany({ where: { runId } });
    expect(verifyChain(events.map((e) => toChainLink(e, findings)), null, runId)).toMatchObject({ ok: true });
  });

  it("an approval for A cannot be used for B: different params or a different action are refused, nothing is used", async () => {
    const runId = await newRun();
    const id = (await ask(runId)).body.approval.id as string;
    await decideApproval(scopeA, USER_A, id, "approve");
    expect((await consume(id, PAY_B)).body.error.message).toBe("approval_params_mismatch");
    expect((await consume(id, { ...PAY_A, action: "delete_customer" })).body.error.message).toBe("approval_action_mismatch");
    expect((await consume(id, { action: "refund", params: { ...PAY_A.params, extra: true } })).body.error.message).toBe("approval_params_mismatch");
    expect((await prisma.approval.findUniqueOrThrow({ where: { id } })).uses).toBe(0);
    expect((await consume(id)).status).toBe(200);
  });

  it("wrong tenant: another workspace can neither read, consume nor decide it (404)", async () => {
    const runId = await newRun();
    const id = (await ask(runId)).body.approval.id as string;
    const read = await getApprovalRoute(req("GET", `/api/v1/approvals/${id}`, { token: B.key }), ctx({ approval_id: id }));
    expect(read.status).toBe(404);
    await expect(decideApproval(scopeB, "user_b", id, "approve")).rejects.toMatchObject({ status: 404 });
    await decideApproval(scopeA, USER_A, id, "approve");
    expect((await consume(id, PAY_A, B.key)).status).toBe(404);
    const otherRun = await newRun(B.key);
    expect((await ask(otherRun, PAY_A, A.key)).status).toBe(404); // A's key can't request on B's run
  });

  it("the agent's API key cannot produce a verified approval", async () => {
    const runId = await newRun();
    const send = (body: Record<string, unknown>) =>
      addEvent(req("POST", `/api/v1/runs/${runId}/events`, { token: A.key, body }), ctx({ run_id: runId }));
    // Server-only event types and the reserved metadata key are refused.
    expect((await send({ type: "human_approval_used", title: "x" })).status).toBe(422);
    expect((await send({ type: "human_approval_rejected", title: "x" })).status).toBe(422);
    expect((await send({ type: "human_approval_granted", title: "ok", metadata: { aer_approval: { id: "forged" } } })).status).toBe(422);
    // A plain reported grant is accepted — and labelled as the agent's claim, not verified.
    expect((await send({ type: "human_approval_granted", title: "manager said yes" })).status).toBe(201);
    const ev = await prisma.agentEvent.findFirstOrThrow({ where: { runId, type: "human_approval_granted" } });
    expect(approvalBadge(ev.type, ev.metadata, new Set())).toBe("reported");
    // Even a legacy row carrying the key is not "verified" without a real Approval of this run.
    expect(approvalBadge("human_approval_granted", { aer_approval: { id: "forged" } }, new Set(["real"]))).toBe("reported");
  });

  it("expired, rejected, revoked and used-up approvals are refused", async () => {
    const runId = await newRun();
    const expired = (await ask(runId)).body.approval.id as string;
    await prisma.approval.update({ where: { id: expired }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(decideApproval(scopeA, USER_A, expired, "approve")).rejects.toMatchObject({ message: "approval_expired" });

    const approvedThenExpired = (await ask(runId)).body.approval.id as string;
    await decideApproval(scopeA, USER_A, approvedThenExpired, "approve");
    await prisma.approval.update({ where: { id: approvedThenExpired }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await consume(approvedThenExpired)).body.error.message).toBe("approval_expired");

    const rejected = (await ask(runId)).body.approval.id as string;
    await decideApproval(scopeA, USER_A, rejected, "reject");
    expect((await consume(rejected)).body.error.message).toBe("approval_rejected");

    const revoked = (await ask(runId)).body.approval.id as string;
    await decideApproval(scopeA, USER_A, revoked, "approve");
    await revokeApproval(scopeA, USER_A, revoked);
    expect((await consume(revoked)).body.error.message).toBe("approval_revoked");

    const twice = (await ask(runId, { ...PAY_A, maxUses: 2 })).body.approval.id as string;
    await decideApproval(scopeA, USER_A, twice, "approve");
    expect((await consume(twice)).status).toBe(200);
    expect((await consume(twice)).status).toBe(200);
    expect((await consume(twice)).body.error.message).toBe("approval_used_up");
    await expect(decideApproval(scopeA, USER_A, twice, "approve")).rejects.toMatchObject({ status: 409 });
  });

  it("concurrent consumes of a single-use approval: exactly one succeeds", async () => {
    const runId = await newRun();
    const id = (await ask(runId)).body.approval.id as string;
    await decideApproval(scopeA, USER_A, id, "approve");
    const results = await Promise.all(Array.from({ length: 8 }, () => consume(id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await prisma.approval.findUniqueOrThrow({ where: { id } })).uses).toBe(1);
  });

  it("a retried consume with the same Idempotency-Key replays instead of using the approval twice", async () => {
    const runId = await newRun();
    const id = (await ask(runId, { ...PAY_A, maxUses: 2 })).body.approval.id as string;
    await decideApproval(scopeA, USER_A, id, "approve");
    const h = { "idempotency-key": "consume-once-1" };
    expect((await consume(id, PAY_A, A.key, h)).status).toBe(200);
    const again = await consume(id, PAY_A, A.key, h);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect((await prisma.approval.findUniqueOrThrow({ where: { id } })).uses).toBe(1);
  });

  it("after the run is sealed nothing can be decided or used; the sealed packet verifies with the approval steps in it", async () => {
    const runId = await newRun();
    const id = (await ask(runId)).body.approval.id as string;
    await decideApproval(scopeA, USER_A, id, "approve");
    await completeRun(req("POST", `/api/v1/runs/${runId}/complete`, { token: A.key, body: { status: "completed" } }), ctx({ run_id: runId }));
    expect((await consume(id)).body.error.message).toBe("run_already_completed");
    await expect(revokeApproval(scopeA, USER_A, id)).rejects.toMatchObject({ status: 409 });
    const exp = await createExport(req("POST", `/api/v1/runs/${runId}/exports?type=json`, { token: A.key }), ctx({ run_id: runId }));
    const exportId = (await exp.json()).export.id as string;
    const dl = await downloadExport(req("GET", `/api/v1/runs/${runId}/exports/${exportId}/download`, { token: A.key }), ctx({ run_id: runId, export_id: exportId }));
    expect(verifyPacket(JSON.parse(await dl.text()))).toMatchObject({ overall: "verified", chain: { status: "verified" } });
  });

  it("the outcome is the application's claim: only after use, once, labelled as such; raw params are never stored", async () => {
    const runId = await newRun();
    const secretish = { action: "refund", params: { orderId: "ord-2002", contact: "ayse.yilmaz@example.com" } };
    const id = (await ask(runId, secretish)).body.approval.id as string;
    const out = (body: Record<string, unknown>) =>
      outcomeRoute(req("POST", `/api/v1/approvals/${id}/outcome`, { token: A.key, body }), ctx({ approval_id: id }));
    expect((await out({ status: "succeeded" })).status).toBe(409);
    await decideApproval(scopeA, USER_A, id, "approve");
    expect((await consume(id, secretish)).status).toBe(200);
    const ok = await out({ status: "succeeded", externalRef: "psp-tx-778" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).approval.outcome).toMatchObject({ status: "succeeded", external_ref: "psp-tx-778", source: "application" });
    expect((await out({ status: "failed" })).status).toBe(409);
    const row = await prisma.approval.findUniqueOrThrow({ where: { id } });
    expect(JSON.stringify(row)).not.toContain("ayse.yilmaz@example.com");
    const idem = await prisma.idempotencyRecord.findMany({ where: { organizationId: A.org } });
    expect(JSON.stringify(idem)).not.toContain("ord-2002");
  });

  it("request validation: TTL and use limits are bounded; unknown fields refused", async () => {
    const runId = await newRun();
    expect((await ask(runId, { ...PAY_A, ttlSeconds: 5 })).status).toBe(422);
    expect((await ask(runId, { ...PAY_A, ttlSeconds: 90_000 })).status).toBe(422);
    expect((await ask(runId, { ...PAY_A, maxUses: 11 })).status).toBe(422);
    expect((await ask(runId, { ...PAY_A, approvedBy: "agent" })).status).toBe(422);
  });
});

describe("collector-js 0.7 end to end", () => {
  it("SDK: request → (dashboard decision) → consume; a mismatch throws and must stop the action", async () => {
    const { AgentEvidenceRecorder, RecorderError } = await import("../../../packages/collector-js/src/index");
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(String(url), init);
      const path = new URL(String(url)).pathname;
      let m: RegExpExecArray | null;
      if ((m = /^\/api\/v1\/runs\/([^/]+)\/approvals$/.exec(path))) return requestApprovalRoute(request, ctx({ run_id: m[1] }));
      if ((m = /^\/api\/v1\/approvals\/([^/]+)\/consume$/.exec(path))) return consumeRoute(request, ctx({ approval_id: m[1] }));
      if ((m = /^\/api\/v1\/approvals\/([^/]+)\/outcome$/.exec(path))) return outcomeRoute(request, ctx({ approval_id: m[1] }));
      if ((m = /^\/api\/v1\/approvals\/([^/]+)$/.exec(path))) return getApprovalRoute(request, ctx({ approval_id: m[1] }));
      if ((m = /^\/api\/v1\/runs\/([^/]+)\/events$/.exec(path))) return addEvent(request, ctx({ run_id: m[1] }));
      return createRun(request);
    }) as typeof fetch;
    const recorder = new AgentEvidenceRecorder({ baseUrl: "http://aer.test", apiKey: A.key, fetchImpl, maxRetries: 0 });
    const run = await recorder.startRun({ agentName: "refund-agent" });
    const asked = await run.requestApproval({ ...PAY_A, ttlSeconds: 600 });
    expect(asked.status).toBe("pending");
    expect((await run.waitForApproval(asked.id, { timeoutMs: 600, pollMs: 500 })).status).toBe("pending");

    await decideApproval(scopeA, USER_A, asked.id, "approve"); // the human, in the dashboard

    await expect(run.consumeApproval(asked.id, PAY_B)).rejects.toSatisfy(
      (e: unknown) => e instanceof RecorderError && e.status === 409 && e.message === "approval_params_mismatch",
    );
    const used = await run.consumeApproval(asked.id, PAY_A);
    expect(used).toMatchObject({ status: "used_up", verified: true });
    const reported = await run.reportApprovalOutcome(asked.id, { status: "succeeded", externalRef: "psp-1" });
    expect(reported.outcome).toMatchObject({ source: "application" });

    await recorder.shutdown();
    await expect(run.requestApproval(PAY_A)).rejects.toSatisfy((e: unknown) => e instanceof RecorderError && e.code === "recorder_closed");
  });
});

describe("timeline labels (review R3)", () => {
  it("request, decision, use and reported are distinguished; only a real decision says 'signed-in user decision'", async () => {
    const runId = await newRun();
    const id = (await ask(runId)).body.approval.id as string;
    await decideApproval(scopeA, USER_A, id, "approve");
    expect((await consume(id)).status).toBe(200);
    const events = await prisma.agentEvent.findMany({ where: { runId }, orderBy: { seq: "asc" } });
    const ids = new Set([id]);
    expect(events.map((e) => approvalBadge(e.type, e.metadata, ids))).toEqual(["request", "decision", "use"]);
    // A "granted" without a deciding user, or not marked as server-recorded, is never a decision.
    expect(approvalBadge("human_approval_granted", { aer_approval: { id, state: "approved", recorded_by: "aer-server" } }, ids)).toBe("reported");
    expect(approvalBadge("human_approval_granted", { aer_approval: { id, state: "approved", decided_by_user_id: "u" } }, ids)).toBe("reported");
  });
});

describe("inputs the binding hash could merge are refused (review R4/R5)", () => {
  const raw = (path: string, body: string) =>
    new Request(`http://localhost${path}`, { method: "POST", headers: { authorization: `Bearer ${A.key}`, "content-type": "application/json" }, body });

  it.each([
    ["non-finite number (1e400 → Infinity → null)", '{"action":"refund","params":{"amount":1e400}}'],
    ["integer beyond 2^53", '{"action":"refund","params":{"amount":9007199254740993}}'],
    ["unpaired surrogate in the action", '{"action":"notify:\\ud800","params":{}}'],
    ["unpaired surrogate in a param value", '{"action":"refund","params":{"note":"x\\udc00"}}'],
    ["unpaired surrogate in a param key", '{"action":"refund","params":{"\\ud801":1}}'],
  ])("request with %s → 422, nothing created, value not echoed", async (_n, body) => {
    const runId = await newRun();
    const res = await requestApprovalRoute(raw(`/api/v1/runs/${runId}/approvals`, body), ctx({ run_id: runId }));
    expect(res.status).toBe(422);
    expect(await res.text()).not.toMatch(/9007199254740993|ud8|udc/);
    expect(await prisma.approval.count({ where: { runId } })).toBe(0);
  });

  it("consume with such inputs is refused before any comparison; the approval stays unused", async () => {
    const runId = await newRun();
    const id = (await ask(runId, { action: "refund", params: { amount: null } })).body.approval.id as string;
    await decideApproval(scopeA, USER_A, id, "approve");
    const c = (body: string) => consumeRoute(raw(`/api/v1/approvals/${id}/consume`, body), ctx({ approval_id: id }));
    expect((await c('{"action":"refund","params":{"amount":1e400}}')).status).toBe(422);
    expect((await c('{"action":"refund\\ud800","params":{"amount":null}}')).status).toBe(422);
    expect((await prisma.approval.findUniqueOrThrow({ where: { id } })).uses).toBe(0);
    expect((await c('{"action":"refund","params":{"amount":null}}')).status).toBe(200);
  });
});

describe("negative zero (review R7)", () => {
  it("-0 is refused (it canonicalises to 0, so an approval for -0 would accept 0)", async () => {
    const runId = await newRun();
    const res = await requestApprovalRoute(
      new Request(`http://localhost/api/v1/runs/${runId}/approvals`, {
        method: "POST",
        headers: { authorization: `Bearer ${A.key}`, "content-type": "application/json" },
        body: '{"action":"refund","params":{"amount":-0}}',
      }),
      ctx({ run_id: runId }),
    );
    expect(res.status).toBe(422);
    const id = (await ask(runId, { action: "refund", params: { amount: 0 } })).body.approval.id as string;
    await decideApproval(scopeA, USER_A, id, "approve");
    const c = await consumeRoute(
      new Request(`http://localhost/api/v1/approvals/${id}/consume`, {
        method: "POST",
        headers: { authorization: `Bearer ${A.key}`, "content-type": "application/json" },
        body: '{"action":"refund","params":{"amount":-0}}',
      }),
      ctx({ approval_id: id }),
    );
    expect(c.status).toBe(422);
    expect((await consume(id, { action: "refund", params: { amount: 0 } })).status).toBe(200);
  });
});
