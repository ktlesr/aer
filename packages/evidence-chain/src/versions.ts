// Named, frozen algorithm versions. A version string never changes meaning: any change to what is
// hashed, or how, gets a NEW identifier and the old one keeps verifying historical records.

/** canonicalize(): sorted object keys, undefined → null, JSON.stringify for leaves (see canonicalize.ts). */
export const CANONICALIZATION = "aer-canonical/1";
/** hashEvent()/genesisHash(): sha256(prevHash + "\n" + canonical(coreView)), genesis "AER-CHAIN-v1:" + runId. */
export const CHAIN = "aer-chain/1";
/** buildManifest(): run context + per-event out-of-chain fields, frozen at seal. */
export const MANIFEST = "aer-manifest/1";
/** Receipt statement + optional Ed25519 signature over its canonical bytes. */
export const RECEIPT = "aer-receipt/1";
/** Packet content_hash for schema >= 2.0: sha256(canonical(packet without export.content_hash)). */
export const CONTENT_HASH = "aer-canonical/1+sha256";
/**
 * Packet content_hash for schema 1.x: sha256(JSON.stringify(packet)) in the writer's key order.
 * Only reproducible while that order survives (it does not through JSONB storage).
 */
export const CONTENT_HASH_LEGACY = "emission-order-json+sha256";

export const SUPPORTED_PACKET_SCHEMAS = ["1.1", "1.2", "1.3", "2.0"] as const;
