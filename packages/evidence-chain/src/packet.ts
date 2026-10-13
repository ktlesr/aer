// Offline packet verification. Input: a parsed packet (JSON) plus what the VERIFIER trusts (a receipt
// it kept, public keys it obtained out of band). No network, no DB, no AER account.
import { createHash } from "node:crypto";
import { canonicalize } from "./canonicalize";
import { buildManifest, manifestHash, type ManifestInput } from "./manifest";
import { checkReceiptSignature, type Receipt, type SignatureCheck, type TrustedKey } from "./receipt";
import { genesisHash } from "./hash";
import { unrepresentableKeyPath } from "./representable";
import type { ChainLink } from "./types";
import { verifyChain } from "./verify";
import { CANONICALIZATION, CHAIN, CONTENT_HASH, CONTENT_HASH_LEGACY, MANIFEST, RECEIPT, SUPPORTED_PACKET_SCHEMAS } from "./versions";

const sha256hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
const strip = (v: string): string => v.replace(/^sha256:/, "");
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Packet events → chain links, `sha256:` presentation prefix removed (the bytes the writer hashed). */
export function packetChainLinks(packet: Obj): ChainLink[] {
  const events = Array.isArray(packet.events) ? (packet.events as Obj[]) : [];
  return events.map((e) => ({
    seq: e.seq as number,
    type: e.type as string,
    title: e.title as string,
    occurredAt: e.occurredAt as string,
    inputRedacted: e.inputRedacted ?? null,
    outputRedacted: e.outputRedacted ?? null,
    riskLevel: (e.riskLevel as string | null) ?? null,
    costMicroUsd: (e.costMicroUsd as number | null) ?? null,
    metadata: e.metadata ?? null,
    findings: (Array.isArray(e.findings) ? (e.findings as Obj[]) : []).map((f) => ({
      findingType: f.findingType as string,
      severity: f.severity as string,
      fieldPath: f.fieldPath as string,
      originalHash: typeof f.originalHash === "string" ? strip(f.originalHash) : "",
    })),
    hash: typeof e.hash === "string" ? strip(e.hash) : "",
    prevHash: typeof e.prevHash === "string" ? strip(e.prevHash) : "",
  }));
}

/** A capture view {layer, ...declared} back to the stored declaration. */
function declared(capture: unknown): unknown {
  const d = isObj(capture) ? capture.client_declared : null;
  if (!isObj(d)) return null;
  const { layer: _layer, ...rest } = d;
  return rest;
}
const serverPolicy = (capture: unknown): string | null => {
  const s = isObj(capture) ? capture.server_applied : null;
  return isObj(s) ? str(s.policy) : null;
};

/** Rebuild the manifest input from a 2.x packet — must match what the server froze at seal. */
export function manifestInputFromPacket(packet: Obj): ManifestInput {
  const run = packet.run as Obj;
  const links = isObj(run.links) ? run.links : {};
  const parent = isObj(links.parentRun) ? links.parentRun : null;
  return {
    run: {
      id: run.id as string,
      organizationId: run.organizationId as string,
      projectId: run.projectId as string,
      agentName: run.agentName as string,
      status: run.status as string,
      riskLevel: run.riskLevel as string,
      startedAt: run.startedAt as string,
      endedAt: str(run.endedAt),
      costMicroUsd: run.costMicroUsd as number,
      redactionPolicy: serverPolicy(run.capture),
      captureDeclared: declared(run.capture),
      environment: str(run.environment),
      conversationRef: str(links.conversationRef),
      turnRef: str(links.turnRef),
      parentRunId: parent ? str(parent.id) : null,
    },
    events: (packet.events as Obj[]).map((e) => {
      let sourced: unknown = null;
      if (isObj(e.sourced)) {
        // `not_recorded` is a reading aid added at export time, not part of the stored block.
        const { not_recorded: _gaps, ...rest } = e.sourced;
        sourced = rest;
      }
      return {
        seq: e.seq as number,
        hash: typeof e.hash === "string" ? strip(e.hash) : "",
        redactionPolicy: serverPolicy(e.capture),
        captureDeclared: declared(e.capture),
        sourced,
      };
    }),
    seal: typeof packet.seal === "string" ? strip(packet.seal) : "",
  };
}

