import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api/auth";
import { makeRequestId } from "@/lib/api/errors";
import { jsonOk, toErrorResponse } from "@/lib/api/respond";
import { RUN_TX, readJson } from "@/lib/api/helpers";
import { claimKey, fingerprint, readIdempotencyKey, replayHeaders, saveResult, type StoredResult } from "@/lib/api/idempotency";
import { consumeApprovalSchema, parseBody } from "@/lib/validation/schemas";
import { actionDigest, consumeApproval, getApproval, paramsDigest, serializeApproval, unsupportedApprovalValue } from "@/lib/approvals/service";
import { ApiError } from "@/lib/api/errors";

// Agent (API key), right before acting: use the approval with the exact parameters it was granted
// for. 409 + reason (approval_pending / _rejected / _revoked / _expired / _used_up /
// _action_mismatch / _params_mismatch) means: do not act. With an Idempotency-Key a retry after a lost response
// replays the first answer instead of using the approval twice.
export async function POST(request: Request, { params }: { params: Promise<{ approval_id: string }> }): Promise<Response> {
  const requestId = makeRequestId();
  try {
    const auth = await authenticate(request);
    const { approval_id } = await params;
    const { runId, paramsSalt } = await getApproval(auth, approval_id);
    const data = parseBody(consumeApprovalSchema, await readJson(request));
    const bad = unsupportedApprovalValue(data.action, "action") ?? unsupportedApprovalValue(data.params, "params");
    if (bad) throw new ApiError("validation_error", `Unsupported approval input — ${bad}`, 422);
    const idemKey = readIdempotencyKey(request);
    const result = await prisma.$transaction(async (tx): Promise<StoredResult> => {
      if (idemKey) {
        // Only the approval's SALTED digest enters the stored fingerprint — never raw params.
        const digest = { action: actionDigest(paramsSalt, data.action), params: paramsDigest(paramsSalt, data.params) };
        const replay = await claimKey(tx, auth, idemKey, "approval.consume", runId, fingerprint({ id: approval_id, digest }));
        if (replay) return replay;
      }
      const used = await consumeApproval(tx, auth, approval_id, data.action, data.params);
      const out = { status: 200, body: { approval: serializeApproval(used) } };
      if (idemKey) await saveResult(tx, auth, idemKey, out);
      return { ...out, replayed: false };
    }, RUN_TX);
    return jsonOk(result.body, result.status, requestId, replayHeaders(result));
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
