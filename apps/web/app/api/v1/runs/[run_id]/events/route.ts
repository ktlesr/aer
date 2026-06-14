import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api/auth";
import { ApiError, makeRequestId } from "@/lib/api/errors";
import { jsonOk, toErrorResponse } from "@/lib/api/respond";
import {
  prefixFindings,
  readJson,
  requireRun,
  serializeEvent,
  toJsonInput,
} from "@/lib/api/helpers";
import { createEventSchema, parseBody } from "@/lib/validation/schemas";
import { redactJson, type RedactionFinding } from "@/lib/redaction";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ run_id: string }> },
): Promise<Response> {
  const requestId = makeRequestId();
  try {
    const auth = await authenticate(request);
    const { run_id } = await params;
    const run = await requireRun(run_id, auth);

    if (run.status === "completed" || run.status === "failed") {
      throw new ApiError("validation_error", "run_already_completed", 422);
    }

    const data = parseBody(createEventSchema, await readJson(request));

    // Redact input/output BEFORE persistence; only redacted snapshots are stored.
    let inputRedacted: unknown;
    let outputRedacted: unknown;
    const findings: RedactionFinding[] = [];

    if (data.input !== undefined) {
      const r = redactJson(data.input);
      inputRedacted = r.redacted;
      findings.push(...prefixFindings(r.findings, "input"));
    }
    if (data.output !== undefined) {
      const r = redactJson(data.output);
      outputRedacted = r.redacted;
      findings.push(...prefixFindings(r.findings, "output"));
    }

    const seq = data.seq ?? run.eventCount + 1;

    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.agentEvent.create({
        data: {
          organizationId: auth.organizationId,
          projectId: auth.projectId,
          runId: run.id,
          seq,
          type: data.type,
          title: data.title,
          inputRedacted: toJsonInput(inputRedacted),
          outputRedacted: toJsonInput(outputRedacted),
          riskLevel: data.riskLevel,
          costMicroUsd: data.costMicroUsd,
          metadata: toJsonInput(data.metadata),
        },
      });

      if (findings.length > 0) {
        await tx.redactionFinding.createMany({
          data: findings.map((f) => ({
            organizationId: auth.organizationId,
            projectId: auth.projectId,
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
          redactionCount: { increment: findings.length },
          costMicroUsd: data.costMicroUsd ? { increment: data.costMicroUsd } : undefined,
        },
      });

      return created;
    });

    return jsonOk(
      { event: serializeEvent(event), redaction: { findingsCount: findings.length } },
      201,
      requestId,
    );
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
