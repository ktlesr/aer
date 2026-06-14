import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import type { AgentEvent, AgentRun, AuditExport } from "@/app/generated/prisma/client";
import type { RedactionFinding } from "@/lib/redaction";
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

/** Cast an arbitrary redacted value to a Prisma JSON input (undefined stays undefined). */
export function toJsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

/** Prefix redaction findings' fieldPath with the event field they came from (input/output). */
export function prefixFindings(
  findings: RedactionFinding[],
  prefix: "input" | "output",
): RedactionFinding[] {
  return findings.map((f) => ({
    ...f,
    fieldPath: f.fieldPath ? `${prefix}.${f.fieldPath}` : prefix,
  }));
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
  };
}

export function serializeEvent(event: AgentEvent) {
  return {
    id: event.id,
    seq: event.seq,
    type: event.type,
    title: event.title,
    occurredAt: event.occurredAt.toISOString(),
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
