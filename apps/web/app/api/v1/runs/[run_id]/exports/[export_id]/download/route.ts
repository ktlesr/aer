import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api/auth";
import { ApiError, makeRequestId } from "@/lib/api/errors";
import { toErrorResponse } from "@/lib/api/respond";
import { renderAuditPdf } from "@/lib/audit/renderPdf";
import type { AuditPacket } from "@/lib/audit/packet";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ run_id: string; export_id: string }> },
): Promise<Response> {
  const requestId = makeRequestId();
  try {
    const auth = await authenticate(request);
    const { run_id, export_id } = await params;

    const exp = await prisma.auditExport.findFirst({
      where: {
        id: export_id,
        runId: run_id,
        organizationId: auth.organizationId,
        projectId: auth.projectId,
      },
    });

    if (!exp || exp.packet == null) {
      throw new ApiError("not_found", "Export not found", 404);
    }

    // PDF exports render the human-readable view from the stored packet — same content_hash.
    if (exp.type === "pdf") {
      const pdf = await renderAuditPdf(exp.packet as unknown as AuditPacket);
      return new Response(pdf, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "x-content-hash": exp.contentHash ?? "",
          "x-request-id": requestId,
          "content-disposition": `attachment; filename="audit-${run_id}-${export_id}.pdf"`,
        },
      });
    }

    return new Response(JSON.stringify(exp.packet), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-content-hash": exp.contentHash ?? "",
        "x-request-id": requestId,
        "content-disposition": `attachment; filename="audit-${run_id}-${export_id}.json"`,
      },
    });
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
