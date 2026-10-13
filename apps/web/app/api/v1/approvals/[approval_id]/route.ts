import { authenticate } from "@/lib/api/auth";
import { makeRequestId } from "@/lib/api/errors";
import { jsonOk, toErrorResponse } from "@/lib/api/respond";
import { getApproval, serializeApproval } from "@/lib/approvals/service";

// Agent (API key): poll an approval's state. Another workspace's approval is a 404.
export async function GET(request: Request, { params }: { params: Promise<{ approval_id: string }> }): Promise<Response> {
  const requestId = makeRequestId();
  try {
    const auth = await authenticate(request);
    const { approval_id } = await params;
    return jsonOk({ approval: serializeApproval(await getApproval(auth, approval_id)) }, 200, requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
