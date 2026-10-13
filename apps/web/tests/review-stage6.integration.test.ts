// Independent review (Codex, Stage 6 round 1), kept as regressions. One change: the "observation"
// test asserted the service ACCEPTED an own __proto__ key; following the reviewer's note the service
// now refuses it too (defence in depth), so that single assertion expects the 422 message.
// Independent review: synthetic records only; no replacement API implementation.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { RUN_TX, lockRun, readJson } from "@/lib/api/helpers";
import { requestApproval, decideApproval, consumeApproval, revokeApproval, paramsDigest } from "@/lib/approvals/service";
import { approvalBadge } from "@/lib/approvals/badge";
import { POST as completeRun } from "@/app/api/v1/runs/[run_id]/complete/route";
import { POST as createRun } from "@/app/api/v1/runs/route";
import { POST as createExport } from "@/app/api/v1/runs/[run_id]/exports/route";
import { GET as downloadExport } from "@/app/api/v1/runs/[run_id]/exports/[export_id]/download/route";
import { verifyPacket } from "@ktlsr/evidence-chain";
import { makeTenant, dropTenants, req, ctx } from "./support";

const org = `org_review6_${randomUUID()}`;
const token = `aer_test_${randomUUID().replaceAll("-", "")}`;
const scope = { organizationId: org, projectId: `${org}_proj` };
beforeAll(async () => {
  if (process.env.DATABASE_URL !== "postgresql://aer:aerpass@localhost:5440/aer_test?schema=public") throw new Error("Review DB guard");
  await makeTenant(org, token);
});
afterAll(async () => { await dropTenants(org); await prisma.$disconnect(); });
async function ask(action = "refund", params: unknown = {}) {
  const res = await createRun(req("POST", "/api/v1/runs", { token, body: { agentName: "review6" } }));
  expect(res.status).toBe(201);
  const runId = (await res.json()).run.id as string;
  return prisma.$transaction(tx => requestApproval(tx, scope, runId, { action, params }), RUN_TX);
}
const use = (id: string, action: string, params: unknown) => prisma.$transaction(tx => consumeApproval(tx, scope, id, action, params), RUN_TX);
const failure = async (operation: Promise<unknown>) => {
  try { await operation; return "accepted"; }
  catch (error) { return error instanceof Error ? error.message : "unknown_error"; }
};

it("security: different action names must not share approval after redaction", async () => {
  const a = await ask("notify:alice@example.com");
  await decideApproval(scope, "review-user", a.id, "approve");
  expect(await failure(use(a.id, "notify:bob@example.com", {}))).toBe("approval_action_mismatch");
});

it("observation: direct service collides on __proto__, existing HTTP parser rejects it", async () => {
  const a = await ask("refund", { amount: 1 });
  await decideApproval(scope, "review-user", a.id, "approve");
  const changed: unknown = JSON.parse('{"amount":1,"__proto__":{"destination":"other"}}');
  expect(await failure(readJson(req("POST", "/review", { body: changed })))).toBe('Keys named "__proto__" are not accepted');
  // This bypasses the existing HTTP input guard; it is not an HTTP exploit repro.
  expect(paramsDigest(a.paramsSalt, changed)).toBe(a.paramsHash);
  expect(await failure(use(a.id, "refund", changed))).toBe('Keys named "__proto__" are not accepted');
});

it("security: pending server request is not a verified signed-in user decision", async () => {
  const a = await ask();
  expect(a.status).toBe("pending");
  expect(a.decidedByUserId).toBeNull();
  const event = await prisma.agentEvent.findFirstOrThrow({ where: { runId: a.runId } });
  expect(approvalBadge(event.type, event.metadata, new Set([a.id]))).not.toBe("verified");
});

it("control: changed ordinary parameters, tenant, expiry, revocation and repeated use refused", async () => {
  const a = await ask("refund", { amount: 1 });
  await expect(decideApproval({ organizationId: "review_foreign", projectId: "review_foreign" }, "review-user", a.id, "approve")).rejects.toMatchObject({ status: 404 });
  await decideApproval(scope, "review-user", a.id, "approve");
  await expect(use(a.id, "refund", { amount: 2 })).rejects.toMatchObject({ message: "approval_params_mismatch" });
  await use(a.id, "refund", { amount: 1 });
  await expect(use(a.id, "refund", { amount: 1 })).rejects.toMatchObject({ message: "approval_used_up" });
  const expired = await ask();
  await prisma.approval.update({ where: { id: expired.id }, data: { expiresAt: new Date(0) } });
  await expect(decideApproval(scope, "review-user", expired.id, "approve")).rejects.toMatchObject({ message: "approval_expired" });
  const revoked = await ask();
  await decideApproval(scope, "review-user", revoked.id, "approve");
  await revokeApproval(scope, "review-user", revoked.id);
  await expect(use(revoked.id, "refund", {})).rejects.toMatchObject({ message: "approval_revoked" });
});

