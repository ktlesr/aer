// Verified human approval (Stage 6). Three parties, three channels:
// - the agent (API key) REQUESTS an approval for one action + parameters on one run, and later
//   CONSUMES it with the same parameters right before acting;
// - a signed-in user of the same workspace DECIDES in the dashboard (approve / reject / revoke);
// - AER records every step as a server-written chain event (metadata.aer_approval — a key the
//   event API refuses from clients), so verified decisions are bound into the evidence chain.
// An agent's key can never produce an approved state. AER does NOT block the action itself: the
// application must call consume() and stop on refusal.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { canonicalize, unrepresentableKeyPath } from "@ktlsr/evidence-chain";
import type { Approval, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api/errors";
import { RUN_TX, lockRun, redactFields, toJsonInput } from "@/lib/api/helpers";
import { insertEvent, prepareEvent } from "@/lib/api/appendEvent";

export interface Tenant {
  organizationId: string;
  projectId: string;
}

export const APPROVAL_TTL = { defaultSeconds: 900, minSeconds: 30, maxSeconds: 86_400 } as const;
export const APPROVAL_MAX_USES = 10;

export type EffectiveStatus = "pending" | "approved" | "rejected" | "revoked" | "expired" | "used_up";

export function effectiveStatus(a: Pick<Approval, "status" | "expiresAt" | "uses" | "maxUses">, now = new Date()): EffectiveStatus {
  if (a.status === "rejected" || a.status === "revoked") return a.status;
  if (a.status === "approved" && a.uses >= a.maxUses) return "used_up";
  if (a.expiresAt.getTime() <= now.getTime()) return "expired";
  return a.status;
}

/**
 * Salted digests of the RAW action name and parameters. Masking is for display only: two values
 * that mask alike ("notify:a@x" / "notify:b@y") must still differ here. Never store an unsalted
 * hash of raw values anywhere.
 */
export const paramsDigest = (salt: string, params: unknown): string =>
  createHash("sha256").update(salt + "\n" + canonicalize(params ?? null), "utf8").digest("hex");
export const actionDigest = (salt: string, action: string): string =>
  createHash("sha256").update(salt + "\naction\n" + action, "utf8").digest("hex");

const sameDigest = (a: string, b: string): boolean => timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

/**
 * The binding hashes must never see two different inputs as one. Before hashing, refuse anything
 * the hash input would lose or merge:
 * - own `__proto__` keys (canonical/1 drops them);
 * - non-finite numbers (`1e400` parses to Infinity, which canonicalises to null — same as null);
 * - negative zero (canonicalises to `0`, so an approval for -0 would accept 0);
 * - integers beyond 2^53 (already rounded by the JSON parser: …993 and …992 become one value);
 * - strings or keys with unpaired UTF-16 surrogates (UTF-8 encoding turns each into U+FFFD).
 * Send exact large numbers / decimals as strings.
 */
export function unsupportedApprovalValue(value: unknown, path = "$"): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return `${path}: non-finite number`;
    if (Object.is(value, -0)) return `${path}: negative zero (send 0)`;
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) return `${path}: integer beyond 2^53 (send it as a string)`;
    return null;
  }
  if (typeof value === "string") return LONE_SURROGATE.test(value) ? `${path}: unpaired UTF-16 surrogate` : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const bad = unsupportedApprovalValue(value[i], `${path}[${i}]`);
      if (bad) return bad;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    if (unrepresentableKeyPath(value)) return `${path}: own "__proto__" key`;
    for (const [k, v] of Object.entries(value)) {
      if (LONE_SURROGATE.test(k)) return `${path}: key with an unpaired UTF-16 surrogate`;
      const bad = unsupportedApprovalValue(v, `${path}.*`); // key names may be personal data: not echoed
      if (bad) return bad;
    }
  }
  return null;
}
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function assertSupported(action: string, params: unknown): void {
  const bad = unsupportedApprovalValue(action, "action") ?? unsupportedApprovalValue(params, "params");
  // The message names the problem and the path, never the value. __proto__ keeps the HTTP layer's wording.
  if (bad?.endsWith('own "__proto__" key')) throw new ApiError("validation_error", 'Keys named "__proto__" are not accepted', 422);
  if (bad) throw new ApiError("validation_error", `Unsupported approval input — ${bad}`, 422);
}

