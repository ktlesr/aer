import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api/auth";
import { makeRequestId } from "@/lib/api/errors";
import { jsonOk, toErrorResponse } from "@/lib/api/respond";
import { RUN_TX, readJson, redactFields, requireRun } from "@/lib/api/helpers";
import { claimKey, fingerprint, readIdempotencyKey, replayHeaders, saveResult, type StoredResult } from "@/lib/api/idempotency";
import { requestApprovalSchema, parseBody } from "@/lib/validation/schemas";
import { requestApproval, serializeApproval } from "@/lib/approvals/service";

// Agent (API key): request a verified human approval for one action on this run. Returns it
// pending; only a signed-in user of the workspace can decide it (dashboard).
export async function POST(request: Request, { params }: { params: Promise<{ run_id: string }> }): Promise<Response> {
  const requestId = makeRequestId();
  try {
    const auth = await authenticate(request);
    const { run_id } = await params;
    const { id: runId } = await requireRun(run_id, auth);
    const data = parseBody(requestApprovalSchema, await readJson(request));
    const idemKey = readIdempotencyKey(request);
    const result = await prisma.$transaction(async (tx): Promise<StoredResult> => {
      if (idemKey) {
        // Fingerprint over the REDACTED request: no unsalted hash of raw params is stored. Two
        // requests differing only in a masked value replay the first approval — whose params then
        // don't match at consume time (refused), so this can only fail safe.
        const { values } = redactFields({ action: data.action, params: data.params });
        const replay = await claimKey(tx, auth, idemKey, "approval.create", runId, fingerprint({ ...values, ttlSeconds: data.ttlSeconds ?? null, maxUses: data.maxUses ?? null }));
        if (replay) return replay;
      }
      const approval = await requestApproval(tx, auth, runId, data);
      const out = { status: 201, body: { approval: serializeApproval(approval) } };
      if (idemKey) await saveResult(tx, auth, idemKey, out);
      return { ...out, replayed: false };
    }, RUN_TX);
    return jsonOk(result.body, result.status, requestId, replayHeaders(result));
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
