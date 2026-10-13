// Sourced-assistant profile on the client: what crosses the capture boundary, and whether the
// SDK tells the caller when an (older) server dropped the new fields.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentEvidenceRecorder, type CaptureOptions, type SourcedEvidence } from "./index.js";

const SOURCED: SourcedEvidence = {
  profile: "sourced_assistant",
  version: 1,
  context: { used: [{ key: "ilce", value: "Milas", origin: "user_stated" }] },
  citedSources: [{ id: "9903_karar.madde_9", version: "2024-v1" }],
  claimSourceLinks: [{ claim: "synthetic-claim-text", sourceIds: ["9903_karar.madde_9"], basis: "model_declared" }],
};

/** Fake server. `echo` = behave like a server that knows the profile (0.4+), else like an old one. */
function recorder(capture: CaptureOptions | undefined, sent: Array<Record<string, unknown>>, echo = true) {
  const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    sent.push(body);
    const res = "agentName" in body
      ? { run: { id: "run_1", ...(echo ? { conversationRef: body.conversationRef ?? null, turnRef: body.turnRef ?? null, parentRunId: body.parentRunId ?? null } : {}) } }
      : { event: { id: "evt_1", ...(echo ? { sourcedStored: body.sourced !== undefined } : {}) }, redaction: { findingsCount: 0 } };
    return new Response(JSON.stringify(res), { status: 201 });
  }) as typeof fetch;
  return new AgentEvidenceRecorder({ baseUrl: "http://aer.test", apiKey: "k", fetchImpl, capture });
}

test("full mode: lineage and sourced are sent; the server's acknowledgement is surfaced", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const run = await recorder(undefined, sent).startRun({ agentName: "a", conversationRef: "c1", turnRef: "t2", parentRunId: "run_0" });
  assert.equal(run.lineageStored, true);
  const res = await run.event({ type: "model_call", title: "answer", sourced: SOURCED });
  assert.equal(res.sourcedStored, true);
  assert.deepEqual(sent[1].sourced, SOURCED);
  assert.equal((await run.event({ type: "tool_call", title: "t" })).sourcedStored, undefined);
});

test("an older server that drops the fields is reported, not hidden", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const run = await recorder(undefined, sent, false).startRun({ agentName: "a", parentRunId: "run_0" });
  assert.equal(run.lineageStored, false);
  assert.equal((await run.event({ type: "model_call", title: "a", sourced: SOURCED })).sourcedStored, false);
});

test("metadata_only: no sourced block and no app refs; AER's own parentRunId is kept", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const run = await recorder({ mode: "metadata_only" }, sent).startRun({ agentName: "a", conversationRef: "c1", turnRef: "t1", parentRunId: "run_0" });
  await run.event({ type: "model_call", title: "a", sourced: SOURCED });
  assert.equal(sent[0].conversationRef, undefined);
  assert.equal(sent[0].turnRef, undefined);
  assert.equal(sent[0].parentRunId, "run_0");
  assert.equal(sent[1].sourced, undefined);
  assert.ok(!JSON.stringify(sent).includes("Milas"));
});

test("allowlist: only allowed sourced paths are sent, with the profile tag kept", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const run = await recorder({ mode: "allowlist", allow: ["sourced.citedSources", "conversationRef"] }, sent).startRun({
    agentName: "a",
    conversationRef: "c1",
    turnRef: "t1",
  });
  await run.event({ type: "model_call", title: "a", sourced: SOURCED });
  assert.equal(sent[0].conversationRef, "c1");
  assert.equal(sent[0].turnRef, undefined);
  assert.deepEqual(sent[1].sourced, { profile: "sourced_assistant", version: 1, citedSources: SOURCED.citedSources });
  assert.ok(!JSON.stringify(sent[1]).includes("synthetic-claim-text"));
});

test("a failing redact hook withholds sourced and refs too", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const capture: CaptureOptions = { mode: "redacted_content", redact: () => { throw new Error("x"); } };
  const run = await recorder(capture, sent).startRun({ agentName: "a", conversationRef: "c1" });
  await run.event({ type: "model_call", title: "a", sourced: SOURCED });
  assert.equal(sent[0].conversationRef, undefined);
  assert.equal(sent[1].sourced, undefined);
});

// Independent review (e8ea465) regressions.
test("failed_closed sends only content-free fields — not even parentRunId", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const marker = "aer_" + "1234567890abcdef".repeat(2);
  const capture: CaptureOptions = { mode: "redacted_content", redact: () => { throw new Error("x"); } };
  const run = await recorder(capture, sent).startRun({ agentName: "a", parentRunId: marker, riskLevel: "high" });
  await run.event({ type: "model_call", title: "a", seq: 3, costMicroUsd: 5, sourced: SOURCED });
  assert.ok(!JSON.stringify(sent).includes(marker));
  assert.deepEqual(Object.keys(sent[0]).sort(), ["agentName", "capture", "riskLevel"]);
  assert.deepEqual(Object.keys(sent[1]).sort(), ["capture", "costMicroUsd", "seq", "title", "type"]);
});

test("redacted_content masks a context entry whose key is secret-named", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const run = await recorder({ mode: "redacted_content" }, sent).startRun({ agentName: "a" });
  await run.event({
    type: "model_call",
    title: "a",
    sourced: { profile: "sourced_assistant", version: 1, context: { used: [{ key: "password", value: "synthetic-pw", origin: "user_stated" }] } },
  });
  assert.ok(!JSON.stringify(sent[1]).includes("synthetic-pw"));
  assert.deepEqual((sent[1].sourced as SourcedEvidence).context!.used![0].value, "[REDACTED_SECRET]");
});

test("complete() returns the server's receipt, or null from a server without run manifests", async () => {
  const receipt = { statement: { run_id: "run_1", manifest_hash: "sha256:ab" }, signature: null };
  const fetchWith = (body: unknown) =>
    (async (_u: string | URL | Request, init?: RequestInit) =>
      new Response(JSON.stringify(String(init?.body).includes("agentName") ? { run: { id: "run_1" } } : body), { status: init?.method === "POST" && String(init?.body).includes("status") ? 200 : 201 })) as typeof fetch;
  for (const [body, expected] of [[{ run: { id: "run_1" }, receipt }, receipt], [{ run: { id: "run_1" } }, null]] as const) {
    const run = await new AgentEvidenceRecorder({ baseUrl: "http://aer.test", apiKey: "k", fetchImpl: fetchWith(body) }).startRun({ agentName: "a" });
    assert.deepEqual((await run.complete()).receipt, expected);
  }
});
