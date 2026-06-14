import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api/auth";
import { ApiError, makeRequestId } from "@/lib/api/errors";
import { jsonOk, toErrorResponse } from "@/lib/api/respond";
import {
  readJson,
  redactFields,
  requireRun,
  serializeEvent,
  toJsonInput,
} from "@/lib/api/helpers";
import { createEventSchema, parseBody } from "@/lib/validation/schemas";

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

    // Redact every persisted field BEFORE persistence; only redacted snapshots are stored.
    const { values, findings } = redactFields({
      title: data.title,
      input: data.input,
      output: data.output,
      metadata: data.metadata,
    });

    const seq = data.seq ?? run.eventCount + 1;

    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.agentEvent.create({
        data: {
          organizationId: auth.organizationId,
          projectId: auth.projectId,
          runId: run.id,
          seq,
          type: data.type,
          title: values.title as string,
          inputRedacted: toJsonInput(values.input),
          outputRedacted: toJsonInput(values.output),
          riskLevel: data.riskLevel,
          costMicroUsd: data.costMicroUsd,
          metadata: toJsonInput(values.metadata),
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
