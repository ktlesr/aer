import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonicalize";
import { computeChain } from "./chain";
import { genesisHash } from "./hash";
import { buildManifest, manifestHash } from "./manifest";
import { manifestInputFromPacket, packetContentHash, verifyPacket } from "./packet";
import { signReceipt, type Receipt, type ReceiptStatement } from "./receipt";
import type { EventCore } from "./types";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as Record<string, any>;
const clone = <T>(v: T): T => structuredClone(v);
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("canonicalization aer-canonical/1 — frozen bytes", () => {
  // If this vector changes, the canonicalization changed: that needs a NEW version id, not an edit.
  it("numbers, Unicode, key order and escapes produce the recorded bytes", () => {
    const v = {
      z: 1, a: [3, 2, 1], "\u0130l": "Mu\u011fla", il: "Milas", nfc: "\u00e9", nfd: "e\u0301", emoji: "\ud83e\uddfe",
      nums: [0.1 + 0.2, 1e21, 1e-7, -0, 5e-324, 9007199254740993, 0.0000246913578, -1.5],
      nested: { b: null, a: { y: true, x: false } }, undef: undefined, esc: "\"\\\n\t\u0001", lone: "\ud800",
    };
    const bytes = canonicalize(v);
    expect(sha(bytes)).toBe("bb1309c789674bd985b58050518191059be8599bf314b6c231680ca5d699dda7");
    // Documented consequences, pinned:
    expect(bytes).toContain('"nums":[0.30000000000000004,1e+21,1e-7,0,5e-324,9007199254740992,0.0000246913578,-1.5]'); // -0 → 0; > 2^53 already rounded by the runtime
    expect(bytes).toContain('"nfc":"\u00e9","nfd":"e\u0301"'); // no Unicode normalisation: NFC and NFD stay distinct bytes
    expect(bytes.indexOf('"z"')).toBeLessThan(bytes.indexOf('"\u0130l"')); // keys sorted by UTF-16 code unit
    expect(bytes).toContain('"lone":"\\ud800"'); // lone surrogate escaped (well-formed JSON.stringify)
    expect(bytes).toContain('"undef":null');
  });
});

describe("legacy packets (written by earlier releases)", () => {
  it("1.1 and 1.3 in writer order: chain and content hash verify; no manifest in that schema", () => {
    for (const name of ["packet-1.1-emission-order.json", "packet-1.3-emission-order.json"]) {
      const r = verifyPacket(fixture(name));
      expect(r.schema.status).toBe("supported");
      expect(r.chain.status).toBe("verified");
      expect(r.content_hash.status).toBe("verified");
      expect(r.manifest.status).toBe("not_in_schema");
      expect(r.overall).toBe("verified_partial");
    }
  });

  it("1.3 read back from JSONB storage: chain verifies; the emission-order content hash is reported not reproducible, not as verified", () => {
    const r = verifyPacket(fixture("packet-1.3-jsonb-stored.json"));
    expect(r.chain.status).toBe("verified");
    expect(r.content_hash.status).toBe("not_reproducible");
    expect(r.overall).toBe("verified_partial");
  });

  it("an edited legacy event breaks the chain", () => {
    const p = fixture("packet-1.3-emission-order.json");
    p.events[2].title = "edited";
    const r = verifyPacket(p);
    expect(r.chain.status).toBe("broken");
    expect(r.overall).toBe("failed");
  });
});

describe("unsupported / malformed input never verifies", () => {
  it.each([
    ["future schema", { ...fixture("packet-1.3-emission-order.json"), schema_version: "9.0" }, "unsupported"],
    ["missing schema", { ...fixture("packet-1.3-emission-order.json"), schema_version: undefined }, "unsupported"],
    ["not a packet", { hello: "world" }, "failed"],
    ["null", null, "failed"],
  ])("%s", (_n, input, overall) => {
    expect(verifyPacket(input).overall).toBe(overall);
  });
});

