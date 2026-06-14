import { createHash } from "node:crypto";
import type {
  AgentEvent,
  AgentRun,
  RedactionFinding,
} from "@/app/generated/prisma/client";

export interface AuditPacket {
  schema_version: string;
  run: {
    id: string;
    agentName: string;
    status: string;
    riskLevel: string;
    startedAt: string;
    endedAt: string | null;
    durationMs: number | null;
    costMicroUsd: number;
    eventCount: number;
    redactionCount: number;
  };
  events: Array<{
    seq: number;
    type: string;
    title: string;
    occurredAt: string;
    inputRedacted: unknown;
    outputRedacted: unknown;
    riskLevel: string | null;
    costMicroUsd: number | null;
    metadata: unknown;
  }>;
  redaction_findings: Array<{
    findingType: string;
    severity: string;
    fieldPath: string;
    originalHash: string;
  }>;
  export: {
    type: "json";
    generatedAt: string;
    content_hash: string;
  };
}

const jsonOrNull = (v: unknown): unknown => (v === undefined ? null : v);

/**
 * Build a redacted, hash-anchored audit packet. Only redacted event snapshots and hashed findings
 * are included — never raw sensitive values. `content_hash` is sha256 over the canonical packet
 * excluding the `content_hash` field itself.
 */
export function buildAuditPacket(
  run: AgentRun,
  events: AgentEvent[],
  findings: RedactionFinding[],
  generatedAt: Date,
): AuditPacket {
  const base: Omit<AuditPacket, "export"> & { export: Omit<AuditPacket["export"], "content_hash"> } = {
    schema_version: "1.0",
    run: {
      id: run.id,
      agentName: run.agentName,
      status: run.status,
      riskLevel: run.riskLevel,
      startedAt: run.startedAt.toISOString(),
      endedAt: run.endedAt ? run.endedAt.toISOString() : null,
      durationMs: run.durationMs,
      costMicroUsd: run.costMicroUsd,
      eventCount: run.eventCount,
      redactionCount: run.redactionCount,
    },
    events: events.map((e) => ({
      seq: e.seq,
      type: e.type,
      title: e.title,
      occurredAt: e.occurredAt.toISOString(),
      inputRedacted: jsonOrNull(e.inputRedacted),
      outputRedacted: jsonOrNull(e.outputRedacted),
      riskLevel: e.riskLevel ?? null,
      costMicroUsd: e.costMicroUsd ?? null,
      metadata: jsonOrNull(e.metadata),
    })),
    redaction_findings: findings.map((f) => ({
      findingType: f.findingType,
      severity: f.severity,
      fieldPath: f.fieldPath,
      // DB stores raw 64-hex; present with an algorithm prefix in the packet.
      originalHash: `sha256:${f.originalHash}`,
    })),
    export: {
      type: "json",
      generatedAt: generatedAt.toISOString(),
    },
  };

  const contentHash = createHash("sha256")
    .update(JSON.stringify(base))
    .digest("hex");

  return {
    ...base,
    export: { ...base.export, content_hash: `sha256:${contentHash}` },
  };
}
