// Shared shapes. Framework-agnostic — no Prisma, no app types leak in here.

export interface Finding {
  findingType: string;
  severity: string;
  fieldPath: string;
  originalHash: string;
}

/** The exact, hashed view of an event. Only redacted snapshots + hashed findings — never raw data. */
export interface EventCore {
  seq: number;
  type: string;
  title: string;
  occurredAt: string; // ISO-8601; must equal the stored value
  inputRedacted: unknown;
  outputRedacted: unknown;
  riskLevel: string | null;
  costMicroUsd: number | null;
  metadata: unknown;
  findings: Finding[];
}

export interface ChainLink extends EventCore {
  hash: string;
  prevHash: string;
}

export type VerifyResult =
  | { ok: true; status: "verified"; checkedCount: number }
  | { ok: false; status: "broken"; brokenSeq: number; reason: string; checkedCount: number }
  | { ok: false; status: "legacy"; reason: string };
