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
    if (type !== "json" && type !== "pdf") {
      // Do not echo the caller-supplied type — it could contain a key/PII.
      throw new ApiError("validation_error", "Unsupported export type", 422);
    }

    // Both formats store the same redacted, hash-anchored JSON packet. PDF is rendered from that
    // stored packet at download time, so the two share one content_hash and no binary is persisted.
    const scope = {
      runId: run.id,
      organizationId: auth.organizationId,
      projectId: auth.projectId,
    };
    const [events, findings] = await Promise.all([
      prisma.agentEvent.findMany({ where: scope, orderBy: { seq: "asc" } }),
      prisma.redactionFinding.findMany({ where: scope }),
    ]);

    const packet = buildAuditPacket(run, events, findings, new Date());

    const exp = await prisma.auditExport.create({
      data: {
        organizationId: auth.organizationId,
        projectId: auth.projectId,
        runId: run.id,
        type,
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
