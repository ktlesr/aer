import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api/auth";
import { ApiError, makeRequestId } from "@/lib/api/errors";
import { jsonOk, toErrorResponse } from "@/lib/api/respond";
import {
  RUN_TX,
  lockRun,
  readJson,
  redactFields,
  requireRun,
  serializeEvent,
  toJsonInput,
} from "@/lib/api/helpers";
import {
  claimKey,
  fingerprint,
  readIdempotencyKey,
  replayHeaders,
  saveResult,
  type StoredResult,
} from "@/lib/api/idempotency";
import { toEventCore } from "@/lib/audit/chainAdapter";
import { createEventSchema, parseBody } from "@/lib/validation/schemas";
import { REDACTION_POLICY } from "@/lib/redaction";
import { genesisHash, hashEvent, type EventCore } from "@ktlsr/evidence-chain";

/** An event's meaning, independent of where/when it landed (seq, occurredAt) — for replay checks. */
const meaning = (c: EventCore) => fingerprint({ ...c, seq: 0, occurredAt: "", findings: sortFindings(c.findings) });
const sortFindings = (fs: EventCore["findings"]) =>
  [...fs].sort((a, b) =>
    `${a.fieldPath}|${a.originalHash}|${a.findingType}`.localeCompare(`${b.fieldPath}|${b.originalHash}|${b.findingType}`),
  );

// Sequence policy. `seq` is the event's position in the run's chain.
// - Omitted (recommended): the server assigns max(seq) + 1 under the run lock.
// - Given: must be greater than every existing seq (gaps allowed, for legacy step numbers).
//   An existing seq with the same content is a replay (200, idempotent: true); with different
//   content, or a seq below the current head (it would break chain order), it is 409.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ run_id: string }> },
): Promise<Response> {
  const requestId = makeRequestId();
  try {
    const auth = await authenticate(request);
    const { run_id } = await params;
    // Tenant check before any parsing so a foreign run is a plain 404.
    const { id: runId } = await requireRun(run_id, auth);
    const data = parseBody(createEventSchema, await readJson(request));
    const idemKey = readIdempotencyKey(request);

    // Redact every persisted field BEFORE persistence; only redacted snapshots are stored.
    const { values, findings } = redactFields({
      title: data.title,
      input: data.input,
      output: data.output,
      metadata: data.metadata,
      captureDeclared: data.capture,
    });
    // Stamp occurredAt here (not via the DB default) so the value that goes into the hash is
    // exactly the value that gets stored — otherwise the chain could never be re-verified.
    const occurredAt = new Date();
    const core: Omit<EventCore, "seq"> = {
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
    const requestHash = fingerprint({ ...core, occurredAt: "", seq: data.seq ?? null, capture: values.captureDeclared ?? null });

    const result = await prisma.$transaction(async (tx): Promise<StoredResult> => {
      const run = await lockRun(tx, runId, auth);
      if (idemKey) {
        const replay = await claimKey(tx, auth, idemKey, "event.create", run.id, requestHash);
        if (replay) return replay;
      }

      const head = await tx.agentEvent.findFirst({
        where: { runId: run.id },
        orderBy: { seq: "desc" },
        select: { seq: true, hash: true },
      });

      let out: { status: number; body: unknown };
      const existing =
        data.seq !== undefined
          ? await tx.agentEvent.findUnique({ where: { runId_seq: { runId: run.id, seq: data.seq } } })
          : null;
      if (existing) {
        const existingFindings = await tx.redactionFinding.findMany({ where: { eventId: existing.id } });
        if (meaning(toEventCore(existing, existingFindings)) !== meaning({ ...core, seq: existing.seq })) {
          throw new ApiError("conflict", "An event with this seq already exists with different content", 409);
        }
        out = {
          status: 200,
          body: {
            event: serializeEvent(existing),
            redaction: { findingsCount: existingFindings.length },
            idempotent: true,
          },
        };
      } else {
        if (run.status === "completed" || run.status === "failed") {
          throw new ApiError("validation_error", "run_already_completed", 422);
        }
        if (data.seq !== undefined && head && data.seq <= head.seq) {
          throw new ApiError("conflict", "seq must be greater than the run's latest seq", 409);
        }
        const seq = data.seq ?? (head?.seq ?? 0) + 1;
        // Append-only chain: link to the current head, or genesis for the first event.
        const prevHash = head?.hash ?? genesisHash(run.id);
        const hash = hashEvent(prevHash, { ...core, seq });

        const created = await tx.agentEvent.create({
          data: {
            organizationId: auth.organizationId,
            projectId: auth.projectId,
            runId: run.id,
            seq,
            type: data.type,
            title: core.title,
            occurredAt,
            inputRedacted: toJsonInput(values.input),
            outputRedacted: toJsonInput(values.output),
            riskLevel: data.riskLevel,
            costMicroUsd: data.costMicroUsd,
            metadata: toJsonInput(values.metadata),
            redactionPolicy: REDACTION_POLICY,
            captureDeclared: toJsonInput(values.captureDeclared),
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
          where: { id: run.id },
          data: {
            eventCount: { increment: 1 },
            redactionCount: { increment: findings.length },
            costMicroUsd: data.costMicroUsd ? { increment: data.costMicroUsd } : undefined,
          },
        });
        out = {
          status: 201,
          body: { event: serializeEvent(created), redaction: { findingsCount: findings.length } },
        };
      }

      if (idemKey) await saveResult(tx, auth, idemKey, out);
      return { ...out, replayed: false };
    }, RUN_TX);

    return jsonOk(result.body, result.status, requestId, replayHeaders(result));
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