it("control: approval steps in a sealed export verify", async () => {
  const a = await ask();
  await decideApproval(scope, "review-user", a.id, "approve");
  await use(a.id, "refund", {});
  const complete = await completeRun(req("POST", `/api/v1/runs/${a.runId}/complete`, { token, body: { status: "completed" } }), ctx({ run_id: a.runId }));
  expect(complete.status).toBe(200);
  const exp = await createExport(req("POST", `/api/v1/runs/${a.runId}/exports?type=json`, { token }), ctx({ run_id: a.runId }));
  const exportId = (await exp.json()).export.id as string;
  const dl = await downloadExport(req("GET", `/api/v1/runs/${a.runId}/exports/${exportId}/download`, { token }), ctx({ run_id: a.runId, export_id: exportId }));
  expect(verifyPacket(JSON.parse(await dl.text()))).toMatchObject({ overall: "verified" });
});

it("control: salted digest varies by salt and ignores ordinary object key order", () => {
  expect(paramsDigest("a", { x: 1, y: 2 })).toBe(paramsDigest("a", { y: 2, x: 1 }));
  expect(paramsDigest("a", { x: 1 })).not.toBe(paramsDigest("b", { x: 1 }));
});

// Hold the actual run lock until all contenders are observed waiting on a PostgreSQL lock.
// Bounded polling observes synchronization; timing is not used to infer correctness.
async function race(runId: string, operations: (() => Promise<unknown>)[]) {
  let signalReady!: () => void;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { signalReady = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const held = prisma.$transaction(async tx => { await lockRun(tx, runId, scope); signalReady(); await gate; }, RUN_TX);
  await ready;
  const results = Promise.allSettled(operations.map(operation => operation()));
  let observed = false;
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const counts = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%SELECT "id" FROM "AgentRun"%'`;
      if (counts[0].count >= operations.length) { observed = true; break; }
    }
  } finally { release(); await held; }
  const settled = await results;
  expect(observed).toBe(true);
  return settled;
}

it("control: deterministic PostgreSQL consume, decision and revoke races", async () => {
  const a = await ask();
  await decideApproval(scope, "review-user", a.id, "approve");
  const consumes = await race(a.runId, Array.from({ length: 8 }, () => () => use(a.id, "refund", {})));
  expect(consumes.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect((await prisma.approval.findUniqueOrThrow({ where: { id: a.id } })).uses).toBe(1);
  const pending = await ask();
  const decisions = await race(pending.runId, [
    () => decideApproval(scope, "review-user", pending.id, "approve"),
    () => decideApproval(scope, "review-user", pending.id, "reject"),
  ]);
  expect(decisions.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const approved = await ask();
  await decideApproval(scope, "review-user", approved.id, "approve");
  const revokeUse = await race(approved.runId, [
    () => revokeApproval(scope, "review-user", approved.id),
    () => use(approved.id, "refund", {}),
  ]);
  expect(revokeUse.filter(result => result.status === "fulfilled")).toHaveLength(1);
});

it("control: SDK direct retries keep the key, preserve 409 and refuse after shutdown", async () => {
  const { AgentEvidenceRecorder } = await import("../../../packages/collector-js/src/index");
  const keys: (string | null)[] = [];
  let calls = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    calls++;
    const path = new URL(String(url)).pathname;
    if (path === "/api/v1/runs") return Response.json({ run: { id: "review-run" } });
    if (path.endsWith("/consume")) return Response.json({ error: { code: "conflict", message: "approval_pending" } }, { status: 409 });
    keys.push(new Headers(init?.headers).get("idempotency-key"));
    if (keys.length === 1) return Response.json({ error: { code: "temporary" } }, { status: 503 });
    return Response.json({ approval: { id: "review-approval", status: "pending" } });
  };
  const recorder = new AgentEvidenceRecorder({ baseUrl: "http://localhost", apiKey: token, fetchImpl, maxRetries: 1 });
  const run = await recorder.startRun({ agentName: "review6" });
  await run.requestApproval({ action: "refund" });
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[0]).toBe(keys[1]);
  expect(await failure(run.consumeApproval("review-approval", { action: "refund" }))).toBe("approval_pending");
  await recorder.shutdown();
  const before = calls;
  expect(await failure(run.getApproval("review-approval"))).toBe("Recorder is shut down; nothing was sent");
  expect(calls).toBe(before);
});
