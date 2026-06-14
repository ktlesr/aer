// Tiny smoke test for collector-js against a RUNNING AER API.
// Proves the SDK can start a run, emit a redacted event, and complete — over real HTTP.
//
//   AER_API_BASE_URL  default http://localhost:3000
//   AER_API_KEY       a valid key (mint one with `pnpm key:create`)
//
// Run: AER_API_KEY=aer_... pnpm --filter collector-js smoke
import { AgentEvidenceRecorder, RecorderError } from "./index";

const baseUrl =
  process.env.AER_API_BASE_URL ?? process.env.AER_BASE_URL ?? "http://localhost:3000";
const apiKey = process.env.AER_API_KEY;

async function main(): Promise<void> {
  if (!apiKey) {
    throw new Error("AER_API_KEY is required (mint one with `pnpm key:create`)");
  }

  const recorder = new AgentEvidenceRecorder({ baseUrl, apiKey });
  const run = await recorder.startRun({ agentName: "collector-smoke", riskLevel: "low" });

  // Emit one event carrying PII the server must redact before storage.
  const r = await run.event({
    type: "user_input",
    title: "smoke",
    input: { email: "smoke.test@example.com" },
  });

  await run.complete({ status: "completed" });

  if (r.findingsCount < 1) {
    throw new Error(`expected >=1 redaction finding, got ${r.findingsCount}`);
  }
  console.log(`SMOKE PASS — run=${run.id} findings=${r.findingsCount}`);
}

main().catch((err: unknown) => {
  const message =
    err instanceof RecorderError
      ? `${err.code} (status ${err.status})`
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(`SMOKE FAIL — ${message}`);
  process.exit(1);
});
