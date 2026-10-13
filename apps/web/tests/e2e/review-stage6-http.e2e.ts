// Independent review (Codex, Stage 6 round 2), kept verbatim. NOT in the default suite: it needs a running app.
// (Moved to tests/e2e/: the only edit is the import path "./support" → "../support".)
// Run: build, then start the app on :3156 against aer_test (DATABASE_URL + AUTH_SECRET), then
//   DATABASE_URL=postgresql://aer:aerpass@localhost:5440/aer_test?schema=public pnpm --filter web exec vitest run --dir tests/e2e --include "**/*.e2e.ts"
// Independent round 2: real localhost HTTP + Auth.js sessions; synthetic data only.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { decideApproval, revokeApproval, actionDigest, paramsDigest } from "@/lib/approvals/service";
import { fingerprint } from "@/lib/api/idempotency";
import { redactFields } from "@/lib/api/helpers";
import { makeTenant, dropTenants } from "../support";

const base = "http://localhost:3156";
const tag = randomUUID();
const org = `org_review6_http_${tag}`;
const other = `${org}_other`;
const token = `aer_test_${randomUUID().replaceAll("-", "")}`;
const tokenB = `aer_test_${randomUUID().replaceAll("-", "")}`;
const user = `user_review6_http_${tag}`;
const userB = `${user}_other`;
const scope = { organizationId: org, projectId: `${org}_proj` };
const password = randomUUID();
const input = { action: "notify:alice@example.com", params: { password: "synthetic-private-value", contact: "alice@example.com", amount: 1 } };

beforeAll(async () => {
  if (process.env.DATABASE_URL !== "postgresql://aer:aerpass@localhost:5440/aer_test?schema=public") throw new Error("Review DB guard");
  await makeTenant(org, token);
  await makeTenant(other, tokenB);
  const passwordHash = await bcrypt.hash(password, 4);
  await prisma.user.createMany({ data: [
    { id: user, email: `${user}@example.test`, passwordHash },
    { id: userB, email: `${userB}@example.test`, passwordHash },
  ] });
  await prisma.organization.update({ where: { id: org }, data: { ownerUserId: user } });
  await prisma.organization.update({ where: { id: other }, data: { ownerUserId: userB } });
});
afterAll(async () => {
  await dropTenants(org, other);
  await prisma.user.deleteMany({ where: { id: { in: [user, userB] } } });
  await prisma.$disconnect();
});

async function api(path: string, body?: unknown, key = token, idem?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  if (idem) headers["idempotency-key"] = idem;
  const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, replay: response.headers.get("idempotent-replayed"), data: await response.json() };
}
async function run() {
  const result = await api("/api/v1/runs", { agentName: "review6-http" });
  expect(result.status).toBe(201);
  return result.data.run.id as string;
}
const ask = (id: string, body: unknown = input, idem?: string) => api(`/api/v1/runs/${id}/approvals`, body, token, idem);
const consume = (id: string, body: unknown = input, idem?: string) => api(`/api/v1/approvals/${id}/consume`, body, token, idem);

async function login(id: string) {
  const jar = new Map<string, string>();
  async function send(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await fetch(base + path, { ...init, headers, redirect: "manual" });
    for (const cookie of res.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const pos = pair.indexOf("=");
      jar.set(pair.slice(0, pos), pair.slice(pos + 1));
    }
    return res;
  }
  const csrf = await send("/api/auth/csrf");
  const { csrfToken } = await csrf.json();
  await send("/api/auth/callback/credentials", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-auth-return-redirect": "1", origin: base },
    body: new URLSearchParams({ csrfToken, email: `${id}@example.test`, password, callbackUrl: base + "/runs" }),
  });
  const session = await (await send("/api/auth/session")).json();
  expect(session.user?.id === id).toBe(true);
  return send;
}

