// Seed ONE demo run for the "Customer Data Deletion Agent" scenario (RUNBOOK ADIM 5).
// Idempotent: deletes the demo organization (cascades to all children) and recreates it
// with fixed IDs, so `prisma db seed` always yields the same state.
//
// Security (docs/SECURITY.md): the API key is stored as a hash only; the plaintext below is a
// known DEV key for the demo agent, printed once on seed. Event input/output are stored already
// redacted; redaction findings store originalHash only — never the raw value.
import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Fixed IDs → idempotent re-seed.
const ORG_ID = "org_demo";
const PROJECT_ID = "proj_demo";
const API_KEY_ID = "key_demo";
const RUN_ID = "run_demo";

// DEV demo key. DB stores only sha256(DEMO_API_KEY); plaintext lives here for the demo agent.
const DEMO_API_KEY = "aer_demo_3f7c1a9e5b2d4068a1c3e5f70912abcd";

// Sample raw PII that the (mock) agent saw. Stored ONLY as a hash in RedactionFinding.
const RAW_EMAIL = "jane.doe@example.com";
const RAW_PHONE = "+1 415 555 0142";

const base = new Date("2026-06-14T09:00:00.000Z");
const at = (offsetSeconds: number): Date =>
  new Date(base.getTime() + offsetSeconds * 1000);

type SeedEvent = {
  id: string;
  seq: number;
  type:
    | "run_started"
    | "user_input"
    | "model_call"
    | "tool_call"
    | "redaction_applied"
    | "human_approval_requested"
    | "final_output"
    | "run_completed";
  title: string;
  offset: number;
  inputRedacted?: unknown;
  outputRedacted?: unknown;
  riskLevel?: "low" | "medium" | "high" | "critical";
  costMicroUsd?: number;
  metadata?: unknown;
};

const EVENTS: SeedEvent[] = [
  {
    id: "evt_1",
    seq: 1,
    type: "run_started",
    title: "Run started",
    offset: 0,
    metadata: { source: "demo-agent" },
  },
  {
    id: "evt_2",
    seq: 2,
    type: "user_input",
    title: "Customer requests data deletion",
    offset: 5,
    inputRedacted: {
      customer: {
        name: "Jane Doe",
        email: "[REDACTED_EMAIL]",
        phone: "[REDACTED_PHONE]",
      },
      request: "Please delete all of my personal data under GDPR.",
    },
    riskLevel: "medium",
    metadata: { channel: "support_email" },
  },
  {
    id: "evt_3",
    seq: 3,
    type: "model_call",
    title: "Plan deletion steps",
    offset: 8,
    outputRedacted: {
      plan: ["locate customer", "check retention policy", "request approval"],
    },
    costMicroUsd: 4200,
    metadata: { model: "claude-opus-4-8", latencyMs: 1840, tokensIn: 612, tokensOut: 188 },
  },
  {
    id: "evt_4",
    seq: 4,
    type: "tool_call",
    title: "search_customer",
    offset: 12,
    inputRedacted: { query: { email: "[REDACTED_EMAIL]" } },
    outputRedacted: { found: true, customerId: "cus_8842", records: 3 },
    metadata: { tool: "search_customer", latencyMs: 220 },
  },
  {
    id: "evt_5",
    seq: 5,
    type: "tool_call",
    title: "check_data_policy",
    offset: 16,
    inputRedacted: { customerId: "cus_8842" },
    outputRedacted: { retentionDays: 30, deletable: true, holds: [] },
    metadata: { tool: "check_data_policy", latencyMs: 95 },
  },
  {
    id: "evt_6",
    seq: 6,
    type: "redaction_applied",
    title: "PII redacted",
    offset: 18,
    outputRedacted: { findings: 2, types: ["email", "phone"] },
    riskLevel: "high",
    metadata: { redactor: "redactJson@v1" },
  },
  {
    id: "evt_7",
    seq: 7,
    type: "human_approval_requested",
    title: "Awaiting human approval for irreversible deletion",
    offset: 22,
    outputRedacted: { approver: "ops-oncall", reason: "irreversible deletion", decision: "pending" },
    riskLevel: "high",
    metadata: { approvalId: "appr_5521" },
  },
  {
    id: "evt_8",
    seq: 8,
    type: "final_output",
    title: "Deletion scheduled",
    offset: 115,
    outputRedacted: { result: "Customer data deletion scheduled", ticket: "DEL-1042" },
    metadata: { ticket: "DEL-1042" },
  },
  {
    id: "evt_9",
    seq: 9,
    type: "run_completed",
    title: "Run completed",
    offset: 120,
    metadata: { outcome: "completed" },
  },
];

async function main(): Promise<void> {
  // Idempotency: remove the demo org; FK cascades drop project, key, run, events, findings, exports.
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });

  await prisma.organization.create({
    data: { id: ORG_ID, name: "Acme Inc. (Demo)", createdAt: base },
  });

  await prisma.project.create({
    data: {
      id: PROJECT_ID,
      organizationId: ORG_ID,
      name: "Customer Support Agents",
      createdAt: base,
    },
  });

  await prisma.apiKey.create({
    data: {
      id: API_KEY_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      name: "demo key",
      keyHash: sha256(DEMO_API_KEY),
      prefix: DEMO_API_KEY.slice(0, 13),
      createdAt: base,
    },
  });

  await prisma.agentRun.create({
    data: {
      id: RUN_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      agentName: "Customer Data Deletion Agent",
      status: "completed",
      riskLevel: "high",
      startedAt: at(0),
      endedAt: at(120),
      durationMs: 120_000,
      costMicroUsd: 4200,
      eventCount: EVENTS.length,
      redactionCount: 2,
      metadata: { scenario: "customer_data_deletion", env: "demo" },
    },
  });

  await prisma.agentEvent.createMany({
    data: EVENTS.map((e) => ({
      id: e.id,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      runId: RUN_ID,
      seq: e.seq,
      type: e.type,
      title: e.title,
      occurredAt: at(e.offset),
      inputRedacted: e.inputRedacted ?? undefined,
      outputRedacted: e.outputRedacted ?? undefined,
      riskLevel: e.riskLevel ?? undefined,
      costMicroUsd: e.costMicroUsd ?? undefined,
      metadata: e.metadata ?? undefined,
    })),
  });

  await prisma.redactionFinding.createMany({
    data: [
      {
        id: "find_email",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        runId: RUN_ID,
        eventId: "evt_2",
        findingType: "email",
        severity: "medium",
        fieldPath: "input.customer.email",
        originalHash: sha256(RAW_EMAIL),
        createdAt: at(18),
      },
      {
        id: "find_phone",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        runId: RUN_ID,
        eventId: "evt_2",
        findingType: "phone",
        severity: "medium",
        fieldPath: "input.customer.phone",
        originalHash: sha256(RAW_PHONE),
        createdAt: at(18),
      },
    ],
  });

  await prisma.auditExport.create({
    data: {
      id: "exp_demo",
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      runId: RUN_ID,
      type: "json",
      status: "pending",
      createdAt: at(121),
    },
  });

  console.log("Seed complete:");
  console.log(`  org=${ORG_ID} project=${PROJECT_ID} run=${RUN_ID}`);
  console.log(`  events=${EVENTS.length} findings=2 exports=1`);
  // Do not print the full key — it can leak into CI/terminal logs. The full dev key lives in
  // apps/web/.env.example (AER_DEMO_API_KEY) for the demo agent.
  console.log(`  demo API key prefix: ${DEMO_API_KEY.slice(0, 13)}… (full dev key in apps/web/.env.example)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
