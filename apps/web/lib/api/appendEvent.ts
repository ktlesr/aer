// The one way an event enters a run's evidence chain — used by the event API and by server-written
// events (verified approvals). Callers hold the run row lock (lockRun) for the whole transaction.
import { genesisHash, hashEvent, type EventCore } from "@ktlsr/evidence-chain";
import type { AgentEvent, AgentRun, Prisma } from "@/app/generated/prisma/client";
import type { RedactionFinding } from "@/lib/redaction";
import { REDACTION_POLICY } from "@/lib/redaction";
import { redactFields, toJsonInput } from "./helpers";

export interface EventInput {
  type: AgentEvent["type"];
  title: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  riskLevel?: AgentEvent["riskLevel"];
  costMicroUsd?: number;
  capture?: unknown;
  sourced?: unknown;
}

export interface PreparedEvent {
  input: EventInput;
  values: Record<string, unknown>;
  findings: RedactionFinding[];
  occurredAt: Date;
  /** The hashed view without its seq (assigned under the lock). */
  core: Omit<EventCore, "seq">;
}

/** Redact every persisted field and build the hashed core. No DB access. */
export function prepareEvent(input: EventInput): PreparedEvent {
  const { values, findings } = redactFields({
    title: input.title,
    input: input.input,
    output: input.output,
    metadata: input.metadata,
    captureDeclared: input.capture,
    sourced: input.sourced,
  });
  // Stamp occurredAt here (not via the DB default) so the value that goes into the hash is
  // exactly the value that gets stored — otherwise the chain could never be re-verified.
  const occurredAt = new Date();
  const core: Omit<EventCore, "seq"> = {
    type: input.type,
    title: values.title as string,
    occurredAt: occurredAt.toISOString(),
    inputRedacted: toJsonInput(values.input) ?? null,
    outputRedacted: toJsonInput(values.output) ?? null,
    riskLevel: input.riskLevel ?? null,
    costMicroUsd: input.costMicroUsd ?? null,
    metadata: toJsonInput(values.metadata) ?? null,
    findings: findings.map((f) => ({
      findingType: f.findingType,
      severity: f.severity,
      fieldPath: f.fieldPath,
      originalHash: f.originalHash,
    })),
  };
  return { input, values, findings, occurredAt, core };
}

/** The chain head under the lock (null for an empty run). */
export function chainHead(tx: Prisma.TransactionClient, runId: string) {
  return tx.agentEvent.findFirst({ where: { runId }, orderBy: { seq: "desc" }, select: { seq: true, hash: true } });
}

/**
 * Append a prepared event at `seq` (default: head + 1), linked to the current head. The caller has
 * already checked the run is open and the seq is acceptable.
 */
export async function insertEvent(
  tx: Prisma.TransactionClient,
  run: AgentRun,
  p: PreparedEvent,
  seq?: number,
): Promise<AgentEvent> {
  const head = await chainHead(tx, run.id);
  const at = seq ?? (head?.seq ?? 0) + 1;
  // Append-only chain: link to the current head, or genesis for the first event.
  const prevHash = head?.hash ?? genesisHash(run.id);
  const hash = hashEvent(prevHash, { ...p.core, seq: at });
  const created = await tx.agentEvent.create({
    data: {
      organizationId: run.organizationId,
      projectId: run.projectId,
      runId: run.id,
      seq: at,
      type: p.input.type,
      title: p.core.title,
      occurredAt: p.occurredAt,
      inputRedacted: toJsonInput(p.values.input),
      outputRedacted: toJsonInput(p.values.output),
      riskLevel: p.input.riskLevel ?? undefined,
      costMicroUsd: p.input.costMicroUsd,
      metadata: toJsonInput(p.values.metadata),
      redactionPolicy: REDACTION_POLICY,
      captureDeclared: toJsonInput(p.values.captureDeclared),
      sourced: toJsonInput(p.values.sourced),
      hash,
      prevHash,
    },
  });
  if (p.findings.length > 0) {
    await tx.redactionFinding.createMany({
      data: p.findings.map((f) => ({
        organizationId: run.organizationId,
        projectId: run.projectId,
        runId: run.id,
        eventId: created.id,
        findingType: f.findingType,
        severity: f.severity,
        fieldPath: f.fieldPath,
        originalHash: f.originalHash,
      })),
    });
  }
  await tx.agentRun.update({
    where: { id: run.id },
    data: {
      eventCount: { increment: 1 },
      redactionCount: { increment: p.findings.length },
      costMicroUsd: p.input.costMicroUsd ? { increment: p.input.costMicroUsd } : undefined,
    },
  });
  return created;
}