/** content_hash as the writer computed it, per schema generation. */
export function packetContentHash(packet: Obj): { algorithm: string; hex: string } {
  const exp = isObj(packet.export) ? packet.export : {};
  const { content_hash: _h, ...restExport } = exp;
  const base = { ...packet, export: restExport };
  return String(packet.schema_version).startsWith("1.")
    ? { algorithm: CONTENT_HASH_LEGACY, hex: sha256hex(JSON.stringify(base)) }
    : { algorithm: CONTENT_HASH, hex: sha256hex(canonicalize(base)) };
}

/** Fields only the content_hash covers — anyone who edits the file can recompute that hash too. */
const NOT_INTEGRITY_BOUND: Record<"1" | "2", string[]> = {
  "1": [
    "run.* (agentName, status, riskLevel, times, counters)",
    "run.capture / events[].capture",
    "run.links / events[].sourced",
    "redaction_findings (copy of events[].findings)",
    "export.*",
  ],
  "2": [
    "run.durationMs, run.eventCount, run.redactionCount (counters)",
    "run.links.parentRun.status / agentName (resolved at export time)",
    "events[].sourced.not_recorded (derived at export time)",
    "redaction_findings (copy of events[].findings)",
    "views, coverage (descriptive)",
    "export.* (generatedAt, type)",
  ],
};

export type Check<S extends string> = { status: S; detail?: string };

export interface PacketReport {
  overall: "verified" | "verified_partial" | "consistent_unsealed" | "legacy_unchained" | "failed" | "unsupported";
  /**
   * Whether the result is tied to something the VERIFIER trusts (a receipt it kept, or a signature
   * by a key it supplied). Without that, "verified" means internally consistent — a full rewrite by
   * whoever produced the file would also be internally consistent.
   */
  anchored: boolean;
  schema: Check<"supported" | "unsupported" | "malformed"> & { version: string | null };
  versions: { canonicalization: string; chain: string; manifest: string | null; content_hash: string };
  chain: Check<"verified" | "consistent_unsealed" | "broken" | "legacy" | "not_run">;
  content_hash: Check<"verified" | "mismatch" | "not_reproducible" | "missing" | "not_run">;
  manifest: Check<"verified" | "mismatch" | "not_frozen" | "not_in_schema" | "not_run">;
  seal: Check<"sealed" | "unsealed" | "not_run">;
  signature: SignatureCheck | { status: "not_run" };
  packet_receipt: Check<"matches_packet" | "mismatch" | "not_present" | "not_run">;
  trusted_receipt: Check<"match" | "mismatch" | "not_provided" | "cannot_compare" | "not_run">;
  trusted_receipt_signature: SignatureCheck | { status: "not_provided" | "not_run" };
  not_integrity_bound: string[];
}

const HASH = /^sha256:[0-9a-f]{64}$/;
const isInt = (v: unknown): boolean => Number.isInteger(v);
const isStrOrNull = (v: unknown): boolean => v === null || typeof v === "string";
const isHashOrNull = (v: unknown): boolean => v === null || (typeof v === "string" && HASH.test(v));

/**
 * The packet's shape, checked BEFORE anything is hashed or compared: a wrong type must never be
 * normalised into a valid one (e.g. `sourced: []` read as null). Free-form JSON (input/output/
 * metadata, sourced/declaration contents) is only required to be present with the right outer type.
 */
