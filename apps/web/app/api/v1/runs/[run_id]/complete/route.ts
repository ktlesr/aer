import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api/auth";
import { ApiError, makeRequestId } from "@/lib/api/errors";
import { jsonOk, toErrorResponse } from "@/lib/api/respond";
import { RUN_TX, lockRun, readJson, requireRun, serializeRun, toJsonInput } from "@/lib/api/helpers";
import {
  claimKey,
  fingerprint,
  readIdempotencyKey,
  replayHeaders,
  saveResult,
  type StoredResult,
} from "@/lib/api/idempotency";
import { completeRunSchema, parseBody } from "@/lib/validation/schemas";
import { genesisHash } from "@ktlsr/evidence-chain";
import { issueReceipt, sealManifest } from "@/lib/audit/seal";

// Completion seals the run. It takes the same row lock as event append, so the seal is computed
// from exactly the events committed before it, and no event can be appended after it.
// Repeating it is safe: the same status (and endedAt, if given) returns the stored run unchanged;
// anything else is 409 — endedAt, status and seal never move once written.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ run_id: string }> },
): Promise<Response> {
  const requestId = makeRequestId();
  try {
    const auth = await authenticate(request);
    const { run_id } = await params;
    const { id: runId } = await requireRun(run_id, auth);
    const data = parseBody(completeRunSchema, await readJson(request));
    const idemKey = readIdempotencyKey(request);
    const requestedEnd = data.endedAt ? new Date(data.endedAt) : null;

    const result = await prisma.$transaction(async (tx): Promise<StoredResult> => {
      const run = await lockRun(tx, runId, auth);
      if (idemKey) {
        const replay = await claimKey(
          tx, auth, idemKey, "run.complete", run.id,
          fingerprint({ status: data.status, endedAt: requestedEnd?.toISOString() ?? null }),
        );
        if (replay) return replay;
      }

      let out: { status: number; body: unknown };
      if (run.status === "completed" || run.status === "failed") {
        const sameEnd = !requestedEnd || requestedEnd.getTime() === run.endedAt?.getTime();
        if (run.status !== data.status || !sameEnd) {
          throw new ApiError("conflict", "Run is already completed with a different result", 409);
        }
        // Same receipt as the first time: it was frozen with the seal (null for pre-manifest runs).
        out = { status: 200, body: { run: serializeRun(run), receipt: run.receipt ?? null } };
      } else {
        const endedAt = requestedEnd ?? new Date();
        // Counters from the rows themselves, read under the lock.
        const scope = { runId: run.id, organizationId: auth.organizationId, projectId: auth.projectId };
        const eventCount = await tx.agentEvent.count({ where: scope });
        const redactionCount = await tx.redactionFinding.count({ where: scope });
        const costAgg = await tx.agentEvent.aggregate({ where: scope, _sum: { costMicroUsd: true } });
        const events = await tx.agentEvent.findMany({
          where: scope,
          orderBy: { seq: "asc" },
          select: { seq: true, hash: true, redactionPolicy: true, captureDeclared: true, sourced: true },
        });
        // Freeze the chain head as the seal. An empty run seals to genesis (a valid 0-event chain).
        const seal = events.at(-1)?.hash ?? genesisHash(run.id);
        const sealed = {
          status: data.status,
          endedAt,
          durationMs: endedAt.getTime() - run.startedAt.getTime(),
          eventCount,
          redactionCount,
          costMicroUsd: costAgg._sum.costMicroUsd ?? 0,
          seal,
        };
        // The manifest binds the run as it is being sealed (final status/endedAt/cost included).
        const manifest = sealManifest({ ...run, ...sealed }, events, seal);
        const receipt = issueReceipt(run, manifest, seal, events.length);
        const updated = await tx.agentRun.update({
          where: { id: run.id },
          data: {
            ...sealed,
            manifestVersion: manifest.version,
            manifestHash: manifest.hash,
            receipt: toJsonInput(receipt),
          },
        });
        out = { status: 200, body: { run: serializeRun(updated), receipt } };
      }

      if (idemKey) await saveResult(tx, auth, idemKey, out);
      return { ...out, replayed: false };
    }, RUN_TX);

    return jsonOk(result.body, result.status, requestId, replayHeaders(result));
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
