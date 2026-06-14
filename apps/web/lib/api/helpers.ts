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
