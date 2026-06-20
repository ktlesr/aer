import type { AgentEvent, RedactionFinding } from "@/app/generated/prisma/client";
import type { ChainLink, EventCore, Finding } from "@ktlsr/evidence-chain";

// Thin adapters: map Prisma rows into the evidence-chain shapes, then delegate to verifyChain.
// No chain logic lives here — only field projection (the discipline rule from the spec).

const toFinding = (f: RedactionFinding): Finding => ({
  findingType: f.findingType,
  severity: f.severity,
  fieldPath: f.fieldPath,
  originalHash: f.originalHash,
});

/** Build the hashed core of an event from its row + the findings attached to it. */
export function toEventCore(event: AgentEvent, findings: RedactionFinding[]): EventCore {
  return {
    seq: event.seq,
    type: event.type,
    title: event.title,
    occurredAt: event.occurredAt.toISOString(),
    inputRedacted: event.inputRedacted ?? null,
    outputRedacted: event.outputRedacted ?? null,
    riskLevel: event.riskLevel ?? null,
    costMicroUsd: event.costMicroUsd ?? null,
    metadata: event.metadata ?? null,
    findings: findings.filter((f) => f.eventId === event.id).map(toFinding),
  };
}

/** Build a verifiable link from a stored event row (hash/prevHash are "" when absent → legacy). */
export function toChainLink(event: AgentEvent, findings: RedactionFinding[]): ChainLink {
  return {
    ...toEventCore(event, findings),
    hash: event.hash ?? "",
    prevHash: event.prevHash ?? "",
  };
}