/** What API clients and the dashboard see. Never the salt; params only as stored (redacted). */
export function serializeApproval(a: Approval) {
  return {
    id: a.id,
    runId: a.runId,
    action: a.action,
    params: a.paramsRedacted ?? null,
    paramsHash: `sha256:${a.paramsHash}`,
    status: effectiveStatus(a),
    maxUses: a.maxUses,
    uses: a.uses,
    requestedAt: a.requestedAt.toISOString(),
    expiresAt: a.expiresAt.toISOString(),
    decidedAt: a.decidedAt?.toISOString() ?? null,
    verified: a.status !== "pending",
    outcome: a.outcome ?? null,
  };
}

/** A server-written chain event describing an approval step. */
async function recordStep(
  tx: Prisma.TransactionClient,
  run: Awaited<ReturnType<typeof lockRun>>,
  type: "human_approval_requested" | "human_approval_granted" | "human_approval_rejected" | "human_approval_used",
  title: string,
  approval: Approval,
  extra: Record<string, unknown> = {},
) {
  await insertEvent(
    tx,
    run,
    prepareEvent({
      type,
      title,
      metadata: {
        aer_approval: {
          id: approval.id,
          action: approval.action,
          params_hash: `sha256:${approval.paramsHash}`,
          expires_at: approval.expiresAt.toISOString(),
          max_uses: approval.maxUses,
          recorded_by: "aer-server",
          ...extra,
        },
      },
    }),
  );
}

function assertOpen(run: { status: string }): void {
  if (run.status === "completed" || run.status === "failed") {
    throw new ApiError("conflict", "run_already_completed", 409);
  }
}

/** Agent: ask for approval of one action with these exact parameters. */
export async function requestApproval(
  tx: Prisma.TransactionClient,
  tenant: Tenant,
  runId: string,
  input: { action: string; params?: unknown; ttlSeconds?: number; maxUses?: number },
): Promise<Approval> {
  assertSupported(input.action, input.params);
  const run = await lockRun(tx, runId, tenant);
  assertOpen(run);
  const { values } = redactFields({ action: input.action, params: input.params });
  const salt = randomBytes(16).toString("hex");
  const ttl = input.ttlSeconds ?? APPROVAL_TTL.defaultSeconds;
  const approval = await tx.approval.create({
    data: {
      organizationId: tenant.organizationId,
      projectId: tenant.projectId,
      runId: run.id,
      action: values.action as string,
      paramsRedacted: toJsonInput(values.params),
      paramsSalt: salt,
      actionHash: actionDigest(salt, input.action),
      paramsHash: paramsDigest(salt, input.params),
      maxUses: input.maxUses ?? 1,
      expiresAt: new Date(Date.now() + ttl * 1000),
    },
  });
  await recordStep(tx, run, "human_approval_requested", `Approval requested: ${approval.action}`, approval, { state: "requested" });
  return approval;
}

export async function getApproval(tenant: Tenant, id: string): Promise<Approval> {
  const a = await prisma.approval.findFirst({ where: { id, organizationId: tenant.organizationId, projectId: tenant.projectId } });
  // Another tenant's approval is indistinguishable from a missing one.
  if (!a) throw new ApiError("not_found", "Approval not found", 404);
  return a;
}

/** Lock the run, then re-read the approval under that lock (decisions and uses are serialised). */
async function lockApproval(tx: Prisma.TransactionClient, tenant: Tenant, id: string) {
  const found = await tx.approval.findFirst({ where: { id, organizationId: tenant.organizationId, projectId: tenant.projectId } });
  if (!found) throw new ApiError("not_found", "Approval not found", 404);
  const run = await lockRun(tx, found.runId, tenant);
  const approval = await tx.approval.findUniqueOrThrow({ where: { id } });
  return { run, approval };
}

/**
 * Dashboard only: a signed-in user of the run's workspace approves or rejects a pending request.
 * `userId` comes from the session — there is no API-key path to this function.
 */
