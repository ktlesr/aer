import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api/auth";
import { makeRequestId } from "@/lib/api/errors";
import { jsonOk, toErrorResponse } from "@/lib/api/respond";
import { readJson, requireRun, serializeRun } from "@/lib/api/helpers";
import { completeRunSchema, parseBody } from "@/lib/validation/schemas";
import { genesisHash } from "@ktlsr/evidence-chain";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ run_id: string }> },
): Promise<Response> {
  const requestId = makeRequestId();
  try {
    const auth = await authenticate(request);
    const { run_id } = await params;
    const run = await requireRun(run_id, auth);

    const data = parseBody(completeRunSchema, await readJson(request));
    const endedAt = data.endedAt ? new Date(data.endedAt) : new Date();
    const durationMs = endedAt.getTime() - run.startedAt.getTime();

    // Finalize counters authoritatively from the DB rather than trusting incremental updates.
    const scope = {
      runId: run.id,
      organizationId: auth.organizationId,
      projectId: auth.projectId,
    };
    const [eventCount, redactionCount, costAgg, head] = await Promise.all([
      prisma.agentEvent.count({ where: scope }),
      prisma.redactionFinding.count({ where: scope }),
      prisma.agentEvent.aggregate({ where: scope, _sum: { costMicroUsd: true } }),
      prisma.agentEvent.findFirst({
        where: scope,
        orderBy: { seq: "desc" },
        select: { hash: true },
      }),
    ]);

    // Freeze the chain head as the seal. An empty run seals to genesis (a valid 0-event chain).
    const seal = head?.hash ?? genesisHash(run.id);

    const updated = await prisma.agentRun.update({
      where: {
        id_organizationId_projectId: {
          id: run.id,
          organizationId: auth.organizationId,
          projectId: auth.projectId,
        },
      },
      data: {
        status: data.status,
        endedAt,
        durationMs,
        eventCount,
        redactionCount,
        costMicroUsd: costAgg._sum.costMicroUsd ?? 0,
        seal,
      },
    });

    return jsonOk({ run: serializeRun(updated) }, 200, requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
