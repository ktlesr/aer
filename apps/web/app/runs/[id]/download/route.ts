import { prisma } from "@/lib/prisma";
import { resolveDashboardScope } from "@/lib/dashboard/scope";
import { buildAuditPacket } from "@/lib/audit/packet";

// Dashboard-internal download. Scoped via resolveDashboardScope() (the same auth seam as the
// dashboard pages), so it needs no API key. The packet contains only redacted, hashed data.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const { organizationId, projectId } = resolveDashboardScope();

  const run = await prisma.agentRun.findFirst({
    where: { id, organizationId, projectId },
  });
  if (!run) {
    return new Response("Not found", { status: 404 });
  }

  const scope = { runId: run.id, organizationId, projectId };
  const [events, findings] = await Promise.all([
    prisma.agentEvent.findMany({ where: scope, orderBy: { seq: "asc" } }),
    prisma.redactionFinding.findMany({ where: scope }),
  ]);

  const packet = buildAuditPacket(run, events, findings, new Date());

  return new Response(JSON.stringify(packet, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="audit-${run.id}.json"`,
      "x-content-hash": packet.export.content_hash,
    },
  });
}