export function packetShapeError(p: Obj, version: string): string | null {
  const minor = version.startsWith("1.") ? Number(version.slice(2)) : 99;
  const run = p.run as Obj;
  const top: Array<[string, boolean]> = [
    ["run.id", typeof run.id === "string"],
    ["run.agentName", typeof run.agentName === "string"],
    ["run.status", typeof run.status === "string"],
    ["run.riskLevel", typeof run.riskLevel === "string"],
    ["run.startedAt", typeof run.startedAt === "string"],
    ["run.endedAt", isStrOrNull(run.endedAt)],
    ["run.costMicroUsd", isInt(run.costMicroUsd)],
    ["seal", isHashOrNull(p.seal)],
    ["chain", isObj(p.chain) && typeof p.chain.algorithm === "string" && typeof p.chain.genesis === "string"],
    ["export", isObj(p.export) && typeof p.export.generatedAt === "string"],
    ["redaction_findings", Array.isArray(p.redaction_findings)],
  ];
  if (minor >= 2) top.push(["run.capture", captureOk(run.capture)]);
  if (minor >= 3) {
    const l = run.links;
    top.push([
      "run.links",
      isObj(l) && isStrOrNull(l.conversationRef) && isStrOrNull(l.turnRef) &&
        (l.parentRun === null || (isObj(l.parentRun) && typeof l.parentRun.id === "string")),
    ]);
  }
  if (minor === 99) {
    top.push(
      ["run.organizationId", typeof run.organizationId === "string"],
      ["run.projectId", typeof run.projectId === "string"],
      ["run.environment", isStrOrNull(run.environment)],
      ["manifest_hash", isHashOrNull(p.manifest_hash)],
      ["receipt", p.receipt === null || receiptShapeOk(p.receipt)],
      ["versions", isObj(p.versions)],
    );
  }
  for (const [field, ok] of top) if (!ok) return `${field} has the wrong type or is missing`;
  const events = p.events as unknown[];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!isObj(e)) return `events[${i}] is not an object`;
    const checks: Array<[string, boolean]> = [
      ["seq", isInt(e.seq) && (e.seq as number) > 0],
      ["type", typeof e.type === "string"],
      ["title", typeof e.title === "string"],
      ["occurredAt", typeof e.occurredAt === "string"],
      ["inputRedacted", "inputRedacted" in e],
      ["outputRedacted", "outputRedacted" in e],
      ["metadata", "metadata" in e],
      ["riskLevel", isStrOrNull(e.riskLevel)],
      ["costMicroUsd", e.costMicroUsd === null || isInt(e.costMicroUsd)],
      ["hash", isHashOrNull(e.hash)],
      ["prevHash", isHashOrNull(e.prevHash)],
      [
        "findings",
        Array.isArray(e.findings) &&
          e.findings.every(
            (f) => isObj(f) && typeof f.findingType === "string" && typeof f.severity === "string" &&
              typeof f.fieldPath === "string" && isHashOrNull(f.originalHash),
          ),
      ],
    ];
    if (minor >= 2) checks.push(["capture", captureOk(e.capture)]);
    if (minor >= 3) checks.push(["sourced", e.sourced === null || isObj(e.sourced)]);
    for (const [field, ok] of checks) if (!ok) return `events[${i}].${field} has the wrong type or is missing`;
  }
  return null;
}

function captureOk(c: unknown): boolean {
  if (!isObj(c)) return false;
  const s = c.server_applied;
  const d = c.client_declared;
  return (
    (s === null || (isObj(s) && s.layer === "server" && typeof s.policy === "string")) &&
    (d === null || (isObj(d) && d.layer === "client"))
  );
}

function receiptShapeOk(r: unknown): boolean {
  if (!isObj(r) || !isObj(r.statement)) return false;
  const s = r.signature;
  return s === null || (isObj(s) && typeof s.alg === "string" && typeof s.key_id === "string" && typeof s.value === "string");
}

/** Declared algorithm versions this verifier implements; anything else is unsupported, never assumed. */
function versionError(p: Obj, version: string, runId: string): string | null {
  const chain = p.chain as Obj;
  if (chain.algorithm !== "sha256") return `chain.algorithm ${String(chain.algorithm)} not supported`;
  if (chain.genesis !== `sha256:${genesisHash(runId)}`) return "chain.genesis is not the aer-chain/1 genesis for this run";
  if (version.startsWith("1.")) return null; // 1.x predates declared versions: implicitly canonical/1 + chain/1
  const v = p.versions as Obj;
  if (v.canonicalization !== CANONICALIZATION) return `canonicalization ${String(v.canonicalization)} not supported`;
  if (v.chain !== CHAIN) return `chain ${String(v.chain)} not supported`;
  if (v.content_hash !== CONTENT_HASH) return `content_hash ${String(v.content_hash)} not supported`;
  if (!(v.manifest === null || v.manifest === MANIFEST)) return `manifest ${String(v.manifest)} not supported`;
  if (p.manifest_hash !== null && v.manifest !== MANIFEST) return "manifest_hash present without a supported manifest version";
  return null;
}

interface ReceiptContext {
  runId: string;
  run: Obj;
  seal: string | null;
  manifest: string | null;
  events: number;
}

