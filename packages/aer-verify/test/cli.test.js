// Runs the BUILT CLI (dist/) under plain Node — the same artifact npm would ship.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync, writeFileSync, mkdtempSync, readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { createHash, generateKeyPairSync } = require("node:crypto");

const CLI = join(__dirname, "..", "dist", "aer-verify", "src", "cli.js");
const FX = join(__dirname, "..", "..", "evidence-chain", "fixtures");
const fx = (n) => join(FX, n);
const tmp = mkdtempSync(join(tmpdir(), "aer-verify-"));
const write = (name, value) => {
  const p = join(tmp, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
};
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
const PACKET = JSON.parse(readFileSync(fx("packet-2.0-signed.json"), "utf8"));
const RECEIPT = fx("packet-2.0-signed.receipt.json");
const KEY = fx("fixture-key-1.public.json");

test("2.0 packet + kept receipt + trusted key → verified, anchored, exit 0", () => {
  const r = run(fx("packet-2.0-signed.json"), "--receipt", RECEIPT, "--trusted-key", KEY, "--json");
  assert.equal(r.status, 0);
  const report = JSON.parse(r.stdout);
  assert.equal(report.overall, "verified");
  assert.equal(report.anchored, true);
  assert.equal(report.signature.status, "valid_trusted");
});

test("no receipt / key → still internally verified, but says it is not anchored; --require-anchor fails it", () => {
  const r = run(fx("packet-2.0-signed.json"));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Anchored: NO/);
  assert.match(r.stdout, /Receipt signature\s+untrusted_key/);
  assert.equal(run(fx("packet-2.0-signed.json"), "--require-anchor").status, 1);
});

test("edits: event content → chain; agent name → manifest; each exits 1", () => {
  const edited = structuredClone(PACKET);
  edited.events[0].title = "edited";
  let r = JSON.parse(run(write("e1.json", edited), "--json").stdout);
  assert.equal(r.chain.status, "broken");
  assert.equal(r.overall, "failed");

  const renamed = structuredClone(PACKET);
  renamed.run.agentName = "someone-else";
  const out = run(write("e2.json", renamed), "--receipt", RECEIPT, "--json");
  assert.equal(out.status, 1);
  r = JSON.parse(out.stdout);
  assert.equal(r.manifest.status, "mismatch");
  assert.equal(r.trusted_receipt.status, "mismatch");
});

test("a key the verifier did not supply is never trusted; a wrong trusted key makes the signature invalid", () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const other = write("other-key.json", { key_id: "fixture-key-1", public_key: publicKey.export({ format: "der", type: "spki" }).toString("base64") });
  const r = run(fx("packet-2.0-signed.json"), "--trusted-key", other, "--json");
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).signature.status, "invalid");
});

test("legacy 1.1 / 1.3 packets verify their chain with limits (exit 2); unsupported → 4; unreadable → 4", () => {
  for (const n of ["packet-1.1-emission-order.json", "packet-1.3-emission-order.json", "packet-1.3-jsonb-stored.json"]) {
    const r = run(fx(n), "--json");
    assert.equal(r.status, 2, n);
    assert.equal(JSON.parse(r.stdout).chain.status, "verified", n);
  }
  assert.equal(run(write("future.json", { ...PACKET, schema_version: "3.0" })).status, 4);
  const bad = join(tmp, "bad.json");
  writeFileSync(bad, "{ not json: synthetic-secret-value");
  const r = run(bad);
  assert.equal(r.status, 4);
  assert.ok(!r.stderr.includes("synthetic-secret-value"), "input must not be echoed");
});

test("offline by construction: the shipped code requires no network module and calls no fetch", () => {
  const files = [];
  const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
  walk(join(__dirname, "..", "dist"));
  for (const f of files.filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/require\("(node:)?(http|https|net|tls|dns|http2|dgram)"\)/.test(src), f);
    assert.ok(!/\bfetch\s*\(/.test(src), f);
  }
});

test("same canonical bytes under plain Node as under the test runner (frozen vector)", () => {
  const { canonicalize } = require("../dist/evidence-chain/src/canonicalize.js");
  const v = {
    z: 1, a: [3, 2, 1], "\u0130l": "Mu\u011fla", il: "Milas", nfc: "\u00e9", nfd: "e\u0301", emoji: "\ud83e\uddfe",
    nums: [0.1 + 0.2, 1e21, 1e-7, -0, 5e-324, 9007199254740993, 0.0000246913578, -1.5],
    nested: { b: null, a: { y: true, x: false } }, undef: undefined, esc: "\"\\\n\t\u0001", lone: "\ud800",
  };
  const hex = createHash("sha256").update(canonicalize(v), "utf8").digest("hex");
  assert.equal(hex, "bb1309c789674bd985b58050518191059be8599bf314b6c231680ca5d699dda7");
});
