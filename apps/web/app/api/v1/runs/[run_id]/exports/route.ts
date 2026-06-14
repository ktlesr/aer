import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api/auth";
import { ApiError, makeRequestId } from "@/lib/api/errors";
import { jsonOk, toErrorResponse } from "@/lib/api/respond";
import { requireRun, serializeExport, toJsonInput } from "@/lib/api/helpers";
import { buildAuditPacket } from "@/lib/audit/packet";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ run_id: string }> },
): Promise<Response> {
  const requestId = makeRequestId();
  try {
    const auth = await authenticate(request);
    const { run_id } = await params;
    const run = await requireRun(run_id, auth);

    const type = new URL(request.url).searchParams.get("type") ?? "json";

    if (type === "pdf") {
      // PDF export is a placeholder for MVP — created as pending, not generated.
      const exp = await prisma.auditExport.create({
        data: {
          organizationId: auth.organizationId,
          projectId: auth.projectId,
          runId: run.id,
          type: "pdf",
          status: "pending",
        },
      });
      return jsonOk({ export: serializeExport(exp) }, 202, requestId);
    }

    if (type !== "json") {
      throw new ApiError("validation_error", `Unsupported export type: ${type}`, 422);
    }

    const [events, findings] = await Promise.all([
      prisma.agentEvent.findMany({ where: { runId: run.id }, orderBy: { seq: "asc" } }),
      prisma.redactionFinding.findMany({ where: { runId: run.id } }),
    ]);

    const packet = buildAuditPacket(run, events, findings, new Date());

    const exp = await prisma.auditExport.create({
      data: {
        organizationId: auth.organizationId,
        projectId: auth.projectId,
        runId: run.id,
        type: "json",
        status: "ready",
        contentHash: packet.export.content_hash,
        packet: toJsonInput(packet),
      },
    });

    return jsonOk(
      {
        export: {
          ...serializeExport(exp),
          downloadPath: `/api/v1/runs/${run.id}/exports/${exp.id}/download`,
        },
      },
      201,
      requestId,
    );
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
