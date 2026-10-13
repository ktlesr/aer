/**
 * aer-canonical/1 rebuilds objects by assignment (`out[k] = …`). An OWN "__proto__" key — which
 * JSON.parse creates as plain data — is therefore re-routed to the prototype and silently left out
 * of the hashed bytes: anything under it is not covered by any hash. The algorithm is frozen (old
 * records were hashed that way), so such content is refused instead: at the API boundary (never
 * written) and in the verifier (a packet carrying one is malformed, never "verified").
 * Returns the JSON path of the first such key, or null.
 */
export function unrepresentableKeyPath(value: unknown, path = "$"): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const p = unrepresentableKeyPath(value[i], `${path}[${i}]`);
      if (p) return p;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "__proto__")) return `${path}.__proto__`;
    for (const k of Object.keys(value)) {
      const p = unrepresentableKeyPath((value as Record<string, unknown>)[k], `${path}.${k}`);
      if (p) return p;
    }
  }
  return null;
}
