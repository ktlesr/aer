import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api/auth";
import { makeRequestId } from "@/lib/api/errors";
import { jsonOk, toErrorResponse } from "@/lib/api/respond";
import { readJson, redactFields, serializeRun, toJsonInput } from "@/lib/api/helpers";
import { createRunSchema, parseBody } from "@/lib/validation/schemas";

export async function POST(request: Request): Promise<Response> {
  const requestId = makeRequestId();
  try {
    const auth = await authenticate(request);
    const data = parseBody(createRunSchema, await readJson(request));

    // Redact every persisted field, not just input/output — a secret in agentName/metadata
    // must never survive into the DB or the audit packet.
    const { values, findings } = redactFields({
      agentName: data.agentName,
      metadata: data.metadata,
    });

    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.agentRun.create({
        data: {
          organizationId: auth.organizationId,
          projectId: auth.projectId,
          agentName: values.agentName as string,
          riskLevel: data.riskLevel ?? "low",
          metadata: toJsonInput(values.metadata),
          redactionCount: findings.length,
        },
      });

      if (findings.length > 0) {
        await tx.redactionFinding.createMany({
          data: findings.map((f) => ({
            organizationId: auth.organizationId,
            projectId: auth.projectId,
            runId: created.id,
            findingType: f.findingType,
            severity: f.severity,
            fieldPath: f.fieldPath,
            originalHash: f.originalHash,
          })),
        });
      }

      return created;
    });

    return jsonOk({ run: serializeRun(run) }, 201, requestId);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
