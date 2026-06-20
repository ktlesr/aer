import { createHash } from "node:crypto";
import { canonicalize } from "./canonicalize";
import type { EventCore } from "./types";

const sha256hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** Chain root, bound to the run so a chain copied wholesale from another run fails verification. */
export function genesisHash(runId: string): string {
  return sha256hex("AER-CHAIN-v1:" + runId);
}

/** The canonical, hashed projection of an event. Findings are sorted so storage order can't change the hash. */
function coreView(c: EventCore) {
  return {
    seq: c.seq,
    type: c.type,
    title: c.title,
    occurredAt: c.occurredAt,
    inputRedacted: c.inputRedacted ?? null,
    outputRedacted: c.outputRedacted ?? null,
    riskLevel: c.riskLevel ?? null,
    costMicroUsd: c.costMicroUsd ?? null,
    metadata: c.metadata ?? null,
    findings: [...c.findings]
      .map((f) => ({
        findingType: f.findingType,
        severity: f.severity,
        fieldPath: f.fieldPath,
        originalHash: f.originalHash,
      }))
      .sort((a, b) =>
        `${a.fieldPath}|${a.originalHash}|${a.findingType}`.localeCompare(
          `${b.fieldPath}|${b.originalHash}|${b.findingType}`,
        ),
      ),
  };
}

/** hash = sha256(prevHash + "\n" + canonical(core)). The delimiter keeps prev/core unambiguous. */
export function hashEvent(prevHash: string, core: EventCore): string {
  return sha256hex(prevHash + "\n" + canonicalize(coreView(core)));
}
