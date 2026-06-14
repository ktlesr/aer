import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api/auth";
import { makeRequestId } from "@/lib/api/errors";
import { jsonOk, toErrorResponse } from "@/lib/api/respond";
import { readJson, serializeRun, toJsonInput } from "@/lib/api/helpers";
import { createRunSchema, parseBody } from "@/lib/validation/schemas";

export async function POST(request: Request): Promise<Response> {
  const requestId = makeRequestId();
  try {
    const auth = await authenticate(request);
    const data = parseBody(createRunSchema, await readJson(request));

    const run = await prisma.agentRun.create({
      data: {
        organizationId: auth.organizationId,
        projectId: auth.projectId,
        agentName: data.agentName,
        riskLevel: data.riskLevel ?? "low",
        metadata: toJsonInput(data.metadata),
      },
    });

    return jsonOk({ run: serializeRun(run) }, 201, requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
