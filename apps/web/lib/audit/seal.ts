// Stage 4: what gets frozen when a run is sealed — the run manifest and the receipt returned to
// the client. Manifest logic lives in @ktlsr/evidence-chain (shared with the offline verifier);
// this file only maps DB rows into it and handles the optional signing key.
import {
  RECEIPT,
  MANIFEST,
  buildManifest,
  manifestHash,
  publicKeyOf,
  signReceipt,
  type ManifestInput,
  type Receipt,
  type ReceiptStatement,
} from "@ktlsr/evidence-chain";
import type { AgentEvent, AgentRun } from "@/app/generated/prisma/client";

type EventFields = Pick<AgentEvent, "seq" | "hash" | "redactionPolicy" | "captureDeclared" | "sourced">;

/** DB rows → manifest input. Must agree field-for-field with manifestInputFromPacket(). */
export function manifestInputFromRows(run: AgentRun, events: EventFields[], seal: string): ManifestInput {
  return {
    run: {
      id: run.id,
      organizationId: run.organizationId,
      projectId: run.projectId,
      agentName: run.agentName,
      status: run.status,
      riskLevel: run.riskLevel,
      startedAt: run.startedAt.toISOString(),
      endedAt: run.endedAt ? run.endedAt.toISOString() : null,
      costMicroUsd: run.costMicroUsd,
      redactionPolicy: run.redactionPolicy,
      captureDeclared: run.captureDeclared ?? null,
      environment: run.environment,
      conversationRef: run.conversationRef,
      turnRef: run.turnRef,
      parentRunId: run.parentRunId,
    },
    events: events.map((e) => ({
      seq: e.seq,
      hash: e.hash ?? "",
      redactionPolicy: e.redactionPolicy,
      captureDeclared: e.captureDeclared ?? null,
      sourced: e.sourced ?? null,
    })),
    seal,
  };
}

export function sealManifest(run: AgentRun, events: EventFields[], seal: string): { version: string; hash: string } {
  return { version: MANIFEST, hash: manifestHash(buildManifest(manifestInputFromRows(run, events, seal))) };
}

/**
 * Signing key (optional). AER_RECEIPT_SIGNING_KEY = base64 PKCS8 DER (or PEM) Ed25519 private key,
 * AER_RECEIPT_KEY_ID = its public id. Unset → receipts are issued unsigned (still useful: a receipt
 * the client keeps is an anchor a later rewrite cannot match). The key is never logged or stored.
 */
function signingKey(): { key: string; id: string } | null {
  const key = process.env.AER_RECEIPT_SIGNING_KEY;
  const id = process.env.AER_RECEIPT_KEY_ID;
  return key && id ? { key, id } : null;
}

export function issueReceipt(run: AgentRun, manifest: { version: string; hash: string }, seal: string, eventCount: number): Receipt {
  const statement: ReceiptStatement = {
    receipt_version: RECEIPT,
    run_id: run.id,
    organization_id: run.organizationId,
    project_id: run.projectId,
    manifest_version: manifest.version,
    manifest_hash: `sha256:${manifest.hash}`,
    chain_head: `sha256:${seal}`,
    event_count: eventCount,
    issued_at: new Date().toISOString(),
    clock: "aer-server",
  };
  const k = signingKey();
  return k ? signReceipt(statement, k.key, k.id) : { statement, signature: null };
}

/**
 * Public keys a verifier MAY choose to trust: the active key plus retired ones kept for historical
 * receipts (AER_RECEIPT_PUBLIC_KEYS = JSON [{key_id, public_key, retired_at?}]). Publishing them here
 * is a convenience — a careful verifier pins the key it obtained earlier, out of band.
 */
export function publishedKeys(): Array<{ key_id: string; alg: "Ed25519"; public_key: string; status: "active" | "retired"; retired_at?: string }> {
  const out: ReturnType<typeof publishedKeys> = [];
  const k = signingKey();
  if (k) out.push({ key_id: k.id, alg: "Ed25519", public_key: publicKeyOf(k.key), status: "active" });
  try {
    const old = JSON.parse(process.env.AER_RECEIPT_PUBLIC_KEYS ?? "[]") as Array<{ key_id: string; public_key: string; retired_at?: string }>;
    for (const o of old) if (o.key_id !== k?.id) out.push({ key_id: o.key_id, alg: "Ed25519", public_key: o.public_key, status: "retired", retired_at: o.retired_at });
  } catch {
    // Malformed history config: publish only the active key rather than fail the endpoint.
  }
  return out;
}
