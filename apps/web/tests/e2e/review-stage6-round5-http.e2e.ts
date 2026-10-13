// Independent review (Codex, Stage 6 round 5), kept verbatim. NOT in the default suite: needs the app running on :3156 against aer_test (see review-stage6-http.e2e.ts for how to run).
// Round 5: real localhost HTTP/Auth.js; only synthetic aer_test fixtures.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";



import { makeTenant, dropTenants } from "../support";

const base = "http://localhost:3156";
const tag = randomUUID();
const org = `org_review6_r5http_${tag}`;
const other = `${org}_other`;
const token = `aer_test_${randomUUID().replaceAll("-", "")}`;
const tokenB = `aer_test_${randomUUID().replaceAll("-", "")}`;
const user = `user_review6_http_${tag}`;
const userB = `${user}_other`;

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

async function pageHtml(send: Awaited<ReturnType<typeof login>>, runId: string) {
  const response = await send(`/runs/${runId}`);
  expect(response.status).toBe(200);
  return response.text();
}
async function decideViaHttp(send: Awaited<ReturnType<typeof login>>, runId: string, id: string, label: string) {
  const html = await pageHtml(send, runId);
  const selected = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/g)?.find(f =>
    f.includes(`value="${id}"`) && f.includes(`>${label}</button>`));
  const action = selected?.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
  expect(Boolean(action)).toBe(true);
  const body = new FormData();
  body.set(action!, ""); body.set("approvalId", id);
  const response = await send(`/runs/${runId}`, { method: "POST", headers: { origin: base }, body });
  expect([200, 303]).toContain(response.status);
  await response.text();
}

it("R5 HTTP: session decisions, reject/revoke/used/expiry and rendered trust labels", async () => {
  const owner = await login(user);
  const runId = await run();
  expect((await api(`/api/v1/runs/${runId}/events`, {
    type: "human_approval_granted", title: "synthetic reported decision",
  })).status).toBe(201);
  const id = (await ask(runId)).data.approval.id as string;
  let html = await pageHtml(owner, runId);
  expect(html.includes("Reported by the agent")).toBe(true);
  expect(html.includes("not verified")).toBe(true);
  expect(html.includes("no decision yet at this point")).toBe(true);
  expect(html.includes("signed-in user decision")).toBe(false);
  await decideViaHttp(owner, runId, id, "Approve");
  const approval = await prisma.approval.findUniqueOrThrow({ where: { id } });
  expect(approval.status).toBe("approved");
  expect(approval.decidedByUserId === user).toBe(true);
  expect(approval.runId === runId).toBe(true);
  expect((await consume(id, { ...input, action: "notify:bob@example.com" })).status).toBe(409);
  expect((await consume(id, { ...input, params: { ...input.params, amount: 2 } })).status).toBe(409);
  expect((await consume(id)).status).toBe(200);
  expect((await consume(id)).data.error.message).toBe("approval_used_up");
  expect((await api(`/api/v1/approvals/${id}/outcome`, {
    status: "succeeded", externalRef: "synthetic-receipt-r5",
  })).status).toBe(200);
  html = await pageHtml(owner, runId);
  expect(html.includes("signed-in user decision")).toBe(true);
  expect(html.includes("approval used for the matching action")).toBe(true);
  expect(html.includes("Reported by the agent")).toBe(true);
  expect(html.includes("Outcome reported by the application (not verified)")).toBe(true);
  expect(html.includes("synthetic-receipt-r5")).toBe(true);
  expect(html.includes("it does not stop the action itself")).toBe(true);
  expect(html.includes(input.params.password)).toBe(false);

  const rejected = (await ask(runId)).data.approval.id as string;
  await decideViaHttp(owner, runId, rejected, "Reject");
  expect((await consume(rejected)).data.error.message).toBe("approval_rejected");
  const rejectedRow = await prisma.approval.findUniqueOrThrow({ where: { id: rejected } });
  expect(rejectedRow.status).toBe("rejected");
  expect(rejectedRow.decidedByUserId === user).toBe(true);

  const revoked = (await ask(runId)).data.approval.id as string;
  await decideViaHttp(owner, runId, revoked, "Approve");
  await decideViaHttp(owner, runId, revoked, "Revoke");
  expect((await consume(revoked)).data.error.message).toBe("approval_revoked");

  const expired = (await ask(runId)).data.approval.id as string;
  await decideViaHttp(owner, runId, expired, "Approve");
  // Move only this synthetic fixture into the past; no sleep-dependent TTL assertion.
  await prisma.approval.update({ where: { id: expired }, data: { expiresAt: new Date(0) } });
  expect((await consume(expired)).data.error.message).toBe("approval_expired");
}, 120_000);

