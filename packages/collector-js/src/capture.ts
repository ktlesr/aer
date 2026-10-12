// Client-side capture policy: what leaves the process at all. Runs BEFORE the request is built, on
// a deep copy — the caller's objects are never mutated. The AER server redacts again on arrival
// (second pass); this layer exists so content the server should never see is not sent at all.
//
// Pattern coverage here is a deliberate subset of the server's (tokens, keys, cards, emails).
// Neither layer recognises names, free-text passwords or trade secrets — use `allowlist` /
// `metadata_only` or a `redact` hook for those.

/**
 * - `full`: send as given (server-side redaction only). Default — matches collector-js <= 0.2.
 * - `redacted_content`: mask secret-named fields and supported patterns before sending.
 * - `allowlist`: keep only the `allow` paths of input/output/metadata, then mask as above.
 * - `metadata_only`: never send input/output; keep only allowlisted metadata scalars.
 */
export type CaptureMode = "full" | "redacted_content" | "allowlist" | "metadata_only";

export interface CaptureOptions {
  mode: CaptureMode;
  /**
   * Dotted paths to keep (allowlist / metadata_only). Roots: `input`, `output`, `metadata`.
   * `*` matches any key or array index: `"output.sources.*.id"`. A path keeps its whole subtree.
   */
  allow?: string[];
  /** Extra field names to mask whole, on top of the built-ins (password, apiKey, *token, …). */
  secretFields?: string[];
  /**
   * Your own scrubber, applied last. Receives a deep copy; return the payload to send.
   * Throwing is handled by `onRedactionError`.
   */
  redact?: (payload: CapturePayload) => CapturePayload;
  /**
   * When masking or the hook throws: `drop_content` (default) still records that the step
   * happened, with title/input/output/metadata withheld; `throw` sends nothing and rejects.
   * Raw content is never sent on failure.
   */
  onRedactionError?: "drop_content" | "throw";
}

/** The content-bearing part of a run/event request. */
export interface CapturePayload {
  title?: string;
  agentName?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
}

export interface CaptureDeclaration {
  mode: CaptureMode;
  policy: string;
  status: "applied" | "failed_closed";
}

export const SECRET_TOKEN = "[REDACTED_SECRET]";
const METADATA_ONLY_MAX_STRING = 200;

// Same normalisation as the server: lowercase, non-alphanumerics stripped.
const norm = (k: string): string => k.toLowerCase().replace(/[^a-z0-9]/g, "");
const SECRET_NAMES = new Set(["pwd", "pin", "otp", "cvv", "cvc"]);
const SECRET_SUFFIXES = [
  "password", "passwd", "passphrase", "secret", "secretkey", "apikey", "accesskey", "privatekey",
  "token", "credential", "credentials", "authorization", "cookie", "sessionid",
];

function luhn(d: string): boolean {
  let sum = 0;
  for (let i = d.length - 1, dbl = false; i >= 0; i--, dbl = !dbl) {
    let n = d.charCodeAt(i) - 48;
    if (dbl && (n *= 2) > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}

const PATTERNS: Array<[RegExp, string, ((m: string) => boolean)?]> = [
  [/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_BEARER_TOKEN]"],
  [/Bearer\s+[A-Za-z0-9._~+/-]{8,}=*/g, "[REDACTED_BEARER_TOKEN]"],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9][A-Za-z0-9_-]{15,}\b/g, "[REDACTED_API_KEY]"],
  [/\b[a-z]{2,}_(?:live|test|demo)_[A-Za-z0-9]{16,}\b/g, "[REDACTED_API_KEY]"],
  [/\baer_[A-Za-z0-9]{24,}\b/g, "[REDACTED_API_KEY]"],
  [/(?<!\d\.)\b(?:\d[ -]?){13,19}\b(?!\.\d)/g, "[REDACTED_CREDIT_CARD]", (m) => {
    const d = m.replace(/\D/g, "");
    return d.length >= 13 && d.length <= 19 && luhn(d);
  }],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]"],
];

function maskString(s: string): string {
  for (const [re, token, ok] of PATTERNS) s = s.replace(re, (m) => (ok && !ok(m) ? m : token));
  return s;
}

