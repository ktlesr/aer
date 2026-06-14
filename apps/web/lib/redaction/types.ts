// Public types for the redaction layer. Kept separate so patterns.ts and redactJson.ts
// can share them without a circular dependency through index.ts.

export type FindingType =
  | "email"
  | "phone"
  | "api_key"
  | "bearer_token"
  | "credit_card"
  | "national_id";

export type Severity = "low" | "medium" | "high";

/** A single detected sensitive value. Stores only a hash of the raw value — never the value. */
export interface RedactionFinding {
  findingType: FindingType;
  severity: Severity;
  /** Dotted/indexed path to the field, e.g. `customer.email` or `items[0].card`. */
  fieldPath: string;
  /** sha256 hex of the exact matched substring. */
  originalHash: string;
}

export interface RedactionResult {
  redacted: unknown;
  findings: RedactionFinding[];
}