export async function decideApproval(tenant: Tenant, userId: string, id: string, decision: "approve" | "reject"): Promise<Approval> {
  return prisma.$transaction(async (tx) => {
    const { run, approval } = await lockApproval(tx, tenant, id);
    assertOpen(run);
    const state = effectiveStatus(approval);
    if (state !== "pending") throw new ApiError("conflict", `approval_${state}`, 409);
    const decided = await tx.approval.update({
      where: { id },
      data: { status: decision === "approve" ? "approved" : "rejected", decidedAt: new Date(), decidedByUserId: userId },
    });
    await recordStep(
      tx,
      run,
      decision === "approve" ? "human_approval_granted" : "human_approval_rejected",
      `Approval ${decision === "approve" ? "granted" : "rejected"} by a signed-in user: ${decided.action}`,
      decided,
      { state: decision === "approve" ? "approved" : "rejected", decided_by_user_id: userId, decided_at: decided.decidedAt!.toISOString() },
    );
    return decided;
  }, RUN_TX);
}

/** Dashboard only: withdraw an approval that has not been used up or expired. */
export async function revokeApproval(tenant: Tenant, userId: string, id: string): Promise<Approval> {
  return prisma.$transaction(async (tx) => {
    const { run, approval } = await lockApproval(tx, tenant, id);
    assertOpen(run);
    const state = effectiveStatus(approval);
    if (state !== "approved" && state !== "pending") throw new ApiError("conflict", `approval_${state}`, 409);
    const revoked = await tx.approval.update({ where: { id }, data: { status: "revoked", decidedAt: new Date(), decidedByUserId: userId } });
    await recordStep(tx, run, "human_approval_rejected", `Approval revoked by a signed-in user: ${revoked.action}`, revoked, {
      state: "revoked",
      decided_by_user_id: userId,
      decided_at: revoked.decidedAt!.toISOString(),
    });
    return revoked;
  }, RUN_TX);
}

/**
 * Agent, right before acting: use the approval for these exact parameters. Refused (409, with the
 * reason as the code) when pending, rejected, revoked, expired, used up, or the parameters differ.
 */
export async function consumeApproval(
  tx: Prisma.TransactionClient,
  tenant: Tenant,
  id: string,
  action: string,
  params: unknown,
): Promise<Approval> {
  assertSupported(action, params);
  const { run, approval } = await lockApproval(tx, tenant, id);
  assertOpen(run);
  const state = effectiveStatus(approval);
  if (state !== "approved") throw new ApiError("conflict", `approval_${state}`, 409);
  // The approval names ONE raw action (also when two actions only mask alike) and ONE raw
  // parameter set; either differing is refused, with the precise reason.
  if (!sameDigest(actionDigest(approval.paramsSalt, action), approval.actionHash)) {
    throw new ApiError("conflict", "approval_action_mismatch", 409);
  }
  if (!sameDigest(paramsDigest(approval.paramsSalt, params), approval.paramsHash)) {
    throw new ApiError("conflict", "approval_params_mismatch", 409);
  }
  const used = await tx.approval.update({ where: { id }, data: { uses: { increment: 1 }, lastUsedAt: new Date() } });
  await recordStep(tx, run, "human_approval_used", `Approval used: ${used.action}`, used, { state: "used", use: used.uses });
  return used;
}

/** Agent: what happened in the external system. Stored as the application's claim, once. */
export async function reportOutcome(
  tenant: Tenant,
  id: string,
  input: { status: "succeeded" | "failed"; externalRef?: string; receiptHash?: string },
): Promise<Approval> {
  return prisma.$transaction(async (tx) => {
    const { approval } = await lockApproval(tx, tenant, id);
    if (approval.uses === 0) throw new ApiError("conflict", "approval_not_used", 409);
    if (approval.outcome !== null) throw new ApiError("conflict", "outcome_already_reported", 409);
    const { values } = redactFields({ externalRef: input.externalRef });
    return tx.approval.update({
      where: { id },
      data: {
        outcome: {
          status: input.status,
          external_ref: (values.externalRef as string | undefined) ?? null,
          receipt_hash: input.receiptHash ?? null,
          reported_at: new Date().toISOString(),
          source: "application", // not verified by AER
        },
      },
    });
  }, RUN_TX);
}