/** Every commitment in a receipt statement, checked against the packet; issued_at stays a claim. */
function receiptMismatch(s: unknown, ctx: ReceiptContext): string | null {
  if (!isObj(s)) return "receipt has no statement";
  if (s.receipt_version !== RECEIPT) return `receipt_version ${String(s.receipt_version)} not supported`;
  if (s.manifest_version !== MANIFEST) return `manifest_version ${String(s.manifest_version)} not supported`;
  const checks: Array<[string, boolean]> = [
    ["run_id", s.run_id === ctx.runId],
    ["organization_id", s.organization_id === ctx.run.organizationId],
    ["project_id", s.project_id === ctx.run.projectId],
    ["manifest_hash", typeof s.manifest_hash === "string" && ctx.manifest !== null && strip(s.manifest_hash) === ctx.manifest],
    ["chain_head", typeof s.chain_head === "string" && ctx.seal !== null && strip(s.chain_head) === ctx.seal],
    ["event_count", s.event_count === ctx.events],
    ["clock", s.clock === "aer-server"],
    ["issued_at", typeof s.issued_at === "string"],
  ];
  for (const [field, ok] of checks) if (!ok) return `receipt ${field} does not match this packet`;
  return null;
}

export interface VerifyPacketOptions {
  /** A receipt the verifier kept from sealing time (e.g. the `complete` response) — never the packet's own. */
  trustedReceipt?: Receipt;
  trustedKeys?: TrustedKey[];
}

/**
 * Verify a packet offline. Each check is reported on its own; `overall` is "verified" only when the
 * schema is current, the chain is sealed and intact, the content hash and the manifest reproduce,
 * and nothing that was checked failed. Never throws on bad input — reports it.
 */
