import type { FindingType, Severity } from "./types";

/** Luhn checksum — used to keep credit-card detection from firing on arbitrary digit runs. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export interface RedactionPattern {
  findingType: FindingType;
  severity: Severity;
  token: string;
  /** Global regex; every match is a candidate. */
  regex: RegExp;
  /** Optional extra validation on the matched substring. Returning false skips redaction. */
  validate?: (match: string) => boolean;
}

const digitsOf = (s: string): string => s.replace(/\D/g, "");

// Order matters: the most specific / highest-entropy patterns run first so a token can never be
// re-detected by a looser pattern (e.g. an API key seen as a phone number). Each pattern runs on
// the string already redacted by the previous ones.
export const PATTERNS: RedactionPattern[] = [
  // JWT / bearer tokens.
  {
    findingType: "bearer_token",
    severity: "high",
    token: "[REDACTED_BEARER_TOKEN]",
    regex: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
  {
    findingType: "bearer_token",
    severity: "high",
    token: "[REDACTED_BEARER_TOKEN]",
    // Require a reasonably long token so short non-secret "Bearer x" strings aren't redacted.
    regex: /Bearer\s+[A-Za-z0-9._~+/-]{8,}=*/g,
  },
  // Prefixed API keys (OpenAI sk-/sk-proj-…, our aer_live_/test_/demo_… keys).
  // Hyphens/underscores are allowed in the body so sk-proj-… style keys are caught.
  {
    findingType: "api_key",
    severity: "high",
    token: "[REDACTED_API_KEY]",
    regex: /\b(?:sk|pk|rk)-[A-Za-z0-9][A-Za-z0-9_-]{15,}\b/g,
  },
  {
    findingType: "api_key",
    severity: "high",
    token: "[REDACTED_API_KEY]",
    regex: /\b[a-z]{2,}_(?:live|test|demo)_[A-Za-z0-9]{16,}\b/g,
  },
  // Our own minted keys: `aer_<32-hex>` (no live/test/demo infix — see lib/auth/api-keys.ts).
  // The highest-value secret in the system; must be caught if it lands in event data.
  {
    findingType: "api_key",
    severity: "high",
    token: "[REDACTED_API_KEY]",
    regex: /\baer_[A-Za-z0-9]{24,}\b/g,
  },
  // Credit-card-like: 13–19 digits with optional spaces/dashes, validated by Luhn.
  {
    findingType: "credit_card",
    severity: "high",
    token: "[REDACTED_CREDIT_CARD]",
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (m) => {
      const d = digitsOf(m);
      return d.length >= 13 && d.length <= 19 && luhnValid(d);
    },
  },
  // National-id-like: SSN format ###-##-#### or a bare 11-digit id (e.g. TR TCKN).
  // TR national id never starts with 0, so requiring a 1–9 first digit keeps this from
  // swallowing 11-digit phone numbers (which begin with the "0" trunk prefix).
  {
    findingType: "national_id",
    severity: "high",
    token: "[REDACTED_NATIONAL_ID]",
    regex: /\b\d{3}-\d{2}-\d{4}\b|\b[1-9]\d{10}\b/g,
  },
  // Email.
  {
    findingType: "email",
    severity: "medium",
    token: "[REDACTED_EMAIL]",
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  // Phone — intentionally strict to avoid false positives on money amounts ("4.000.000 TL"),
  // regulation/document numbers and dotted filenames ("9903_teblig.pdf"). A dot is NEVER a phone
  // separator (dots are thousands separators / file extensions). Only real telephony signals match:
  // a leading "+", a parenthesised area code, or the Turkish "0" trunk prefix.
  //
  // 1) International (E.164-style): leading "+", 8–15 digits, space/dash/paren separators.
  {
    findingType: "phone",
    severity: "medium",
    token: "[REDACTED_PHONE]",
    regex: /\+\d[\d ()-]{6,}\d/g,
    validate: (m) => {
      const d = digitsOf(m);
      return d.length >= 8 && d.length <= 15;
    },
  },
  // 2) Parenthesised area code (e.g. US "(415) 555-0142", TR "(0212) 345 67 89"). The parentheses
  //    are the signal — money and document numbers never use them this way.
  {
    findingType: "phone",
    severity: "medium",
    token: "[REDACTED_PHONE]",
    regex: /\(\d{2,4}\)[ -]?\d{3}[ -]?\d{2}[ -]?\d{2,4}/g,
    validate: (m) => {
      const d = digitsOf(m);
      return d.length >= 9 && d.length <= 13;
    },
  },
  // 3) Turkish national: "0" trunk prefix + 10 digits (3-3-2-2), space/dash/paren separators only.
  //    Word/dot boundaries stop it from biting into filenames like "02123456789_rapor.pdf".
  {
    findingType: "phone",
    severity: "medium",
    token: "[REDACTED_PHONE]",
    regex: /(?<![\w.])0[ (]?\d{3}[) ]?[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}(?![\w.])/g,
    validate: (m) => digitsOf(m).length === 11,
  },
];
