import { createHash, randomUUID } from "node:crypto";
import { canonicalize } from "@ktlsr/evidence-chain";
import type { Prisma } from "@/app/generated/prisma/client";
import { ApiError } from "./errors";
import type { AuthContext } from "./auth";

// Idempotency-Key contract (POST /runs, /runs/:id/events, /runs/:id/complete):
// - Scope: (organization, project, key). The same key in another tenant is a different key.
// - Same key + same operation/run + same meaning → the first response is returned again
//   (header Idempotent-Replayed: true), even after the run was completed.
// - Same key + anything else → 409 conflict. The first write is never changed.
// - Records expire after IDEMPOTENCY_TTL_MS; after that the key is free again (a late retry
//   would then create a new write). Expired rows are reclaimed lazily and by `pnpm prune:runs`.

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_FORMAT = /^[A-Za-z0-9._:-]{1,200}$/;

export type Operation = "run.create" | "event.create" | "run.complete";
export interface StoredResult {
  status: number;
  body: unknown;
  replayed: boolean;
}

export function readIdempotencyKey(request: Request): string | null {
  const raw = request.headers.get("idempotency-key");
  if (raw === null) return null;
  if (!KEY_FORMAT.test(raw)) {
    // Never echo the header: it is caller-controlled.
    throw new ApiError("validation_error", "Idempotency-Key must be 1-200 chars of A-Z a-z 0-9 . _ : -", 422);
  }
  return raw;
}

/**
 * Fingerprint of the request's meaning. Callers pass the ALREADY-REDACTED values plus finding
 * hashes, so the stored hash reveals nothing the evidence rows don't already hold. Consequence:
 * two bodies that differ only inside a masked secret field look identical (and store identically).
 */
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

/**
 * Claim `key` inside the caller's transaction. Returns null when this request owns the key (go
 * ahead and write, then call `saveResult`), or the stored result to replay. A concurrent claim
 * of the same key waits on the unique index until the other transaction commits or rolls back.
 */
export async function claimKey(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  key: string,
  operation: Operation,
  runId: string | null,
  requestHash: string,
): Promise<StoredResult | null> {
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "IdempotencyRecord"
      ("id", "organizationId", "projectId", "key", "operation", "runId", "requestHash",
       "responseStatus", "responseBody", "expiresAt")
    VALUES (${randomUUID()}, ${auth.organizationId}, ${auth.projectId}, ${key}, ${operation},
            ${runId}, ${requestHash}, 0, 'null'::jsonb, ${expiresAt})
    ON CONFLICT ("organizationId", "projectId", "key") DO NOTHING
    RETURNING "id"`;
  if (inserted.length > 0) return null;

  const scope = { organizationId: auth.organizationId, projectId: auth.projectId, key };
  const existing = await tx.idempotencyRecord.findUniqueOrThrow({
    where: { organizationId_projectId_key: scope },
  });
  if (existing.expiresAt.getTime() <= Date.now()) {
    await tx.idempotencyRecord.delete({ where: { id: existing.id } });
    return claimKey(tx, auth, key, operation, runId, requestHash);
  }
  if (existing.operation !== operation || existing.runId !== runId || existing.requestHash !== requestHash) {
    throw new ApiError("conflict", "Idempotency-Key was already used for a different request", 409);
  }
  return { status: existing.responseStatus, body: existing.responseBody, replayed: true };
}

export async function saveResult(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  key: string,
  result: { status: number; body: unknown },
): Promise<void> {
  await tx.idempotencyRecord.update({
    where: { organizationId_projectId_key: { organizationId: auth.organizationId, projectId: auth.projectId, key } },
    data: { responseStatus: result.status, responseBody: result.body as Prisma.InputJsonValue },
  });
}

export function replayHeaders(result: StoredResult): Record<string, string> {
  return result.replayed ? { "idempotent-replayed": "true" } : {};
}