// A self-contained 2.0 packet in the shape apps/web emits (the integration test covers the real writer).
function packet20(opts: { sealed?: boolean } = {}) {
  const runId = "run_synth_1";
  const cores: EventCore[] = [1, 2, 3].map((seq) => ({
    seq, type: "tool_call", title: `step ${seq}`, occurredAt: `2026-10-14T10:00:0${seq}.000Z`,
    inputRedacted: null, outputRedacted: { n: seq }, riskLevel: null, costMicroUsd: null, metadata: null, findings: [],
  }));
  const links = computeChain(runId, cores);
  const seal = opts.sealed === false ? null : links[2].hash;
  const capture = { server_applied: { layer: "server", policy: "aer-redaction/3" }, client_declared: null };
  const p: Record<string, any> = {
    schema_version: "2.0",
    run: {
      id: runId, organizationId: "org_s", projectId: "proj_s", environment: null, agentName: "tesvik-asistani",
      status: seal ? "completed" : "running", riskLevel: "low", startedAt: "2026-10-14T10:00:00.000Z",
      endedAt: seal ? "2026-10-14T10:00:05.000Z" : null, durationMs: 5000, costMicroUsd: 0, eventCount: 3, redactionCount: 0,
      capture, links: { conversationRef: "c1", turnRef: "t2", parentRun: { id: "run_prev", status: "linked", agentName: "x" } },
    },
    events: links.map((l, i) => ({
      ...l, hash: `sha256:${l.hash}`, prevHash: `sha256:${l.prevHash}`, capture,
      sourced: i === 1 ? { profile: "sourced_assistant", version: 1, citedSources: [{ id: "9903", version: "v1" }], not_recorded: ["timing"] } : null,
    })),
    redaction_findings: [],
    chain: { algorithm: "sha256", genesis: `sha256:${genesisHash(runId)}` },
    versions: { canonicalization: "aer-canonical/1", chain: "aer-chain/1", manifest: "aer-manifest/1", content_hash: "aer-canonical/1+sha256" },
    seal: seal ? `sha256:${seal}` : null,
    manifest_hash: null,
    receipt: null,
    export: { type: "json", generatedAt: "2026-10-14T11:00:00.000Z" },
  };
  if (seal) p.manifest_hash = `sha256:${manifestHash(buildManifest(manifestInputFromPacket(p)))}`;
  return p;
}
function finish(p: Record<string, any>) {
  p.export.content_hash = `sha256:${packetContentHash(p).hex}`;
  return p;
}
function receiptFor(p: Record<string, any>, key?: { privateKey: string; id: string }): Receipt {
  const statement: ReceiptStatement = {
    receipt_version: "aer-receipt/1", run_id: p.run.id, organization_id: p.run.organizationId, project_id: p.run.projectId,
    manifest_version: "aer-manifest/1", manifest_hash: p.manifest_hash, chain_head: p.seal, event_count: p.events.length,
    issued_at: "2026-10-14T10:00:05.100Z", clock: "aer-server",
  };
  return key ? signReceipt(statement, key.privateKey, key.id) : { statement, signature: null };
}
const keyPair = (id: string) => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    id,
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    trusted: { key_id: id, public_key: publicKey.export({ format: "der", type: "spki" }).toString("base64") },
  };
};

