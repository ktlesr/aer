// Independent review (Codex, Stage 6 round 3), renamed to *.integration.test.ts. One test adapted:
// the R7 repro assumed -0 stays accepted and is told apart from 0 at consume (409). The fix chosen
// refuses -0 outright (422) — canonical/1 cannot tell -0 from 0, and any side channel to do so adds
// its own collision surface. Same security property: no approval for -0 can authorise 0. The two
// "current behaviour" lines below were changed accordingly; see docs/hardening/06 §10 (3rd round).
// Independent review: real routes + PostgreSQL, not a running HTTP server.
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { decideApproval, unsupportedApprovalValue, paramsDigest, actionDigest } from "@/lib/approvals/service";
import { POST as createRun } from "@/app/api/v1/runs/route";
import { POST as createApproval } from "@/app/api/v1/runs/[run_id]/approvals/route";
import { POST as consumeApproval } from "@/app/api/v1/approvals/[approval_id]/consume/route";
import { makeTenant, dropTenants, req, ctx } from "./support";

const org = `org_review6_r3route_${randomUUID()}`;
const token = `aer_test_${randomUUID().replaceAll("-", "")}`;
const scope = { organizationId: org, projectId: `${org}_proj` };
beforeAll(async () => {
  if (process.env.DATABASE_URL !== "postgresql://aer:aerpass@localhost:5440/aer_test?schema=public") throw new Error("Review DB guard");
  await makeTenant(org, token);
});
afterAll(async () => { await dropTenants(org); await prisma.$disconnect(); });
const raw = (params: string) => new Request("http://localhost/review", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: `{"action":"transform","params":${params}}`,
});
async function run() {
  const res = await createRun(req("POST", "/api/v1/runs", { token, body: { agentName: "review6-r3" } }));
  expect(res.status).toBe(201);
  return (await res.json()).run.id as string;
}
async function approved(runId: string, params: string) {
  const res = await createApproval(raw(params), ctx({ run_id: runId }));
  expect(res.status).toBe(201);
  const id = (await res.json()).approval.id as string;
  await decideApproval(scope, "review-round3-user", id, "approve");
  return id;
}
it("security: negative zero is representable but must not authorize positive zero", async () => {
  expect(Object.is(JSON.parse("-0"), -0)).toBe(true);
  expect(unsupportedApprovalValue(-0)).toMatch(/negative zero/); // adapted: refused, not hashed
  await expect(approved(await run(), '{"nested":[{"direction":-0}]}')).rejects.toBeTruthy(); // adapted: create refused
  const id = await approved(await run(), '{"nested":[{"direction":0}]}');
  const res = await consumeApproval(raw('{"nested":[{"direction":-0}]}'), ctx({ approval_id: id }));
  const row = await prisma.approval.findUniqueOrThrow({ where: { id } });
  // Save actual outcome independently of the expected security assertion, without values/secrets.
  expect({ status: res.status, uses: row.uses }).toEqual({ status: 422, uses: 0 }); // adapted: 409 → 422
});
it("control: Unicode, nested shapes, fractions and key order", async () => {
  const runId = await run();
  for (const [a, b] of [
    ['{"text":"é"}', '{"text":"e\\u0301"}'],
    ['{"x":[1,2]}', '{"x":{"0":1,"1":2}}'],
    ['{"x":[{"v":0.1}]}', '{"x":[{"v":0.10000000000000002}]}'],
    ['{"x":1e-300}', '{"x":2e-300}'],
    ['{"x":null}', '{}'],
    ['{"constructor":{"x":1}}', '{"constructor":{"x":2}}'],
  ]) {
    const id = await approved(runId, a);
    expect((await consumeApproval(raw(b), ctx({ approval_id: id }))).status).toBe(409);
  }
  const id = await approved(runId, '{"b":[2],"a":1}');
  expect((await consumeApproval(raw('{"a":1,"b":[2]}'), ctx({ approval_id: id }))).status).toBe(200);
});
it("control: R4/R5 and recursive invalid inputs rejected; parser rounding documented", async () => {
  const runId = await run();
  for (const params of ['{"x":[1e400]}', '{"x":[9007199254740992]}', '{"x":["\\ud800"]}', '{"x":{"\\ud801":1}}']) {
    expect((await createApproval(raw(params), ctx({ run_id: runId }))).status).toBe(422);
  }
  const malformedAction = new Request("http://localhost/review", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: '{"action":"notify:\\ud800","params":{}}' });
  expect((await createApproval(malformedAction, ctx({ run_id: runId }))).status).toBe(422);
  for (const params of ['{"x":1.00000000000000001}', '{"x":1e-400}']) {
    const id = await approved(runId, params);
    expect((await consumeApproval(raw(JSON.stringify(JSON.parse(params))), ctx({ approval_id: id }))).status).toBe(200);
  }
  // Hash preimage checks use production functions, never reimplement canonicalization.
  expect(paramsDigest("synthetic-salt", { x: -0 })).toBe(paramsDigest("synthetic-salt", { x: 0 }));
  expect(actionDigest("synthetic-salt", "é")).not.toBe(actionDigest("synthetic-salt", "e\u0301"));
});
