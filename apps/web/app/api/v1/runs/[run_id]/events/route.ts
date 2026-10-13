import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api/auth";
import { ApiError, makeRequestId } from "@/lib/api/errors";
import { jsonOk, toErrorResponse } from "@/lib/api/respond";
import { RUN_TX, lockRun, readJson, requireRun, serializeEvent } from "@/lib/api/helpers";
import { chainHead, insertEvent, prepareEvent } from "@/lib/api/appendEvent";
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
import type { EventCore } from "@ktlsr/evidence-chain";

/** An event's meaning, independent of where/when it landed (seq, occurredAt) — for replay checks. */
const meaning = (c: EventCore) => fingerprint({ ...c, seq: 0, occurredAt: "", findings: sortFindings(c.findings) });
const sortFindings = (fs: EventCore["findings"]) =>
  [...fs].sort((a, b) => {
    const ka = JSON.stringify([a.fieldPath, a.originalHash, a.findingType]);
    const kb = JSON.stringify([b.fieldPath, b.originalHash, b.findingType]);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

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
    const prepared = prepareEvent({ ...data, capture: data.capture, sourced: data.sourced });
    const { core, values } = prepared;
    // Request identity only — the chain hash still uses `core.findings` in stored order.
    const requestHash = fingerprint({
      ...core,
      occurredAt: "",
      seq: data.seq ?? null,
      findings: sortFindings(core.findings),
      capture: values.captureDeclared ?? null,
      sourced: values.sourced ?? null,
    });

    const result = await prisma.$transaction(async (tx): Promise<StoredResult> => {
      const run = await lockRun(tx, runId, auth);
      if (idemKey) {
        const replay = await claimKey(tx, auth, idemKey, "event.create", run.id, requestHash);
        if (replay) return replay;
      }

      let out: { status: number; body: unknown };
      const existing =
        data.seq !== undefined
          ? await tx.agentEvent.findUnique({ where: { runId_seq: { runId: run.id, seq: data.seq } } })
          : null;
      if (existing) {
        const existingFindings = await tx.redactionFinding.findMany({ where: { eventId: existing.id } });
        if (
          meaning(toEventCore(existing, existingFindings)) !== meaning({ ...core, seq: existing.seq }) ||
          fingerprint(existing.sourced ?? null) !== fingerprint(values.sourced ?? null)
        ) {
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
        const head = await chainHead(tx, run.id);
        if (data.seq !== undefined && head && data.seq <= head.seq) {
          throw new ApiError("conflict", "seq must be greater than the run's latest seq", 409);
        }
        const created = await insertEvent(tx, run, prepared, data.seq);
        out = {
          status: 201,
          body: { event: serializeEvent(created), redaction: { findingsCount: prepared.findings.length } },
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
