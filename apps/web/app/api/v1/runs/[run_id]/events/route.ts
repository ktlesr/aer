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
import { genesisHash, hashEvent, type EventCore } from "@ktlsr/evidence-chain";

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

    // Idempotency: when the caller supplies an explicit seq (a step index), a retry of the same
    // (run_id, seq) must NOT create a second event — return the existing one as a success.
    if (data.seq !== undefined) {
      const existing = await prisma.agentEvent.findUnique({
        where: { runId_seq: { runId: run.id, seq: data.seq } },
      });
      if (existing) {
        const findingsCount = await prisma.redactionFinding.count({
          where: { eventId: existing.id },
        });
        return jsonOk(
          { event: serializeEvent(existing), redaction: { findingsCount }, idempotent: true },
          200,
          requestId,
        );
      }
    }

    // Redact every persisted field BEFORE persistence; only redacted snapshots are stored.
    const { values, findings } = redactFields({
      title: data.title,
      input: data.input,
      output: data.output,
      metadata: data.metadata,
    });

    const seq = data.seq ?? run.eventCount + 1;
    // Stamp occurredAt here (not via the DB default) so the value that goes into the hash is
    // exactly the value that gets stored — otherwise the chain could never be re-verified.
    const occurredAt = new Date();

    const event = await prisma.$transaction(async (tx) => {
      // Append-only chain: link to the current head (highest seq so far), or genesis for the first.
      const head = await tx.agentEvent.findFirst({
        where: { runId: run.id },
        orderBy: { seq: "desc" },
        select: { hash: true },
      });
      const prevHash = head?.hash ?? genesisHash(run.id);
      const core: EventCore = {
        seq,
        type: data.type,
        title: values.title as string,
        occurredAt: occurredAt.toISOString(),
        inputRedacted: toJsonInput(values.input) ?? null,
        outputRedacted: toJsonInput(values.output) ?? null,
        riskLevel: data.riskLevel ?? null,
        costMicroUsd: data.costMicroUsd ?? null,
        metadata: toJsonInput(values.metadata) ?? null,
        findings: findings.map((f) => ({
          findingType: f.findingType,
          severity: f.severity,
          fieldPath: f.fieldPath,
          originalHash: f.originalHash,
        })),
      };
      const hash = hashEvent(prevHash, core);

      const created = await tx.agentEvent.create({
        data: {
          organizationId: auth.organizationId,
          projectId: auth.projectId,
          runId: run.id,
          seq,
          type: data.type,
          title: values.title as string,
          occurredAt,
          inputRedacted: toJsonInput(values.input),
          outputRedacted: toJsonInput(values.output),
          riskLevel: data.riskLevel,
          costMicroUsd: data.costMicroUsd,
          metadata: toJsonInput(values.metadata),
          hash,
          prevHash,
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
        where: {
          id_organizationId_projectId: {
            id: run.id,
            organizationId: auth.organizationId,
            projectId: auth.projectId,
          },
        },
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
