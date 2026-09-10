// Stdlib-only tests (node:test) — the SDK stays dependency-free. Run: pnpm --filter @ktlsr/collector-js test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AgentEvidenceRecorder, SDK_VERSION } from "./index.js";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch stub that records each request and answers like POST /api/v1/runs. */
function stubFetch(calls: Captured[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({ run: { id: "run_1" } }), { status: 201 });
  }) as typeof fetch;
}

test("SDK_VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  assert.equal(SDK_VERSION, pkg.version);
});

test("every request identifies the SDK via x-aer-sdk", async () => {
  const calls: Captured[] = [];
  const recorder = new AgentEvidenceRecorder({
    baseUrl: "http://aer.test",
    apiKey: "k",
    fetchImpl: stubFetch(calls),
  });
  await recorder.startRun({ agentName: "a" });
  assert.equal(calls[0].headers["x-aer-sdk"], `collector-js/${SDK_VERSION}`);
});

test("environment is sent on startRun when configured, omitted when not", async () => {
  const withEnv: Captured[] = [];
  await new AgentEvidenceRecorder({
    baseUrl: "http://aer.test",
    apiKey: "k",
    environment: "production",
    fetchImpl: stubFetch(withEnv),
  }).startRun({ agentName: "a" });
  assert.deepEqual(withEnv[0].body, { agentName: "a", environment: "production" });

  const withoutEnv: Captured[] = [];
  await new AgentEvidenceRecorder({
    baseUrl: "http://aer.test",
    apiKey: "k",
    fetchImpl: stubFetch(withoutEnv),
  }).startRun({ agentName: "a" });
  assert.deepEqual(withoutEnv[0].body, { agentName: "a" });
});
