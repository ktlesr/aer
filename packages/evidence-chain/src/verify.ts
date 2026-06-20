import { genesisHash, hashEvent } from "./hash";
import type { ChainLink, VerifyResult } from "./types";

/**
 * The single shared verifier. Pure: input is ONLY the links + seal (+ runId for genesis).
 * No DB, no app context, no I/O. Consumers map their source (packet JSON / DB rows) into
 * ChainLink[] and delegate here — never reimplement chain logic.
 */
export function verifyChain(
  links: ChainLink[],
  seal: string | null,
  runId: string,
): VerifyResult {
  const ordered = [...links].sort((a, b) => a.seq - b.seq);

  // A run created before the chain feature carries no hashes — distinct from tampering.
  if (ordered.length > 0 && ordered.every((l) => !l.hash && !l.prevHash)) {
    return { ok: false, status: "legacy", reason: "no chain present (pre-chain run)" };
  }

  let prev = genesisHash(runId);
  let checked = 0;
  for (const link of ordered) {
    if (link.prevHash !== prev) {
      return {
        ok: false,
        status: "broken",
        brokenSeq: link.seq,
        reason: `prevHash mismatch at seq ${link.seq}`,
        checkedCount: checked,
      };
    }
    if (link.hash !== hashEvent(prev, link)) {
      return {
        ok: false,
        status: "broken",
        brokenSeq: link.seq,
        reason: `content hash mismatch at seq ${link.seq}`,
        checkedCount: checked,
      };
    }
    prev = link.hash;
    checked++;
  }

  // seal is null while a run is still running; only enforce once frozen.
  if (seal !== null && seal !== prev) {
    const lastSeq = ordered.length ? ordered[ordered.length - 1].seq : 0;
    return {
      ok: false,
      status: "broken",
      brokenSeq: lastSeq,
      reason: "seal does not match chain head",
      checkedCount: checked,
    };
  }

  return { ok: true, status: "verified", checkedCount: checked };
}