describe("schema 2.0", () => {
  const aer = keyPair("aer-2026-10");

  it("an untouched sealed packet verifies; a kept receipt and a trusted key anchor it", () => {
    const p = packet20();
    p.receipt = receiptFor(p, aer);
    finish(p);
    const trustedReceipt = clone(p.receipt);
    const r = verifyPacket(p, { trustedReceipt, trustedKeys: [aer.trusted] });
    expect(r).toMatchObject({
      overall: "verified",
      chain: { status: "verified" },
      content_hash: { status: "verified" },
      manifest: { status: "verified" },
      seal: { status: "sealed" },
      signature: { status: "valid_trusted" },
      packet_receipt: { status: "matches_packet" },
      trusted_receipt: { status: "match" },
    });
    expect(r.anchored).toBe(true);
  });

  it("without a kept receipt or trusted key: internally consistent, but explicitly not anchored", () => {
    const p = packet20();
    p.receipt = receiptFor(p, aer);
    finish(p);
    const r = verifyPacket(p);
    expect(r.overall).toBe("verified");
    expect(r.signature.status).toBe("untrusted_key");
    expect(r.anchored).toBe(false);
  });

  it("content edit → chain broken; reorder → chain broken", () => {
    const edit = packet20();
    edit.events[1].outputRedacted = { n: 99 };
    expect(verifyPacket(finish(edit)).chain.status).toBe("broken");
    const swap = packet20();
    [swap.events[0].seq, swap.events[1].seq] = [swap.events[1].seq, swap.events[0].seq];
    expect(verifyPacket(finish(swap)).chain.status).toBe("broken");
  });

  it.each([
    ["agent name", (p: any) => (p.run.agentName = "someone-else")],
    ["run status", (p: any) => (p.run.status = "failed")],
    ["tenant", (p: any) => (p.run.organizationId = "org_other")],
    ["server policy label", (p: any) => (p.events[0].capture = { ...p.events[0].capture, server_applied: { layer: "server", policy: "aer-redaction/9" } })],
    ["cited source version", (p: any) => (p.events[1].sourced.citedSources[0].version = "v2")],
    ["lineage", (p: any) => (p.run.links.parentRun.id = "run_other")],
  ])("manifest catches a changed %s (content hash recomputed by the editor)", (_n, mutate) => {
    const p = packet20();
    mutate(p);
    const r = verifyPacket(finish(p));
    expect(r.chain.status).toBe("verified");
    expect(r.content_hash.status).toBe("verified");
    expect(r.manifest.status).toBe("mismatch");
    expect(r.overall).toBe("failed");
  });

  it("a derived reading aid (not_recorded) or export-time view can change without failing — and is listed as not bound", () => {
    const p = packet20();
    p.events[1].sourced.not_recorded = [];
    p.run.links.parentRun.status = "missing_context";
    const r = verifyPacket(finish(p));
    expect(r.overall).toBe("verified");
    expect(r.not_integrity_bound.join(" ")).toContain("not_recorded");
    expect(r.not_integrity_bound.join(" ")).toContain("parentRun.status");
  });

  it("a fully recomputed different packet does not match the receipt kept at seal time", () => {
    const original = packet20();
    const kept = receiptFor(original, aer);
    // The forger rewrites an event, recomputes chain, seal, manifest and content hash, drops the receipt.
    const forged = packet20();
    const cores = forged.events.map((e: any) => ({ ...e, hash: undefined, prevHash: undefined }));
    cores[1].title = "rewritten";
    const links = computeChain(forged.run.id, cores);
    forged.events = links.map((l, i) => ({ ...forged.events[i], ...l, hash: `sha256:${l.hash}`, prevHash: `sha256:${l.prevHash}` }));
    forged.seal = `sha256:${links[2].hash}`;
    forged.manifest_hash = `sha256:${manifestHash(buildManifest(manifestInputFromPacket(forged)))}`;
    finish(forged);
    expect(verifyPacket(forged).overall).toBe("verified"); // internally consistent on its own…
    const r = verifyPacket(forged, { trustedReceipt: kept, trustedKeys: [aer.trusted] });
    expect(r.trusted_receipt.status).toBe("mismatch"); // …but not the run you hold a receipt for
    expect(r.overall).toBe("failed");
  });

  it("a receipt signed by an unknown key is never trusted, even if the packet carries a matching public key", () => {
    const attacker = keyPair("aer-2026-10"); // same key_id, different key
    const p = packet20();
    p.receipt = { ...receiptFor(p, attacker), public_key: attacker.trusted.public_key };
    finish(p);
    expect(verifyPacket(p).signature.status).toBe("untrusted_key");
    expect(verifyPacket(p, { trustedKeys: [aer.trusted] }).signature.status).toBe("invalid");
    expect(verifyPacket(p, { trustedKeys: [aer.trusted] }).overall).toBe("failed");
  });

  it("an edited packet receipt no longer matches the packet", () => {
    const p = packet20();
    p.receipt = receiptFor(p);
    p.receipt.statement.manifest_hash = `sha256:${"0".repeat(64)}`;
    const r = verifyPacket(finish(p));
    expect(r.packet_receipt.status).toBe("mismatch");
    expect(r.overall).toBe("failed");
  });

  it("an edited content hash is a mismatch in 2.0 (canonical, survives key reordering)", () => {
    const p = finish(packet20());
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(reverseKeys)
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]))
        : v;
    const reordered = reverseKeys(p); // what JSONB storage does to key order
    expect(verifyPacket(reordered).content_hash.status).toBe("verified");
    p.export.content_hash = `sha256:${"1".repeat(64)}`;
    expect(verifyPacket(p).content_hash.status).toBe("mismatch");
  });

  it("an unsealed run is consistent so far — not verified", () => {
    const r = verifyPacket(finish(packet20({ sealed: false })));
    expect(r.chain.status).toBe("consistent_unsealed");
    expect(r.manifest.status).toBe("not_frozen");
    expect(r.overall).toBe("consistent_unsealed");
  });
});

