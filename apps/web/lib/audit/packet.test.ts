import { describe, expect, it } from "vitest";
import { buildAuditPacket } from "./packet";
import type {
  AgentEvent,
  AgentRun,
  RedactionFinding,
} from "@/app/generated/prisma/client";

const run = {
  id: "run_x",
  organizationId: "o",
  projectId: "p",
  agentName: "Customer Data Deletion Agent",
  status: "completed",
  riskLevel: "high",
  startedAt: new Date("2026-01-01T00:00:00.000Z"),
  endedAt: new Date("2026-01-01T00:02:00.000Z"),
  durationMs: 120000,
  costMicroUsd: 4200,
  eventCount: 1,
  redactionCount: 1,
  metadata: null,
} as unknown as AgentRun;

const events = [
  {
    id: "e1",
    organizationId: "o",
    projectId: "p",
    runId: "run_x",
    seq: 1,
    type: "user_input",
    title: "Customer requests deletion",
    occurredAt: new Date("2026-01-01T00:00:05.000Z"),
    inputRedacted: { customer: { email: "[REDACTED_EMAIL]", phone: "[REDACTED_PHONE]" } },
    outputRedacted: null,
    riskLevel: "medium",
    costMicroUsd: null,
    metadata: null,
  },
] as unknown as AgentEvent[];

const findings = [
  {
    id: "f1",
    organizationId: "o",
    projectId: "p",
    runId: "run_x",
    eventId: "e1",
    findingType: "email",
    severity: "medium",
    fieldPath: "input.customer.email",
    originalHash: "a".repeat(64),
    createdAt: new Date("2026-01-01T00:00:05.000Z"),
  },
] as unknown as RedactionFinding[];

const gen = new Date("2026-01-01T00:03:00.000Z");

describe("buildAuditPacket", () => {
  it("includes a sha256 content hash", () => {
    const packet = buildAuditPacket(run, events, findings, gen);
    expect(packet.export.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic for identical inputs", () => {
    const a = buildAuditPacket(run, events, findings, gen);
    const b = buildAuditPacket(run, events, findings, gen);
    expect(a.export.content_hash).toBe(b.export.content_hash);
  });

  it("changes the content hash when an event changes", () => {
    const a = buildAuditPacket(run, events, findings, gen);
    const mutated = [{ ...events[0], title: "tampered" }] as unknown as AgentEvent[];
    const b = buildAuditPacket(run, mutated, findings, gen);
    expect(a.export.content_hash).not.toBe(b.export.content_hash);
  });

  it("prefixes finding hashes with sha256: and never exposes raw values", () => {
    const packet = buildAuditPacket(run, events, findings, gen);
    expect(packet.redaction_findings[0].originalHash).toBe(`sha256:${"a".repeat(64)}`);
    const serialized = JSON.stringify(packet);
    expect(serialized).toContain("[REDACTED_EMAIL]");
    expect(serialized).not.toContain("@");
  });
});
