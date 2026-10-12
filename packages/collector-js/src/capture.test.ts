// Client-side capture: what reaches the (fake) network must never contain the sensitive fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentEvidenceRecorder, type CaptureOptions } from "./index.js";

const EMAIL = "ayse.yilmaz@example.com";
const PASSWORD = "Kedi123!sifre";
const CARD = "4111 1111 1111 1111";
const PROMPT = "osb içinde milas soğuk hava deposu teşviki";

function recorder(capture: CaptureOptions, sent: string[]) {
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(String(init?.body ?? ""));
    const body = String(init?.body ?? "").includes('"agentName"')
      ? { run: { id: "run_1" } }
      : { event: { id: "evt_1" }, redaction: { findingsCount: 0 } };
    return new Response(JSON.stringify(body), { status: 201 });
  }) as typeof fetch;
  return new AgentEvidenceRecorder({ baseUrl: "http://aer.test", apiKey: "k", fetchImpl, capture });
}

const sensitiveEvent = () => ({
  type: "model_call" as const,
  title: `answer for ${EMAIL}`,
  input: { question: PROMPT, user: { email: EMAIL, password: PASSWORD } },
  output: { answer: "…", sources: [{ id: "9903_karar.pdf", score: 0.0000246913578, url: "https://x/signed?sig=1" }] },
  metadata: { model: "m-1", apiKey: "sk-abcdefghijklmnop1234", card: CARD, prompt: PROMPT },
});

const leaks = (body: string) => [EMAIL, PASSWORD, CARD, "sk-abcdefghijklmnop1234"].filter((s) => body.includes(s));

test("redacted_content: no sensitive fixture reaches fetch; source object untouched; scores stay numbers", async () => {
  const sent: string[] = [];
  const ev = sensitiveEvent();
  const before = structuredClone(ev);
  const run = await recorder({ mode: "redacted_content" }, sent).startRun({ agentName: "a", metadata: { token: "t0k3n-value" } });
  await run.event(ev);
  assert.deepEqual(ev, before);
  for (const body of sent) assert.deepEqual(leaks(body), []);
  assert.ok(!sent[0].includes("t0k3n-value"));
  const evBody = JSON.parse(sent[1]);
  assert.equal(evBody.output.sources[0].score, 0.0000246913578);
  assert.equal(evBody.input.user.password, "[REDACTED_SECRET]");
  assert.deepEqual(evBody.capture, { mode: "redacted_content", policy: "collector-js/0.3.0:redacted_content", status: "applied" });
});

test("allowlist: only listed paths leave the process; unknown fields are dropped", async () => {
  const sent: string[] = [];
  const run = await recorder(
    { mode: "allowlist", allow: ["input.question", "output.sources.*.id", "output.sources.*.score", "metadata.model"] },
    sent,
  ).startRun({ agentName: "a" });
  await run.event(sensitiveEvent());
  const body = JSON.parse(sent[1]);
  assert.deepEqual(body.input, { question: PROMPT });
  assert.deepEqual(body.output, { sources: [{ id: "9903_karar.pdf", score: 0.0000246913578 }] });
  assert.deepEqual(body.metadata, { model: "m-1" });
  assert.deepEqual(leaks(sent[1]), []);
  assert.ok(!sent[1].includes("signed?sig"));
});

test("metadata_only: no input/output; metadata limited to allowlisted short scalars", async () => {
  const sent: string[] = [];
  const run = await recorder(
    { mode: "metadata_only", allow: ["metadata.model", "metadata.prompt", "metadata.long"] },
    sent,
  ).startRun({ agentName: "a" });
  await run.event({ ...sensitiveEvent(), metadata: { model: "m-1", prompt: { text: PROMPT }, long: "x".repeat(201), other: 1 } });
  const body = JSON.parse(sent[1]);
  assert.equal(body.input, undefined);
  assert.equal(body.output, undefined);
  assert.deepEqual(body.metadata, { model: "m-1" });
  assert.ok(!sent[1].includes(PROMPT));
});

test("a throwing hook fails closed: the step is recorded, no content is sent", async () => {
  const sent: string[] = [];
  const run = await recorder(
    { mode: "redacted_content", redact: () => { throw new Error(`cannot scrub ${PROMPT}`); } },
    sent,
  ).startRun({ agentName: "a" });
  await run.event(sensitiveEvent());
  const body = JSON.parse(sent[1]);
  assert.equal(body.title, "model_call (content withheld: client redaction failed)");
  assert.equal(body.input, undefined);
  assert.equal(body.output, undefined);
  assert.equal(body.metadata, undefined);
  assert.equal(body.capture.status, "failed_closed");
  for (const s of sent) assert.ok(!s.includes(PROMPT) && !s.includes("milas"));
});

test("onRedactionError=throw sends nothing and does not echo content in the error", async () => {
  const sent: string[] = [];
  const rec = recorder(
    { mode: "full", onRedactionError: "throw", redact: () => { throw new Error(PROMPT); } },
    sent,
  );
  await assert.rejects(rec.startRun({ agentName: "a" }), (e: Error) => !e.message.includes(PROMPT));
  assert.equal(sent.length, 0);
});

test("the hook gets a copy and its result is what is sent", async () => {
  const sent: string[] = [];
  const ev = sensitiveEvent();
  const run = await recorder(
    { mode: "full", redact: (p) => { p.input = "[scrubbed by app]"; return p; } },
    sent,
  ).startRun({ agentName: "a" });
  await run.event(ev);
  assert.equal(JSON.parse(sent[1]).input, "[scrubbed by app]");
  assert.equal(ev.input.question, PROMPT);
});

test("keys that mask to the same token are kept, not overwritten", async () => {
  const sent: string[] = [];
  const run = await recorder({ mode: "redacted_content" }, sent).startRun({ agentName: "a" });
  await run.event({ type: "tool_call", title: "t", input: { "a@x.io": 1, "b@x.io": 2 } });
  assert.deepEqual(JSON.parse(sent[1]).input, { "[REDACTED_EMAIL]": 1, "[REDACTED_EMAIL]#2": 2 });
});

test("no capture option: body is sent as given (collector-js 0.2 behaviour), no declaration", async () => {
  const sent: string[] = [];
  const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
    sent.push(String(init?.body));
    return new Response(JSON.stringify({ run: { id: "r" } }), { status: 201 });
  }) as typeof fetch;
  await new AgentEvidenceRecorder({ baseUrl: "http://aer.test", apiKey: "k", fetchImpl }).startRun({ agentName: EMAIL });
  assert.deepEqual(JSON.parse(sent[0]), { agentName: EMAIL });
});
