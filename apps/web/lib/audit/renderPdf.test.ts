import { describe, expect, it } from "vitest";
import { buildAuditPacket } from "./packet";
import { renderAuditPdf, headingCase } from "./renderPdf";
import type {
  AgentEvent,
  AgentRun,
  RedactionFinding,
} from "@/app/generated/prisma/client";

const run = {
  id: "run_x",
  // Turkish glyphs (İ ı ş ğ ö ü ç) exercise the bundled Latin-Extended font path.
  agentName: "Müşteri Verisi Silme Ajanı — İŞLEM",
  status: "completed",
  riskLevel: "high",
  startedAt: new Date("2026-01-01T00:00:00.000Z"),
  endedAt: new Date("2026-01-01T00:02:00.000Z"),
  durationMs: 120000,
  costMicroUsd: 4200,
  eventCount: 1,
  redactionCount: 1,
} as unknown as AgentRun;

const events = [
  {
    seq: 1,
    type: "user_input",
    title: "Müşteri silme talebi · doğrulama yapıldı",
    occurredAt: new Date("2026-01-01T00:00:05.000Z"),
    inputRedacted: { customer: { email: "[REDACTED_EMAIL]" } },
    outputRedacted: null,
    riskLevel: "medium",
    costMicroUsd: null,
    metadata: null,
  },
] as unknown as AgentEvent[];

const findings = [
  {
    findingType: "email",
    severity: "medium",
    fieldPath: "input.customer.email",
    originalHash: "a".repeat(64),
  },
] as unknown as RedactionFinding[];

const gen = new Date("2026-01-01T00:03:00.000Z");

describe("headingCase", () => {
  it("uppercases English but leaves Turkish in natural case", () => {
    expect(headingCase("Deletion Bot v2")).toBe("DELETION BOT V2");
    expect(headingCase("Müşteri Verisi Silme Ajanı")).toBe("Müşteri Verisi Silme Ajanı");
  });
});

describe("renderAuditPdf", () => {
  it("produces a non-empty PDF for a populated packet", async () => {
    const packet = buildAuditPacket(run, events, findings, gen);
    const pdf = await renderAuditPdf(packet);
    // %PDF- magic header proves it's a real PDF, not an error page or empty buffer.
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("renders an empty run (no events, no findings) without throwing", async () => {
    const empty = buildAuditPacket(
      { ...run, eventCount: 0, redactionCount: 0 } as AgentRun,
      [],
      [],
      gen,
    );
    const pdf = await renderAuditPdf(empty);
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });
});
