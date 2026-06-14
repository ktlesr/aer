import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api/auth";
import { makeRequestId } from "@/lib/api/errors";
import { jsonOk, toErrorResponse } from "@/lib/api/respond";
import { readJson, requireRun, serializeRun } from "@/lib/api/helpers";
import { completeRunSchema, parseBody } from "@/lib/validation/schemas";

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

    const updated = await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: data.status, endedAt, durationMs },
    });

    return jsonOk({ run: serializeRun(updated) }, 200, requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
