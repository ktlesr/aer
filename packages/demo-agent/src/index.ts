// demo-agent — runs the Customer Data Deletion Request scenario end-to-end through collector-js.
// Produces a real run + events + redaction findings in the AER backend.
//
// Config (env, with dev defaults):
//   AER_API_BASE_URL  default http://localhost:3000 (AER_BASE_URL still honored for back-compat)
//   AER_API_KEY       default the seeded demo key (see prisma/seed.ts)
import { AgentEvidenceRecorder } from "collector-js";

const baseUrl =
  process.env.AER_API_BASE_URL ?? process.env.AER_BASE_URL ?? "http://localhost:3000";
const apiKey =
  process.env.AER_API_KEY ?? "aer_demo_3f7c1a9e5b2d4068a1c3e5f70912abcd";

// Sensitive values the (mock) agent encounters — the backend redacts these before storage.
const CUSTOMER = {
  name: "Jane Doe",
  email: "jane.doe@example.com",
  phone: "+1 415 555 0142",
};

async function main(): Promise<void> {
  const recorder = new AgentEvidenceRecorder({ baseUrl, apiKey });

  const run = await recorder.startRun({
    agentName: "Customer Data Deletion Agent",
    riskLevel: "high",
    metadata: { scenario: "customer_data_deletion", env: "demo" },
  });
  console.log(`run started: ${run.id}`);

  let totalFindings = 0;
  const emit = async (...args: Parameters<typeof run.event>) => {
    const r = await run.event(...args);
    totalFindings += r.findingsCount;
    return r;
  };

  await emit({ type: "run_started", title: "Run started", metadata: { source: "demo-agent" } });

  await emit({
    type: "user_input",
    title: "Customer requests data deletion",
    input: { customer: CUSTOMER, request: "Please delete all of my personal data under GDPR." },
    riskLevel: "medium",
    metadata: { channel: "support_email" },
  });

  await emit({
    type: "model_call",
    title: "Plan deletion steps",
    output: { plan: ["locate customer", "check retention policy", "request approval"] },
    costMicroUsd: 4200,
    metadata: { model: "claude-opus-4-8", latencyMs: 1840 },
  });

  await emit({
    type: "tool_call",
    title: "search_customer",
    input: { query: { email: CUSTOMER.email } },
    output: { found: true, customerId: "cus_8842", records: 3 },
    metadata: { tool: "search_customer" },
  });

  await emit({
    type: "tool_call",
    title: "check_data_policy",
    input: { customerId: "cus_8842" },
    output: { retentionDays: 30, deletable: true, holds: [] },
    metadata: { tool: "check_data_policy" },
  });

  await emit({
    type: "redaction_applied",
    title: "PII redacted",
    output: { types: ["email", "phone"] },
    riskLevel: "high",
  });

  await emit({
    type: "human_approval_requested",
    title: "Awaiting human approval for irreversible deletion",
    output: { approver: "ops-oncall", reason: "irreversible deletion", decision: "pending" },
    riskLevel: "high",
  });

  await emit({
    type: "final_output",
    title: "Deletion scheduled",
    output: { result: "Customer data deletion scheduled", ticket: "DEL-1042" },
  });

  await emit({ type: "run_completed", title: "Run completed", metadata: { outcome: "completed" } });

  await run.complete({ status: "completed" });

  console.log(`run completed: ${run.id}`);
  console.log(`redaction findings recorded: ${totalFindings}`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`demo-agent failed: ${message}`);
  process.exit(1);
});
