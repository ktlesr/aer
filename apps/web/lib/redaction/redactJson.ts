import { createHash } from "node:crypto";
import { PATTERNS, SECRET_TOKEN, isSecretKey } from "./patterns";
import type { RedactionFinding, RedactionResult } from "./types";

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

interface StringMatch {
  findingType: RedactionFinding["findingType"];
  severity: RedactionFinding["severity"];
  raw: string;
}

/** Redact every sensitive substring in one string. Returns the redacted string + raw matches. */
function redactString(input: string): { value: string; matches: StringMatch[] } {
  const matches: StringMatch[] = [];
  let value = input;

  for (const pattern of PATTERNS) {
    // Reset lastIndex defensively; .replace handles global regexes but the objects are shared.
    pattern.regex.lastIndex = 0;
    value = value.replace(pattern.regex, (match) => {
      if (pattern.validate && !pattern.validate(match)) {
        return match;
      }
      matches.push({
        findingType: pattern.findingType,
        severity: pattern.severity,
        raw: match,
      });
      return pattern.token;
    });
  }

  return { value, matches };
}

/**
 * A value under a secret-named key (password, apiKey, authorization…) is replaced whole, whatever
 * its type or shape. Its hash is NOT recorded: passwords and PINs are low-entropy, so a plain
 * sha256 would be reversible by guessing (originalHash = "" → "not recorded").
 */
function redactSecret(value: unknown, path: string, findings: RedactionFinding[]): unknown {
  // Empty or already-masked (e.g. by collector-js before sending) → nothing to find.
  if (value === null || value === undefined || value === "" || value === SECRET_TOKEN) return value;
  findings.push({ findingType: "secret", severity: "high", fieldPath: path, originalHash: "" });
  return SECRET_TOKEN;
}

function joinPath(parent: string, segment: string): string {
  return parent ? `${parent}.${segment}` : segment;
}

function redactValue(
  value: unknown,
  path: string,
  findings: RedactionFinding[],
): unknown {
  if (typeof value === "string") {
    const { value: redacted, matches } = redactString(value);
    for (const m of matches) {
      findings.push({
        findingType: m.findingType,
        severity: m.severity,
        fieldPath: path,
        originalHash: sha256(m.raw),
      });
    }
    return redacted;
  }

  if (typeof value === "number") {
    // A card/SSN sent as a JSON *number* (e.g. {"card": 4111111111111111}) would otherwise
    // bypass string-only detection. Only integers can be one; fractions/exponents (scores, metrics)
    // stay numbers untouched.
    if (!Number.isInteger(value)) return value;
    // Above 2^53 JSON.parse has already rounded the digits, so a 17–19 digit PAN can no longer be
    // Luhn-checked. Fail closed: such an integer is treated as a card. Send big ids as strings.
    const digits = Math.abs(value).toLocaleString("en-US", { useGrouping: false });
    if (!Number.isSafeInteger(value) && digits.length >= 13 && digits.length <= 19) {
      findings.push({
        findingType: "credit_card",
        severity: "high",
        fieldPath: path,
        originalHash: sha256(digits),
      });
      return "[REDACTED_CREDIT_CARD]";
    }
    const { value: redacted, matches } = redactString(String(value));
    if (matches.length === 0) return value;
    for (const m of matches) {
      findings.push({
        findingType: m.findingType,
        severity: m.severity,
        fieldPath: path,
        originalHash: sha256(m.raw),
      });
    }
    return redacted;
  }

  if (Array.isArray(value)) {
    return value.map((item, i) => redactValue(item, `${path}[${i}]`, findings));
  }

  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      // Object *keys* can be sensitive too (per-email / per-token maps). Redact the key itself;
      // the field path uses the already-redacted key so no raw value leaks into a finding path.
      const { value: maskedKey, matches } = redactString(key);
      // Two keys can mask to the same token ({"a@x.io":1,"b@x.io":2}). Never overwrite: later
      // duplicates get "#2", "#3"… in input order, which JSON.parse preserves — deterministic.
      let redactedKey = maskedKey;
      for (let n = 2; Object.hasOwn(out, redactedKey); n++) redactedKey = `${maskedKey}#${n}`;
      const keyPath = joinPath(path, redactedKey);
      for (const m of matches) {
        findings.push({
          findingType: m.findingType,
          severity: m.severity,
          fieldPath: keyPath,
          originalHash: sha256(m.raw),
        });
      }
      // defineProperty, not assignment: a "__proto__" key from JSON.parse must stay data.
      Object.defineProperty(out, redactedKey, {
        value: isSecretKey(key) ? redactSecret(val, keyPath, findings) : redactValue(val, keyPath, findings),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }

  // boolean, null, undefined, etc. — left untouched.
  return value;
}

/**
 * Deep-redact a JSON-like value. Returns a redacted clone (the input is never mutated) and a list
 * of findings. Findings carry only a sha256 hash of each detected value — never the raw value.
 */
export function redactJson(input: unknown): RedactionResult {
  const findings: RedactionFinding[] = [];
  const redacted = redactValue(input, "", findings);
  return { redacted, findings };
}
