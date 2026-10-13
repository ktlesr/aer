// Independent review (9d9a527) regression: the same request with its JSON keys in another order is
// the same request. Findings are collected in traversal order, so the fingerprint must sort them.
import { afterAll, beforeAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST as createRun } from "@/app/api/v1/runs/route";
import { POST as createEvent } from "@/app/api/v1/runs/[run_id]/events/route";
import { ctx, dropTenants, makeTenant, req } from "./support";

const ORG = "org_test_idem_order";
const KEY = "aer_test_idemOrderSyntheticOnly";
const A = "review-a@example.invalid";
const B = "review-b@example.invalid";

beforeAll(async () => { await makeTenant(ORG, KEY); });
afterAll(async () => { await dropTenants(ORG); await prisma.$disconnect(); });

it("run.create: same key, same meaning, different key order → replay, one run", async () => {
  const headers = { "idempotency-key": "order-run" };
  const first = await createRun(req("POST", "/api/v1/runs", { token: KEY, headers, body: { agentName: "r", metadata: { first: A, second: B } } }));
  const second = await createRun(req("POST", "/api/v1/runs", { token: KEY, headers, body: { agentName: "r", metadata: { second: B, first: A } } }));
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect(second.headers.get("idempotent-replayed")).toBe("true");
  expect((await second.json()).run.id).toBe((await first.json()).run.id);
});

it("event.create: same key, same meaning, different key order → replay, one event", async () => {
  const run = await (await createRun(req("POST", "/api/v1/runs", { token: KEY, body: { agentName: "r" } }))).json();
  const send = (input: Record<string, string>) =>
    createEvent(
      req("POST", `/api/v1/runs/${run.run.id}/events`, {
        token: KEY,
        headers: { "idempotency-key": "order-event" },
        body: { type: "tool_call", title: "t", input },
      }),
      ctx({ run_id: run.run.id }),
    );
  const first = await send({ first: A, second: B });
  const second = await send({ second: B, first: A });
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect(second.headers.get("idempotent-replayed")).toBe("true");
  expect(await prisma.agentEvent.count({ where: { runId: run.run.id } })).toBe(1);
});