function mask(value: unknown, isSecret: (k: string) => boolean): unknown {
  if (typeof value === "string") return maskString(value);
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return value;
    // Mirrors the server: 17–19 digit integers past 2^53 can't be checked → treated as a card.
    if (!Number.isSafeInteger(value) && Math.abs(value) < 1e19) return "[REDACTED_CREDIT_CARD]";
    const s = maskString(String(value));
    return s === String(value) ? value : s;
  }
  if (Array.isArray(value)) return value.map((v) => mask(v, isSecret));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const base = maskString(k);
      let key = base;
      for (let n = 2; Object.hasOwn(out, key); n++) key = `${base}#${n}`;
      const masked = isSecret(k) && v !== null && v !== undefined && v !== "" ? SECRET_TOKEN : mask(v, isSecret);
      Object.defineProperty(out, key, { value: masked, enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return value;
}

/** Keep only the parts of `value` (found at `path`) that some allow pattern covers. */
function pick(value: unknown, path: string[], allow: string[][]): unknown {
  const fits = (p: string[]) => path.every((s, i) => p[i] === "*" || p[i] === s);
  if (allow.some((p) => p.length === path.length && fits(p))) return value;
  if (!allow.some((p) => p.length > path.length && fits(p))) return undefined;
  if (value === null || typeof value !== "object") return undefined;
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value);
  const kept = entries
    .map(([k, v]) => [k, pick(v, [...path, k], allow)] as const)
    .filter(([, v]) => v !== undefined);
  if (kept.length === 0) return undefined;
  return Array.isArray(value) ? kept.map(([, v]) => v) : Object.fromEntries(kept);
}

export function capturePolicy(sdk: string, options: CaptureOptions): string {
  return `${sdk}:${options.mode}`;
}

/**
 * Apply the capture policy to a copy of `payload`. Returns what may be sent plus the declaration
 * the server stores as `client_declared`. Never returns raw content on failure.
 */
export function applyCapture<T extends CapturePayload>(
  payload: T,
  options: CaptureOptions,
  policy: string,
  failedTitle: string,
): { payload: T; declaration: CaptureDeclaration } {
  const extra = new Set((options.secretFields ?? []).map(norm));
  const isSecret = (k: string): boolean => {
    const n = norm(k);
    return extra.has(n) || SECRET_NAMES.has(n) || SECRET_SUFFIXES.some((s) => n.endsWith(s));
  };
  const allow = (options.allow ?? []).map((p) => p.split("."));
  try {
    let out = structuredClone(payload);
    if (options.mode === "allowlist" || options.mode === "metadata_only") {
      if (options.mode === "metadata_only") {
        delete out.input;
        delete out.output;
      } else {
        if ("input" in out) out.input = pick(out.input, ["input"], allow);
        if ("output" in out) out.output = pick(out.output, ["output"], allow);
      }
      if (out.metadata) {
        let md = pick(out.metadata, ["metadata"], allow) as Record<string, unknown> | undefined;
        if (md && options.mode === "metadata_only") {
          // Scalars only: free-form metadata must not become a back door for prompts/payloads.
          md = Object.fromEntries(
            Object.entries(md).filter(
              ([, v]) =>
                typeof v === "number" ||
                typeof v === "boolean" ||
                (typeof v === "string" && v.length <= METADATA_ONLY_MAX_STRING),
            ),
          );
        }
        out.metadata = md && Object.keys(md).length ? md : undefined;
      }
    }
    if (options.mode !== "full") out = mask(out, isSecret) as T;
    if (options.redact) out = options.redact(structuredClone(out)) as T;
    return { payload: out, declaration: { mode: options.mode, policy, status: "applied" } };
  } catch {
    // The hook's own error is not rethrown: its message could quote the content it choked on.
    if (options.onRedactionError === "throw") throw new Error("Client redaction failed; nothing was sent");
    // Fail closed: keep the fact that a step happened, drop everything that could carry content.
    const withheld = { ...payload, input: undefined, output: undefined, metadata: undefined } as T;
    if ("title" in payload) withheld.title = failedTitle;
    if ("agentName" in payload) withheld.agentName = failedTitle;
    return { payload: withheld, declaration: { mode: options.mode, policy, status: "failed_closed" } };
  }
}