it("real HTTP: isolation, API-key forgery, TTL/maxUses, salted fingerprints and replay", async () => {
  const runId = await run();
  const asked = await ask(runId, input, "http-create");
  expect(asked.status).toBe(201);
  const id = asked.data.approval.id as string;
  expect(asked.data.approval.status).toBe("pending");
  expect((await ask(runId, input, "http-create")).replay).toBe("true");
  expect((await ask(runId, { ...input, params: { ...input.params, amount: 2 } }, "http-create")).status).toBe(409);
  for (const path of [`/api/v1/approvals/${id}`, `/api/v1/approvals/${id}/consume`, `/api/v1/approvals/${id}/outcome`]) {
    const body = path.endsWith("consume") ? input : path.endsWith("outcome") ? { status: "succeeded" } : undefined;
    expect((await api(path, body, tokenB)).status).toBe(404);
  }
  for (const addition of [{ status: "approved" }, { decidedByUserId: user }, { ttlSeconds: 29 }, { ttlSeconds: 86401 }, { ttlSeconds: 30.5 }, { maxUses: 0 }, { maxUses: 11 }, { maxUses: 1.5 }]) {
    expect((await ask(runId, { ...input, ...addition })).status).toBe(422);
  }
  expect((await consume(id)).data.error.message).toBe("approval_pending");
  expect((await api(`/api/v1/runs/${runId}/events`, { type: "human_approval_granted", title: "synthetic", metadata: { aer_approval: { id, recorded_by: "aer-server", state: "approved", decided_by_user_id: user } } })).status).toBe(422);
  expect((await api(`/api/v1/runs/${runId}/events`, { type: "human_approval_granted", title: "synthetic reported approval" })).status).toBe(201);
  expect((await prisma.approval.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
  await decideApproval(scope, user, id, "approve");
  expect((await consume(id, { ...input, action: "notify:bob@example.com" })).data.error.message).toBe("approval_action_mismatch");
  expect((await consume(id, { ...input, params: { ...input.params, password: "different-synthetic-value" } })).data.error.message).toBe("approval_params_mismatch");
  expect((await consume(id, input, "http-consume")).status).toBe(200);
  expect((await consume(id)).data.error.message).toBe("approval_used_up");
  expect((await consume(id, { ...input, action: "notify:bob@example.com" }, "http-consume")).status).toBe(409);
  await prisma.approval.update({ where: { id }, data: { expiresAt: new Date(0) } });
  expect((await consume(id, input, "http-consume")).replay).toBe("true");
  expect((await prisma.approval.findUniqueOrThrow({ where: { id } })).uses).toBe(1);
  const records = await prisma.idempotencyRecord.findMany({ where: { organizationId: org, operation: { startsWith: "approval." } } });
  const row = await prisma.approval.findUniqueOrThrow({ where: { id } });
  expect(JSON.stringify(records).includes(input.params.password)).toBe(false);
  expect(JSON.stringify(records).includes("alice@example.com")).toBe(false);
  const { values } = redactFields({ action: input.action, params: input.params });
  expect(records.find(r => r.key === "http-create")?.requestHash === fingerprint({ ...values, ttlSeconds: null, maxUses: null })).toBe(true);
  expect(records.find(r => r.key === "http-consume")?.requestHash === fingerprint({ id, digest: { action: actionDigest(row.paramsSalt, input.action), params: paramsDigest(row.paramsSalt, input.params) } })).toBe(true);
  const bounded = (await ask(runId, { ...input, ttlSeconds: 30, maxUses: 2 })).data.approval.id as string;
  await decideApproval(scope, user, bounded, "approve");
  expect((await consume(bounded)).status).toBe(200);
  await revokeApproval(scope, user, bounded);
  expect((await consume(bounded)).data.error.message).toBe("approval_revoked");
  const multi = (await ask(runId, { ...input, maxUses: 2 })).data.approval.id as string;
  await decideApproval(scope, user, multi, "approve");
  const uses = await Promise.all(Array.from({ length: 4 }, () => consume(multi)));
  expect(uses.filter(r => r.status === 200)).toHaveLength(2);
  expect((await prisma.approval.findUniqueOrThrow({ where: { id: multi } })).uses).toBe(2);
  expect((await api(`/api/v1/approvals/${multi}/outcome`, { status: "succeeded" })).status).toBe(200);
  expect((await api(`/api/v1/approvals/${multi}/outcome`, { status: "failed" })).status).toBe(409);
  expect((await api(`/api/v1/approvals/${multi}/outcome`, { status: "failed" }, tokenB)).status).toBe(404);
  const expired = (await ask(runId, { ...input, ttlSeconds: 30 })).data.approval.id as string;
  await decideApproval(scope, user, expired, "approve");
  await prisma.approval.update({ where: { id: expired }, data: { expiresAt: new Date(0) } });
  expect((await consume(expired)).data.error.message).toBe("approval_expired");
  expect((await api(`/api/v1/approvals/${expired}`)).data.approval.status).toBe("expired");
  const proto = JSON.parse('{"action":"refund","params":{"__proto__":{"x":1}}}');
  expect((await ask(runId, proto)).status).toBe(422);
  expect((await consume(expired, proto)).status).toBe(422);
}, 120_000);

it("real Auth.js/server action: owner approval, foreign/anonymous rejection, ignored form identities and CSRF", async () => {
  const owner = await login(user);
  const foreign = await login(userB);
  const runId = await run();
  const id = (await ask(runId)).data.approval.id as string;
  const page = await owner(`/runs/${runId}`);
  expect(page.status).toBe(200);
  const html = await page.text();
  // The page also has a sign-out form; select the approval form by its button text.
  const approvalForm = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/g)?.find(f => />Approve<\/button>/.test(f));
  const action = approvalForm?.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
  expect(Boolean(action)).toBe(true);
  const form = () => {
    const f = new FormData();
    f.set(action!, ""); f.set("approvalId", id);
    f.set("userId", userB); f.set("organizationId", other); f.set("projectId", `${other}_proj`);
    return f;
  };
  await foreign(`/runs/${runId}`, { method: "POST", headers: { origin: base }, body: form() });
  expect((await prisma.approval.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
  const anonymous = await fetch(`${base}/runs/${runId}`, { method: "POST", headers: { origin: base, authorization: `Bearer ${token}` }, body: form(), redirect: "manual" });
  await anonymous.text();
  expect((await prisma.approval.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
  const csrf = await owner(`/runs/${runId}`, { method: "POST", headers: { origin: "http://localhost:3999" }, body: form() });
  await csrf.text();
  expect((await prisma.approval.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
  const ok = await owner(`/runs/${runId}`, { method: "POST", headers: { origin: base }, body: form() });
  await ok.text();
  const decided = await prisma.approval.findUniqueOrThrow({ where: { id } });
  expect(decided.status).toBe("approved");
  expect(decided.decidedByUserId === user).toBe(true);
}, 120_000);

it("security: non-finite JSON number must not authorize a different null parameter", async () => {
  const runId = await run();
  const response = await fetch(`${base}/api/v1/runs/${runId}/approvals`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: '{"action":"refund","params":{"amount":1e400}}',
  });
  // Either reject the unrepresentable number, or preserve a distinct binding.
  if (response.status === 422) return;
  expect(response.status).toBe(201);
  const id = (await response.json()).approval.id as string;
  await decideApproval(scope, user, id, "approve");
  const changed = await consume(id, { action: "refund", params: { amount: null } });
  expect(changed.status).toBe(409);
}, 120_000);

it("security: distinct lone-surrogate action names must not share a UTF-8 digest", async () => {
  const runId = await run();
  const requested = await ask(runId, { action: "notify:\ud800", params: {} });
  if (requested.status === 422) return;
  expect(requested.status).toBe(201);
  const id = requested.data.approval.id as string;
  await decideApproval(scope, user, id, "approve");
  expect((await consume(id, { action: "notify:\ud801", params: {} })).status).toBe(409);
}, 120_000);