describe("fixture from the real writer (apps/web, via JSONB storage)", () => {
  it("packet-2.0-signed verifies and is anchored by its kept receipt and the fixture public key", () => {
    const r = verifyPacket(fixture("packet-2.0-signed.json"), {
      trustedReceipt: fixture("packet-2.0-signed.receipt.json") as Receipt,
      trustedKeys: [fixture("fixture-key-1.public.json") as { key_id: string; public_key: string }],
    });
    expect(r).toMatchObject({ overall: "verified", anchored: true, manifest: { status: "verified" }, signature: { status: "valid_trusted" } });
  });
});

describe("review of the Stage 4 working tree: fail closed", () => {
  const real = () => fixture("packet-2.0-signed.json");
  const kept = () => fixture("packet-2.0-signed.receipt.json") as Receipt;
  const keys = () => [fixture("fixture-key-1.public.json") as { key_id: string; public_key: string }];
  const rehash = (p: Record<string, any>) => ((p.export.content_hash = `sha256:${packetContentHash(p).hex}`), p);

  it.each([
    ["an event payload", (p: any) => p.events[0].outputRedacted],
    ["run metadata-free area (sourced block)", (p: any) => p.events[1].sourced],
    ["the receipt statement", (p: any) => p.receipt.statement],
  ])("an own __proto__ key in %s → malformed, failed, not anchored", (_n, target) => {
    const p = real();
    Object.defineProperty(target(p), "__proto__", { value: { synthetic_added: true }, enumerable: true });
    const r = verifyPacket(p, { trustedReceipt: kept(), trustedKeys: keys() });
    expect(r).toMatchObject({ overall: "failed", anchored: false, schema: { status: "malformed" } });
    expect(r.schema.detail).toContain("__proto__");
  });

  it.each([
    ["chain", (p: any) => (p.versions.chain = "aer-chain/999")],
    ["canonicalization", (p: any) => (p.versions.canonicalization = "aer-canonical/2")],
    ["content hash", (p: any) => (p.versions.content_hash = "sha3")],
    ["manifest", (p: any) => (p.versions.manifest = "aer-manifest/9")],
    ["chain algorithm", (p: any) => (p.chain.algorithm = "sha1")],
    ["chain genesis", (p: any) => (p.chain.genesis = `sha256:${"0".repeat(64)}`)],
  ])("an unknown declared %s version → unsupported, not anchored", (_n, mutate) => {
    const p = real();
    mutate(p);
    const r = verifyPacket(rehash(p), { trustedReceipt: kept(), trustedKeys: keys() });
    expect(r).toMatchObject({ overall: "unsupported", anchored: false, schema: { status: "unsupported" } });
  });

  it.each([
    ["sourced: []", (p: any) => (p.events[0].sourced = [])],
    ["sourced: \"\"", (p: any) => (p.events[0].sourced = "")],
    ["capture.client_declared: []", (p: any) => (p.events[0].capture.client_declared = [])],
    ["run.environment: 0", (p: any) => (p.run.environment = 0)],
    ["run.links.parentRun: \"x\"", (p: any) => (p.run.links.parentRun = "x")],
    ["missing metadata", (p: any) => delete p.events[0].metadata],
    ["finding hash not sha256:hex", (p: any) => (p.events[0].findings = [{ findingType: "email", severity: "low", fieldPath: "x", originalHash: "abc" }])],
    ["receipt: []", (p: any) => (p.receipt = [])],
  ])("a wrong type (%s) is malformed, never normalised", (_n, mutate) => {
    const p = real();
    mutate(p);
    expect(verifyPacket(rehash(p), { trustedKeys: keys() })).toMatchObject({ overall: "failed", anchored: false, schema: { status: "malformed" } });
  });

  it.each([
    ["organization_id", "org_other"],
    ["project_id", "proj_other"],
    ["event_count", 99],
    ["chain_head", `sha256:${"0".repeat(64)}`],
    ["clock", "independent-tsa"],
    ["receipt_version", "aer-receipt/2"],
    ["manifest_version", "aer-manifest/2"],
  ])("every receipt commitment is compared: %s", (field, value) => {
    const p = real();
    p.receipt.signature = null;
    p.receipt.statement[field] = value;
    const r = verifyPacket(rehash(p));
    expect(r.packet_receipt.status).toBe("mismatch");
    expect(r.overall).toBe("failed");
    const k = kept();
    (k.statement as unknown as Record<string, unknown>)[field] = value;
    expect(verifyPacket(real(), { trustedReceipt: k }).trusted_receipt.status).toBe("mismatch");
  });
});