it("R7 HTTP: negative zero refuses writes; positive zero is approved by a real session", async () => {
  const owner = await login(user);
  const runId = await run();
  const raw = (path: string, body: string, idem?: string) => fetch(base + path, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json",
      ...(idem ? { "idempotency-key": idem } : {}) }, body,
  });
  const path = `/api/v1/runs/${runId}/approvals`;
  for (const params of ["-0", "-0.0", "-0e100", '{"nested":[{"direction":-0}]}']) {
    expect((await raw(path, `{"action":"transform","params":${params}}`)).status).toBe(422);
  }
  expect(await prisma.approval.count({ where: { runId } })).toBe(0);
  expect(await prisma.agentEvent.count({ where: { runId } })).toBe(0);
  const positive = '{"action":"transform","params":{"nested":[{"direction":0}]}}';
  const response = await raw(path, positive);
  expect(response.status).toBe(201);
  const id = (await response.json()).approval.id as string;
  await decideViaHttp(owner, runId, id, "Approve");
  const before = await prisma.agentEvent.count({ where: { runId } });
  expect((await raw(`/api/v1/approvals/${id}/consume`, positive.replace(':0}', ':-0}'), "r5-negative-zero")).status).toBe(422);
  expect((await prisma.approval.findUniqueOrThrow({ where: { id } })).uses).toBe(0);
  expect(await prisma.agentEvent.count({ where: { runId } })).toBe(before);
  expect(await prisma.idempotencyRecord.count({ where: { organizationId: org, key: "r5-negative-zero" } })).toBe(0);
  expect((await raw(`/api/v1/approvals/${id}/consume`, positive)).status).toBe(200);
}, 120_000);

it("Auth.js HTTP: missing or invalid CSRF token cannot create a credentials session", async () => {
  for (const csrfToken of [undefined, "synthetic-invalid-csrf"]) {
    const csrfResponse = await fetch(base + "/api/auth/csrf", { redirect: "manual" });
    await csrfResponse.text();
    const cookies = csrfResponse.headers.getSetCookie().map(c => c.split(";", 1)[0]).join("; ");
    const body = new URLSearchParams({ email: `${user}@example.test`, password, callbackUrl: base + "/runs" });
    if (csrfToken !== undefined) body.set("csrfToken", csrfToken);
    const response = await fetch(base + "/api/auth/callback/credentials", {
      method: "POST", redirect: "manual", headers: { cookie: cookies, origin: base,
        "content-type": "application/x-www-form-urlencoded", "x-auth-return-redirect": "1" }, body,
    });
    const result = await response.json();
    expect(result.url.includes("MissingCSRF")).toBe(true);
    const jar = new Map<string, string>();
    for (const cookie of [...csrfResponse.headers.getSetCookie(), ...response.headers.getSetCookie()]) {
      const pair = cookie.split(";", 1)[0]; const pos = pair.indexOf("=");
      jar.set(pair.slice(0, pos), pair.slice(pos + 1));
    }
    const session = await fetch(base + "/api/auth/session", { headers: {
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    } });
    expect(await session.json()).toBeNull();
  }
}, 120_000);