export function verifyPacket(input: unknown, opts: VerifyPacketOptions = {}): PacketReport {
  const trusted = opts.trustedKeys ?? [];
  const report: PacketReport = {
    overall: "failed",
    anchored: false,
    schema: { status: "malformed", version: null },
    versions: { canonicalization: CANONICALIZATION, chain: CHAIN, manifest: null, content_hash: CONTENT_HASH },
    chain: { status: "not_run" },
    content_hash: { status: "not_run" },
    manifest: { status: "not_run" },
    seal: { status: "not_run" },
    signature: { status: "not_run" },
    packet_receipt: { status: "not_run" },
    trusted_receipt: { status: "not_run" },
    trusted_receipt_signature: { status: "not_run" },
    not_integrity_bound: [],
  };
  if (!isObj(input) || !isObj(input.run) || typeof input.run.id !== "string" || !Array.isArray(input.events)) {
    report.schema.detail = "not an AER packet (run.id / events missing)";
    return report;
  }
  const packet = input;
  const version = str(packet.schema_version);
  report.schema.version = version;
  if (!version || !(SUPPORTED_PACKET_SCHEMAS as readonly string[]).includes(version)) {
    // Never "verify" a format this verifier does not know: its hash scopes may differ.
    report.schema = { status: "unsupported", version, detail: `supported: ${SUPPORTED_PACKET_SCHEMAS.join(", ")}` };
    report.overall = "unsupported";
    return report;
  }
  const legacySchema = version.startsWith("1.");
  const runId = (packet.run as Obj).id as string;
  // Shape first: a wrong type is never coerced into a valid one before hashing/comparison.
  const shape = packetShapeError(packet, version);
  const proto = shape ? null : unrepresentableKeyPath(packet);
  if (shape || proto) {
    report.schema = {
      status: "malformed",
      version,
      detail: shape ?? `${proto}: own "__proto__" keys are not representable in ${CANONICALIZATION} (not covered by any hash)`,
    };
    return report;
  }
  // Declared algorithms are reported as declared and checked — never assumed to be this build's.
  if (!legacySchema) {
    const v = packet.versions as Obj;
    report.versions = {
      canonicalization: String(v.canonicalization),
      chain: String(v.chain),
      manifest: v.manifest === null ? null : String(v.manifest),
      content_hash: String(v.content_hash),
    };
  } else {
    report.versions.content_hash = CONTENT_HASH_LEGACY;
  }
  const unsupported = versionError(packet, version, runId);
  if (unsupported) {
    report.schema = { status: "unsupported", version, detail: unsupported };
    report.overall = "unsupported";
    return report;
  }
  report.schema.status = "supported";
  report.not_integrity_bound = NOT_INTEGRITY_BOUND[legacySchema ? "1" : "2"];
  const seal = typeof packet.seal === "string" ? strip(packet.seal) : null;

  // 1. Chain.
  try {
    const v = verifyChain(packetChainLinks(packet), seal, runId);
    report.chain = v.ok
      ? { status: v.status, detail: `${v.checkedCount} events` }
      : v.status === "legacy"
        ? { status: "legacy", detail: v.reason }
        : { status: "broken", detail: v.reason };
  } catch {
    report.chain = { status: "broken", detail: "events are not well-formed chain links" };
  }
  report.seal = { status: seal ? "sealed" : "unsealed" };

  // 2. Content hash (whole file consistency — NOT tamper evidence on its own).
  const claimed = isObj(packet.export) ? str(packet.export.content_hash) : null;
  const computed = packetContentHash(packet);
  if (!claimed) report.content_hash = { status: "missing" };
  else if (strip(claimed) === computed.hex) report.content_hash = { status: "verified" };
  else
    report.content_hash = legacySchema
      ? { status: "not_reproducible", detail: "1.x hashes the writer's key order; storage may have reordered keys" }
      : { status: "mismatch" };

  // 3. Manifest (2.x): rebuilt from the packet, compared with the hash frozen at seal.
  let rebuilt: string | null = null;
  if (legacySchema) report.manifest = { status: "not_in_schema" };
  else {
    const frozen = str(packet.manifest_hash);
    try {
      rebuilt = seal ? manifestHash(buildManifest(manifestInputFromPacket(packet))) : null;
    } catch {
      rebuilt = null;
    }
    if (!frozen) report.manifest = { status: "not_frozen", detail: seal ? "sealed before run manifests existed" : "run not sealed" };
    else if (rebuilt && strip(frozen) === rebuilt) report.manifest = { status: "verified" };
    else report.manifest = { status: "mismatch", detail: "run context or out-of-chain event fields differ from what was frozen at seal" };
  }

  const receiptCtx: ReceiptContext = { runId, run: packet.run as Obj, seal, manifest: rebuilt, events: (packet.events as unknown[]).length };

  // 4. The server's receipt inside the packet: signature only counts against keys the verifier trusts.
  const packetReceipt = isObj(packet.receipt) ? (packet.receipt as unknown as Receipt) : null;
  if (!packetReceipt) {
    report.packet_receipt = { status: "not_present" };
    report.signature = { status: "not_present" };
  } else {
    report.signature = checkReceiptSignature(packetReceipt, trusted);
    const why = receiptMismatch(packetReceipt.statement, receiptCtx);
    report.packet_receipt = why ? { status: "mismatch", detail: why } : { status: "matches_packet" };
  }

  // 5. A receipt the verifier kept: the anchor that a fully recomputed packet cannot match.
  if (!opts.trustedReceipt) {
    report.trusted_receipt = { status: "not_provided" };
    report.trusted_receipt_signature = { status: "not_provided" };
  } else {
    report.trusted_receipt_signature = checkReceiptSignature(opts.trustedReceipt, trusted);
    const why = rebuilt ? receiptMismatch(opts.trustedReceipt.statement, receiptCtx) : null;
    if (!rebuilt) report.trusted_receipt = { status: "cannot_compare", detail: "packet has no reproducible manifest (unsealed or schema 1.x)" };
    else if (why) report.trusted_receipt = { status: "mismatch", detail: `packet differs from the run you hold a receipt for: ${why}` };
    else report.trusted_receipt = { status: "match" };
  }

  const failed =
    report.chain.status === "broken" ||
    report.content_hash.status === "mismatch" ||
    report.manifest.status === "mismatch" ||
    report.signature.status === "invalid" ||
    report.packet_receipt.status === "mismatch" ||
    report.trusted_receipt.status === "mismatch" ||
    report.trusted_receipt.status === "cannot_compare" ||
    report.trusted_receipt_signature.status === "invalid";
  report.anchored =
    !failed && (report.signature.status === "valid_trusted" || report.trusted_receipt.status === "match");
  report.overall = failed
    ? "failed"
    : report.chain.status === "legacy"
      ? "legacy_unchained"
      : report.chain.status === "consistent_unsealed"
        ? "consistent_unsealed"
        : legacySchema || report.manifest.status !== "verified" || report.content_hash.status !== "verified"
          ? "verified_partial"
          : "verified";
  return report;
}
