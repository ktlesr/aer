#!/usr/bin/env node
// aer-verify — check an AER audit packet offline. Reads local files only; makes no network request.
//
//   aer-verify packet.json [--receipt receipt.json] [--trusted-key key.json ...] [--require-anchor] [--json]
//
// Exit codes: 0 verified · 2 verified with limits (partial / unsealed / legacy) · 1 failed · 4 unsupported/unreadable.
import { readFileSync } from "node:fs";
import { verifyPacket, type PacketReport, type Receipt, type TrustedKey } from "../../evidence-chain/src/index";

const USAGE =
  "usage: aer-verify <packet.json> [--receipt <receipt.json>] [--trusted-key <key.json>]... [--require-anchor] [--json]";

/** Fixed messages only: a parser/OS error message can quote file contents (keys, payloads). */
class InputError extends Error {}
function readJson(path: string, what: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new InputError(`cannot read the ${what} file`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new InputError(`the ${what} file is not valid JSON`);
  }
}

/** Accepts the receipt itself or the whole `complete` response ({ run, receipt }). */
function toReceipt(v: unknown): Receipt {
  const o = v as { receipt?: Receipt; statement?: unknown };
  if (o && typeof o === "object" && o.statement) return o as Receipt;
  if (o && typeof o === "object" && o.receipt) return o.receipt;
  throw new InputError("the receipt file has no `statement`");
}

/** Accepts one key {key_id, public_key}, an array of them, or the /api/v1/receipt-keys response. */
function toKeys(v: unknown): TrustedKey[] {
  const list = Array.isArray(v) ? v : v && typeof v === "object" && "keys" in v ? (v as { keys: unknown[] }).keys : [v];
  return list.map((k) => {
    const o = k as TrustedKey;
    if (!o || typeof o.key_id !== "string" || typeof o.public_key !== "string") throw new InputError("a trusted key needs key_id and public_key");
    return { key_id: o.key_id, public_key: o.public_key };
  });
}

const LINES: Array<[keyof PacketReport, string]> = [
  ["schema", "Schema"],
  ["chain", "Event chain"],
  ["seal", "Seal"],
  ["manifest", "Run manifest"],
  ["content_hash", "Content hash"],
  ["packet_receipt", "Receipt in packet"],
  ["signature", "Receipt signature"],
  ["trusted_receipt", "Your kept receipt"],
  ["trusted_receipt_signature", "Kept receipt signature"],
];

function render(r: PacketReport): string {
  const out = [`AER packet verification — ${r.overall.toUpperCase()}`, ""];
  for (const [key, label] of LINES) {
    const c = r[key] as { status: string; detail?: string; key_id?: string; reason?: string; version?: string | null };
    const extra = [c.version && `v${c.version}`, c.key_id && `key ${c.key_id}`, c.detail, c.reason].filter(Boolean).join(" · ");
    out.push(`  ${label.padEnd(24)} ${c.status}${extra ? `  (${extra})` : ""}`);
  }
  out.push("", `  Versions: canonical ${r.versions.canonicalization}, chain ${r.versions.chain}, manifest ${r.versions.manifest ?? "—"}, content ${r.versions.content_hash}`);
  out.push(
    r.anchored
      ? "  Anchored: yes — tied to a receipt you kept or a key you trust."
      : "  Anchored: NO — this only shows the file is internally consistent. Whoever produced it could have",
  );
  if (!r.anchored) out.push("            rewritten and recomputed everything. Pass --receipt and/or --trusted-key to anchor it.");
  if (r.not_integrity_bound.length) {
    out.push("", "  Not covered by chain or manifest (editable without detection):");
    for (const f of r.not_integrity_bound) out.push(`    - ${f}`);
  }
  out.push("", "  AER verifies what was recorded, not that the recorded events happened or that sources are correct.");
  return out.join("\n");
}

export function main(argv: string[]): number {
  const args = [...argv];
  let packetPath: string | undefined;
  let receiptPath: string | undefined;
  const keyPaths: string[] = [];
  let json = false;
  let requireAnchor = false;
  while (args.length) {
    const a = args.shift()!;
    if (a === "--receipt") receiptPath = args.shift();
    else if (a === "--trusted-key") keyPaths.push(args.shift() ?? "");
    else if (a === "--json") json = true;
    else if (a === "--require-anchor") requireAnchor = true;
    else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      return 0;
    } else if (!packetPath && !a.startsWith("--")) packetPath = a;
    else {
      console.error(USAGE);
      return 4;
    }
  }
  if (!packetPath) {
    console.error(USAGE);
    return 4;
  }

  let report: PacketReport;
  try {
    report = verifyPacket(readJson(packetPath, "packet"), {
      trustedReceipt: receiptPath ? toReceipt(readJson(receiptPath, "receipt")) : undefined,
      trustedKeys: keyPaths.flatMap((p) => toKeys(readJson(p, "trusted key"))),
    });
  } catch (err) {
    // Unreadable input: our own fixed message, never the underlying error text.
    console.error(`aer-verify: ${err instanceof InputError ? err.message : "input could not be processed"}`);
    return 4;
  }

  console.log(json ? JSON.stringify(report, null, 2) : render(report));
  if (report.overall === "unsupported") return 4;
  if (report.overall === "failed") return 1;
  if (requireAnchor && !report.anchored) return 1;
  return report.overall === "verified" ? 0 : 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
