import { authenticate } from "@/lib/api/auth";
import { makeRequestId } from "@/lib/api/errors";
import { jsonOk, toErrorResponse } from "@/lib/api/respond";
import { readJson } from "@/lib/api/helpers";
import { approvalOutcomeSchema, parseBody } from "@/lib/validation/schemas";
import { reportOutcome, serializeApproval } from "@/lib/approvals/service";

// Agent (API key): report what the external system did after a used approval. Stored and shown
// as the application's claim — AER does not verify it. Once per approval.
export async function POST(request: Request, { params }: { params: Promise<{ approval_id: string }> }): Promise<Response> {
  const requestId = makeRequestId();
  try {
    const auth = await authenticate(request);
    const { approval_id } = await params;
    const data = parseBody(approvalOutcomeSchema, await readJson(request));
    return jsonOk({ approval: serializeApproval(await reportOutcome(auth, approval_id, data)) }, 200, requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
