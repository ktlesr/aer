import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { canonicalize } from "./canonicalize";
import { RECEIPT } from "./versions";

/**
 * What the server states when it seals a run. Commits to the manifest hash (which commits to the
 * chain head, run context and versions). `issued_at` is the AER server's own clock — not an
 * independent timestamp.
 */
export interface ReceiptStatement {
  receipt_version: typeof RECEIPT;
  run_id: string;
  organization_id: string;
  project_id: string;
  manifest_version: string;
  manifest_hash: string; // sha256:<hex>
  chain_head: string; // sha256:<hex>
  event_count: number;
  issued_at: string;
  clock: "aer-server";
}

export interface ReceiptSignature {
  alg: "Ed25519";
  key_id: string;
  /** base64 Ed25519 signature over the statement's canonical UTF-8 bytes. */
  value: string;
}

export interface Receipt {
  statement: ReceiptStatement;
  signature: ReceiptSignature | null;
}

/** A public key the VERIFIER chose to trust — supplied out of band, never read from the packet. */
export interface TrustedKey {
  key_id: string;
  /** base64 SPKI DER (or a PEM string). */
  public_key: string;
}

function toPublicKey(material: string): KeyObject {
  return material.includes("BEGIN")
    ? createPublicKey(material)
    : createPublicKey({ key: Buffer.from(material, "base64"), format: "der", type: "spki" });
}

function toPrivateKey(material: string): KeyObject {
  return material.includes("BEGIN")
    ? createPrivateKey(material)
    : createPrivateKey({ key: Buffer.from(material, "base64"), format: "der", type: "pkcs8" });
}

const statementBytes = (s: ReceiptStatement): Buffer => Buffer.from(canonicalize(s), "utf8");

/** Sign with an Ed25519 private key (base64 PKCS8 DER or PEM). The key never leaves this call. */
export function signReceipt(statement: ReceiptStatement, privateKey: string, keyId: string): Receipt {
  const value = sign(null, statementBytes(statement), toPrivateKey(privateKey)).toString("base64");
  return { statement, signature: { alg: "Ed25519", key_id: keyId, value } };
}

/** base64 SPKI DER public key for a private key — what the server publishes for verifiers. */
export function publicKeyOf(privateKey: string): string {
  return createPublicKey(toPrivateKey(privateKey)).export({ format: "der", type: "spki" }).toString("base64");
}

export type SignatureCheck =
  | { status: "not_present" }
  | { status: "valid_trusted"; key_id: string }
  /** No trusted key with this key_id was supplied: the signature is NOT evaluated as trust. */
  | { status: "untrusted_key"; key_id: string }
  | { status: "invalid"; key_id: string; reason: string };

/** Check a receipt's signature against keys the caller trusts. A key carried in the packet is never used. */
export function checkReceiptSignature(receipt: Receipt, trusted: TrustedKey[]): SignatureCheck {
  const sig = receipt.signature;
  if (!sig) return { status: "not_present" };
  if (sig.alg !== "Ed25519") return { status: "invalid", key_id: sig.key_id, reason: `unsupported alg ${sig.alg}` };
  const key = trusted.find((k) => k.key_id === sig.key_id);
  if (!key) return { status: "untrusted_key", key_id: sig.key_id };
  try {
    const ok = verify(null, statementBytes(receipt.statement), toPublicKey(key.public_key), Buffer.from(sig.value, "base64"));
    return ok ? { status: "valid_trusted", key_id: sig.key_id } : { status: "invalid", key_id: sig.key_id, reason: "signature does not match" };
  } catch {
    return { status: "invalid", key_id: sig.key_id, reason: "unreadable key or signature" };
  }
}
