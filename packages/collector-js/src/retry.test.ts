// Retry + idempotency behaviour of the transport. Stdlib only (node:test), fake fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentEvidenceRecorder, RecorderError } from "./index.js";

type Handler = (init: RequestInit, n: number) => Promise<Response> | Response;

function recorder(handler: Handler, opts: { timeoutMs?: number; maxRetries?: number } = {}) {
  const keys: string[] = [];
  let n = 0;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    keys.push((init?.headers as Record<string, string>)["idempotency-key"]);
    return handler(init ?? {}, ++n);
  }) as typeof fetch;
  return { keys, rec: new AgentEvidenceRecorder({ baseUrl: "http://aer.test", apiKey: "k", fetchImpl, ...opts }) };
}

const ok = () => new Response(JSON.stringify({ run: { id: "r1" } }), { status: 201 });

test("one logical call keeps one Idempotency-Key across all its retries", async () => {
  const { keys, rec } = recorder((_i, n) => {
    if (n < 3) throw new TypeError("socket hang up");
    return ok();
  });
  await rec.startRun({ agentName: "a" });
  assert.equal(keys.length, 3);
  assert.equal(new Set(keys).size, 1);
  assert.match(keys[0], /^[A-Za-z0-9._:-]{1,200}$/);
});

test("separate calls get separate keys; a caller-supplied key is used as-is and not sent in the body", async () => {
  let lastBody = "";
  const { keys, rec } = recorder((init) => {
    lastBody = String(init.body);
    return ok();
  });
  await rec.startRun({ agentName: "a" });
  await rec.startRun({ agentName: "a" });
  await rec.startRun({ agentName: "a", idempotencyKey: "job-42:start" });
  assert.notEqual(keys[0], keys[1]);
  assert.equal(keys[2], "job-42:start");
  assert.ok(!lastBody.includes("idempotencyKey"));
});

test("the timeout also covers reading the body", async () => {
  const { rec } = recorder((init) => {
    const signal = init.signal as AbortSignal;
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"run":'));
        signal.addEventListener("abort", () => c.error(new Error("aborted")));
      },
    });
    return new Response(stream, { status: 201 });
  }, { timeoutMs: 50, maxRetries: 0 });
  await assert.rejects(rec.startRun({ agentName: "a" }), (e: RecorderError) => e.code === "network" && e.status === 0);
});

test("a non-JSON error page keeps its HTTP status, is retried on 5xx, and is never quoted", async () => {
  const page = "<html>upstream error for apiKey=k body=secret-payload</html>";
  const { keys, rec } = recorder(() => new Response(page, { status: 502 }), { maxRetries: 1 });
  await assert.rejects(rec.startRun({ agentName: "a" }), (e: RecorderError) => {
    assert.equal(e.status, 502);
    assert.ok(!e.message.includes("secret-payload") && !e.message.includes("<html>"));
    return true;
  });
  assert.equal(keys.length, 2);
});

test("4xx (including 409 conflict) is not retried", async () => {
  const { keys, rec } = recorder(
    () => new Response(JSON.stringify({ error: { code: "conflict", message: "m", request_id: "r" } }), { status: 409 }),
  );
  await assert.rejects(rec.startRun({ agentName: "a" }), (e: RecorderError) => e.code === "conflict" && e.status === 409);
  assert.equal(keys.length, 1);
});
