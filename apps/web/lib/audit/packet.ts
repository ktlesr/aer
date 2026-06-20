import { createHash } from "node:crypto";
import { genesisHash, type ChainLink } from "@ktlsr/evidence-chain";
import type {
  AgentEvent,
  AgentRun,
  RedactionFinding,
} from "@/app/generated/prisma/client";

interface PacketFinding {
  findingType: string;
  severity: string;
  fieldPath: string;
  originalHash: string;
}

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
    // Evidence chain: per-event links, sha256:-prefixed. Null for legacy (pre-chain) runs.
    hash: string | null;
    prevHash: string | null;
    // Findings that went into this event's hash (raw values never present — only the hash).
    findings: PacketFinding[];
  }>;
  redaction_findings: Array<PacketFinding>;
  // Chain anchor — lets a third party re-verify the packet offline (see docs/EVIDENCE_INTEGRITY.md).
  chain: { algorithm: "sha256"; genesis: string };
  seal: string | null;
  export: {
    type: "json";
    generatedAt: string;
    content_hash: string;
  };
}

const withPrefix = (hex: string): string => `sha256:${hex}`;
const stripPrefix = (v: string): string => v.replace(/^sha256:/, "");

const jsonOrNull = (v: unknown): unknown => (v === undefined ? null : v);

/**
 * Deterministic sha256 over the run's redacted content (no timestamps) — a stable "evidence digest"
 * for display. The downloadable packet has its own content_hash that also covers export metadata.
 */
export function evidenceDigest(
  run: AgentRun,
  events: AgentEvent[],
  findings: RedactionFinding[],
): string {
  const canonical = {
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
    })),
    findings: findings.map((f) => ({
      findingType: f.findingType,
      severity: f.severity,
      fieldPath: f.fieldPath,
      originalHash: f.originalHash,
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

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
  const toPacketFinding = (f: RedactionFinding): PacketFinding => ({
    findingType: f.findingType,
    severity: f.severity,
    fieldPath: f.fieldPath,
    // DB stores raw 64-hex; present with an algorithm prefix in the packet.
    originalHash: withPrefix(f.originalHash),
  });

  const base: Omit<AuditPacket, "export"> & { export: Omit<AuditPacket["export"], "content_hash"> } = {
    schema_version: "1.1",
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
      hash: e.hash ? withPrefix(e.hash) : null,
      prevHash: e.prevHash ? withPrefix(e.prevHash) : null,
      findings: findings.filter((f) => f.eventId === e.id).map(toPacketFinding),
    })),
    redaction_findings: findings.map(toPacketFinding),
    chain: { algorithm: "sha256", genesis: withPrefix(genesisHash(run.id)) },
    seal: run.seal ? withPrefix(run.seal) : null,
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

/**
 * Reconstruct the chain links from a packet alone — the basis for offline verification. Strips the
 * `sha256:` presentation prefix so the bytes match what the writer hashed. Pair with
 * `verifyChain(links, packetSeal(packet), packet.run.id)`.
 */
export function packetToChainLinks(packet: AuditPacket): ChainLink[] {
  return packet.events.map((e) => ({
    seq: e.seq,
    type: e.type,
    title: e.title,
    occurredAt: e.occurredAt,
    inputRedacted: e.inputRedacted ?? null,
    outputRedacted: e.outputRedacted ?? null,
    riskLevel: e.riskLevel ?? null,
    costMicroUsd: e.costMicroUsd ?? null,
    metadata: e.metadata ?? null,
    findings: e.findings.map((f) => ({
      findingType: f.findingType,
      severity: f.severity,
      fieldPath: f.fieldPath,
      originalHash: stripPrefix(f.originalHash),
    })),
    hash: e.hash ? stripPrefix(e.hash) : "",
    prevHash: e.prevHash ? stripPrefix(e.prevHash) : "",
  }));
}

/** The packet seal as raw hex for verifyChain (null while the run was still running). */
export function packetSeal(packet: AuditPacket): string | null {
  return packet.seal ? stripPrefix(packet.seal) : null;
}
