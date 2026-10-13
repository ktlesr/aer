import { createHash } from "node:crypto";
import { canonicalize } from "./canonicalize";
import { genesisHash } from "./hash";
import { CANONICALIZATION, CHAIN, MANIFEST } from "./versions";

const sha256hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Everything the run manifest binds, as plain values. The server fills it from DB rows at seal
 * time; a verifier fills it from a packet. Both MUST pass the same values or the hashes differ —
 * that is the point: any drift between the frozen record and the packet is detected.
 */
export interface ManifestInput {
  run: {
    id: string;
    organizationId: string;
    projectId: string;
    agentName: string;
    status: string;
    riskLevel: string;
    startedAt: string; // ISO-8601
    endedAt: string | null;
    costMicroUsd: number;
    redactionPolicy: string | null;
    captureDeclared: unknown;
    environment: string | null;
    conversationRef: string | null;
    turnRef: string | null;
    parentRunId: string | null;
  };
  /** In seq order. `hash` is the chain link (raw hex), the rest is what the chain does not cover. */
  events: Array<{
    seq: number;
    hash: string;
    redactionPolicy: string | null;
    captureDeclared: unknown;
    sourced: unknown;
  }>;
  /** Chain head at seal (raw hex). */
  seal: string;
}

export type Manifest = ReturnType<typeof buildManifest>;

/**
 * The run manifest: binds run context (agent, status, tenant, policies, lineage) and each event's
 * out-of-chain fields (capture claim, policy, sourced block — the latter by digest) to the chain
 * head. Frozen at seal; its hash is what a receipt/signature commits to.
 */
export function buildManifest(input: ManifestInput) {
  const nullable = (v: unknown) => (v === undefined ? null : v);
  return {
    manifest_version: MANIFEST,
    canonicalization: CANONICALIZATION,
    hash_algorithm: "sha256",
    chain: {
      version: CHAIN,
      genesis: genesisHash(input.run.id),
      head: input.seal,
      event_count: input.events.length,
    },
    run: {
      id: input.run.id,
      organization_id: input.run.organizationId,
      project_id: input.run.projectId,
      agent_name: input.run.agentName,
      status: input.run.status,
      risk_level: input.run.riskLevel,
      started_at: input.run.startedAt,
      ended_at: input.run.endedAt,
      cost_micro_usd: input.run.costMicroUsd,
      redaction_policy: input.run.redactionPolicy,
      capture_declared: nullable(input.run.captureDeclared),
      environment: input.run.environment,
      conversation_ref: input.run.conversationRef,
      turn_ref: input.run.turnRef,
      parent_run_id: input.run.parentRunId,
    },
    events: [...input.events]
      .sort((a, b) => a.seq - b.seq)
      .map((e) => ({
        seq: e.seq,
        hash: e.hash,
        redaction_policy: e.redactionPolicy,
        capture_declared: nullable(e.captureDeclared),
        sourced_digest: e.sourced === null || e.sourced === undefined ? null : sha256hex(canonicalize(e.sourced)),
      })),
  };
}

/** sha256 over the manifest's canonical bytes (raw hex). */
export function manifestHash(manifest: Manifest): string {
  return sha256hex(canonicalize(manifest));
}
