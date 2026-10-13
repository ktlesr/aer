import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api/auth";
import { makeRequestId } from "@/lib/api/errors";
import { jsonOk, toErrorResponse } from "@/lib/api/respond";
import {
  parseSdkHeader,
  readJson,
  redactFields,
  serializeRun,
  toJsonInput,
} from "@/lib/api/helpers";
import {
  claimKey,
  fingerprint,
  readIdempotencyKey,
  replayHeaders,
  saveResult,
  type StoredResult,
} from "@/lib/api/idempotency";
import { createRunSchema, parseBody } from "@/lib/validation/schemas";
import { REDACTION_POLICY } from "@/lib/redaction";

export async function POST(request: Request): Promise<Response> {
  const requestId = makeRequestId();
  try {
    const auth = await authenticate(request);
    const data = parseBody(createRunSchema, await readJson(request));
    const sdk = parseSdkHeader(request.headers.get("x-aer-sdk"));
    const idemKey = readIdempotencyKey(request);

    // Redact every persisted field, not just input/output — a secret in agentName/metadata
    // must never survive into the DB or the audit packet. The client-identity fields are
    // pattern-bounded already, but they are persisted too, so they go through the same gate.
    const { values, findings } = redactFields({
      agentName: data.agentName,
      metadata: data.metadata,
      environment: data.environment,
      sdkName: sdk?.sdkName,
      sdkVersion: sdk?.sdkVersion,
      captureDeclared: data.capture,
      conversationRef: data.conversationRef,
      turnRef: data.turnRef,
      parentRunId: data.parentRunId,
    });

    // The SDK identity header is telemetry, not meaning: it is left out of the fingerprint.
    // Findings come out in traversal (= JSON key) order; sorted so key order doesn't change meaning.
    const requestHash = fingerprint({
      agentName: values.agentName,
      metadata: values.metadata ?? null,
      environment: values.environment ?? null,
      riskLevel: data.riskLevel ?? null,
      capture: values.captureDeclared ?? null,
      conversationRef: values.conversationRef ?? null,
      turnRef: values.turnRef ?? null,
      parentRunId: values.parentRunId ?? null,
      findings: findings.map((f) => JSON.stringify([f.fieldPath, f.findingType, f.originalHash])).sort(),
    });

    const result = await prisma.$transaction(async (tx): Promise<StoredResult> => {
      if (idemKey) {
        const replay = await claimKey(tx, auth, idemKey, "run.create", null, requestHash);
        if (replay) return replay;
      }
      const created = await tx.agentRun.create({
        data: {
          organizationId: auth.organizationId,
          projectId: auth.projectId,
          agentName: values.agentName as string,
          riskLevel: data.riskLevel ?? "low",
          metadata: toJsonInput(values.metadata),
          environment: values.environment as string | undefined,
          sdkName: values.sdkName as string | undefined,
          sdkVersion: values.sdkVersion as string | undefined,
          redactionPolicy: REDACTION_POLICY,
          captureDeclared: toJsonInput(values.captureDeclared),
          // Not checked against existing runs here: a missing or foreign parent is stored as given
          // and resolved per tenant on read ("missing_context"), so the API never reveals whether
          // another tenant's run id exists.
          conversationRef: values.conversationRef as string | undefined,
          turnRef: values.turnRef as string | undefined,
          parentRunId: values.parentRunId as string | undefined,
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

      const out = { status: 201, body: { run: serializeRun(created) } };
      if (idemKey) await saveResult(tx, auth, idemKey, out);
      return { ...out, replayed: false };
    });

    return jsonOk(result.body, result.status, requestId, replayHeaders(result));
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
