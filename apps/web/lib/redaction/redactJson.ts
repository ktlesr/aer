import { createHash } from "node:crypto";
import { PATTERNS } from "./patterns";
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

  if (Array.isArray(value)) {
    return value.map((item, i) => redactValue(item, `${path}[${i}]`, findings));
  }

  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = redactValue(val, joinPath(path, key), findings);
    }
    return out;
  }

  // number, boolean, null, undefined, etc. — left untouched.
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
