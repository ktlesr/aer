import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import type { AgentEvent, AgentRun, AuditExport } from "@/app/generated/prisma/client";
import { redactJson, type RedactionFinding } from "@/lib/redaction";
import { ApiError } from "./errors";
import type { AuthContext } from "./auth";

/** Parse a JSON body, mapping malformed JSON to a 422 instead of a 500. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError("validation_error", "Request body must be valid JSON", 422);
  }
}

/** `x-aer-sdk: <name>/<semver>`, e.g. `collector-js/0.2.0`. Bounded so it can't carry a payload. */
const SDK_HEADER = /^([a-z0-9][a-z0-9._-]{0,39})\/(\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[0-9A-Za-z.-]{1,20})?)$/;

/**
 * Parse the self-reported SDK identity header. Anything that doesn't match exactly is treated as
 * absent (null) rather than rejected — this is adoption telemetry, never a reason to fail a write.
 */
export function parseSdkHeader(
  value: string | null,
): { sdkName: string; sdkVersion: string } | null {
  const m = value ? SDK_HEADER.exec(value.trim()) : null;
  return m ? { sdkName: m[1], sdkVersion: m[2] } : null;
}

/** Load a run scoped to the caller's tenant. Cross-tenant or missing → 404 (no existence leak). */
export async function requireRun(
  runId: string,
  auth: AuthContext,
): Promise<AgentRun> {
  const run = await prisma.agentRun.findFirst({
    where: {
      id: runId,
      organizationId: auth.organizationId,
      projectId: auth.projectId,
    },
  });
  if (!run) {
    throw new ApiError("not_found", "Run not found", 404);
  }
  return run;
}

/**
 * Interactive-transaction limits for writes that queue on a run's row lock. Concurrent writes to
 * ONE run are serialised, so a burst waits its turn instead of failing; past these limits the
 * request fails with 500 and a retry with the same Idempotency-Key is safe.
 */
export const RUN_TX = { maxWait: 10_000, timeout: 20_000 } as const;

/**
 * Lock the run row (SELECT … FOR UPDATE) and return its current state. Every write that changes a
 * run's chain or status — event append, complete — takes this lock first, so they serialise per
 * run: sequence numbers, chain head, counters and status are read and written atomically.
 */
export async function lockRun(
  tx: Prisma.TransactionClient,
  runId: string,
  auth: AuthContext,
): Promise<AgentRun> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "AgentRun"
    WHERE "id" = ${runId} AND "organizationId" = ${auth.organizationId} AND "projectId" = ${auth.projectId}
    FOR UPDATE`;
  if (locked.length === 0) throw new ApiError("not_found", "Run not found", 404);
  // Read after the lock is held: READ COMMITTED gives this statement a fresh snapshot.
  return tx.agentRun.findUniqueOrThrow({ where: { id: runId } });
}

/** Cast an arbitrary redacted value to a Prisma JSON input (undefined stays undefined). */
export function toJsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

export interface RedactedFields {
  values: Record<string, unknown>;
  findings: RedactionFinding[];
}

/**
 * Redact a named set of fields (e.g. agentName, title, metadata, input, output) before they are
 * persisted or exported. Every persisted free-text/JSON field is scanned — not just input/output —
 * so a raw secret in `title` or `metadata` can never survive into the DB or the audit packet.
 * Each finding's fieldPath is namespaced by its field, e.g. `metadata.key` or `title`.
 */
export function redactFields(fields: Record<string, unknown>): RedactedFields {
  const values: Record<string, unknown> = {};
  const findings: RedactionFinding[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) {
      values[name] = undefined;
      continue;
    }
    const r = redactJson(value);
    values[name] = r.redacted;
    for (const f of r.findings) {
      findings.push({
        ...f,
        fieldPath: f.fieldPath ? `${name}.${f.fieldPath}` : name,
      });
    }
  }
  return { values, findings };
}

export function serializeRun(run: AgentRun) {
  return {
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
    // Echoed so a client can tell a server that stored lineage from one that dropped it.
    conversationRef: run.conversationRef,
    turnRef: run.turnRef,
    parentRunId: run.parentRunId,
  };
}

export function serializeEvent(event: AgentEvent) {
  return {
    id: event.id,
    seq: event.seq,
    type: event.type,
    title: event.title,
    occurredAt: event.occurredAt.toISOString(),
    // An acknowledgement, not the content: responses are kept in the idempotency ledger.
    sourcedStored: event.sourced !== null,
  };
}

export function serializeExport(exp: AuditExport) {
  return {
    id: exp.id,
    type: exp.type,
    status: exp.status,
    contentHash: exp.contentHash,
  };
}
