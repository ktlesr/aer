// Deterministic serialization. The writer and every verifier MUST produce identical bytes for the
// same logical value, regardless of object key order. Leaves are int | string | boolean | null
// (this domain has no floats; costMicroUsd is integer micro-USD). undefined is normalized to null.

function sortValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map(sortValue);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
