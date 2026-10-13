import { createHash } from "node:crypto";
import {
  CANONICALIZATION,
  CHAIN,
  CONTENT_HASH,
  canonicalize,
  genesisHash,
  packetChainLinks,
  type ChainLink,
  type Receipt,
} from "@ktlsr/evidence-chain";
import type {
  AgentEvent,
  AgentRun,
  RedactionFinding,
} from "@/app/generated/prisma/client";
import { sourcedView, type RunLinks, type SourcedView } from "./sourced";

interface PacketFinding {
  findingType: string;
  severity: string;
  fieldPath: string;
  // null = deliberately not recorded (secret-named fields: a plain hash of a password is guessable).
  originalHash: string | null;
}

/**
 * Who filtered the content and under which policy. server_applied is AER's own record (null = row
 * written before policies were labelled). client_declared is the client's unverifiable claim.
 * Covered by content_hash, NOT by the event chain hash.
 */
export interface PacketCapture {
  server_applied: { layer: "server"; policy: string } | null;
  client_declared: ({ layer: "client" } & Record<string, unknown>) | null;
}

/**
 * What each integrity mechanism covers — shipped in the packet so a reader never has to assume.
 * content_hash alone is NOT tamper evidence: whoever edits the file can recompute it.
 */
export const PACKET_COVERAGE = {
  event_chain: {
    version: CHAIN,
    covers: "per event: seq, type, title, occurredAt, inputRedacted, outputRedacted, riskLevel, costMicroUsd, metadata, findings; order via prevHash; seal = chain head",
  },
  run_manifest: {
    covers:
      "run: id, tenant, agentName, status, riskLevel, startedAt, endedAt, costMicroUsd, server policy, client capture claim, environment, conversationRef, turnRef, parentRunId; per event: chain hash, server policy, client capture claim, sourced block (by digest); chain head and event count",
    frozen: "at seal (complete); absent for runs sealed before manifests existed",
  },
  content_hash: { version: CONTENT_HASH, covers: "the whole packet except export.content_hash" },
  receipt: "commits to manifest_hash; trusted only if you kept it at seal time or verify its signature with a key you obtained out of band",
  not_integrity_bound: [
    "run.durationMs, run.eventCount, run.redactionCount",
    "run.links.parentRun.status/agentName (resolved at export)",
    "events[].sourced.not_recorded (derived at export)",
    "redaction_findings (copy of events[].findings)",
    "export.generatedAt",
  ],
} as const;

export interface AuditPacket {
  schema_version: string;
  versions: { canonicalization: string; chain: string; manifest: string | null; content_hash: string };
  coverage: typeof PACKET_COVERAGE;
  run: {
    id: string;
    organizationId: string;
    projectId: string;
    environment: string | null;
    agentName: string;
    status: string;
    riskLevel: string;
    startedAt: string;
    endedAt: string | null;
    durationMs: number | null;
    costMicroUsd: number;
    eventCount: number;
    redactionCount: number;
    capture: PacketCapture;
    // Lineage, resolved inside the run's tenant at export time. Not covered by the chain hash.
    links: RunLinks;
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
    capture: PacketCapture;
    // Sourced-assistant evidence + `not_recorded` gaps; null when the event carries none.
    // Covered by content_hash, NOT by the event chain hash (Stage 4 extends coverage).
    sourced: SourcedView | null;
  }>;
  redaction_findings: Array<PacketFinding>;
  // Chain anchor — lets a third party re-verify the packet offline (see docs/EVIDENCE_INTEGRITY.md).
  chain: { algorithm: "sha256"; genesis: string };
  seal: string | null;
  // Run manifest hash frozen at seal (sha256:…); null while running / for pre-manifest runs.
  manifest_hash: string | null;
  // The receipt AER returned at seal. A copy inside the packet proves nothing by itself.
  receipt: Receipt | null;
  export: {
    type: "json";
    generatedAt: string;
    content_hash: string;
  };
}

const withPrefix = (hex: string): string => `sha256:${hex}`;
const stripPrefix = (v: string): string => v.replace(/^sha256:/, "");

const jsonOrNull = (v: unknown): unknown => (v === undefined ? null : v);

function captureOf(row: { redactionPolicy: string | null; captureDeclared: unknown }): PacketCapture {
  const declared = row.captureDeclared;
  return {
    server_applied: row.redactionPolicy ? { layer: "server", policy: row.redactionPolicy } : null,
    client_declared:
      declared && typeof declared === "object" && !Array.isArray(declared)
        ? { layer: "client", ...(declared as Record<string, unknown>) }
        : null,
  };
}

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
  links: RunLinks = { conversationRef: null, turnRef: null, parentRun: null },
): AuditPacket {
  const toPacketFinding = (f: RedactionFinding): PacketFinding => ({
    findingType: f.findingType,
    severity: f.severity,
    fieldPath: f.fieldPath,
    // DB stores raw 64-hex ("" when not recorded); present with an algorithm prefix in the packet.
    originalHash: f.originalHash ? withPrefix(f.originalHash) : null,
  });

  const base: Omit<AuditPacket, "export"> & { export: Omit<AuditPacket["export"], "content_hash"> } = {
    // 1.2 = 1.1 + run/event `capture`; 1.3 = 1.2 + run `links` + event `sourced`.
    // 2.0 = 1.3 + tenant/environment, run manifest hash, receipt, versions, coverage, and a
    // canonical content_hash (1.x hashed emission order, which JSONB storage does not keep).
    // Event chain hashing is unchanged, so 1.x packets verify as before.
    schema_version: "2.0",
    versions: {
      canonicalization: CANONICALIZATION,
      chain: CHAIN,
      manifest: run.manifestVersion,
      content_hash: CONTENT_HASH,
    },
    coverage: PACKET_COVERAGE,
    run: {
      id: run.id,
      organizationId: run.organizationId,
      projectId: run.projectId,
      environment: run.environment,
      agentName: run.agentName,
      status: run.status,
      riskLevel: run.riskLevel,
      startedAt: run.startedAt.toISOString(),
      endedAt: run.endedAt ? run.endedAt.toISOString() : null,
      durationMs: run.durationMs,
      costMicroUsd: run.costMicroUsd,
      eventCount: run.eventCount,
      redactionCount: run.redactionCount,
      capture: captureOf(run),
      links,
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
      capture: captureOf(e),
      sourced: sourcedView(e.sourced),
    })),
    redaction_findings: findings.map(toPacketFinding),
    chain: { algorithm: "sha256", genesis: withPrefix(genesisHash(run.id)) },
    seal: run.seal ? withPrefix(run.seal) : null,
    manifest_hash: run.manifestHash ? withPrefix(run.manifestHash) : null,
    receipt: (run.receipt as Receipt | null) ?? null,
    export: {
      type: "json",
      generatedAt: generatedAt.toISOString(),
    },
  };

  // Canonical bytes (sorted keys): reproducible after JSONB storage reorders the stored packet.
  const contentHash = createHash("sha256").update(canonicalize(base)).digest("hex");

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
  // Single implementation, shared with the offline verifier (aer-verify).
  return packetChainLinks(packet as unknown as Record<string, unknown>);
}

/** The packet seal as raw hex for verifyChain (null while the run was still running). */
export function packetSeal(packet: AuditPacket): string | null {
  return packet.seal ? stripPrefix(packet.seal) : null;
}
