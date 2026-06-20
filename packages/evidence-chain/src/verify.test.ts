import { describe, expect, it } from "vitest";
import { computeChain } from "./chain";
import { genesisHash } from "./hash";
import { verifyChain } from "./verify";
import type { EventCore } from "./types";

const mk = (seq: number): EventCore => ({
  seq,
  type: "model_call",
  title: `e${seq}`,
  occurredAt: "2026-01-01T00:00:00.000Z",
  inputRedacted: null,
  outputRedacted: null,
  riskLevel: null,
  costMicroUsd: null,
  metadata: null,
  findings: [],
});

const build = (runId: string, n: number) => {
  const links = computeChain(
    runId,
    Array.from({ length: n }, (_, i) => mk(i + 1)),
  );
  const seal = links.length ? links[links.length - 1].hash : genesisHash(runId);
  return { links, seal };
};

describe("verifyChain", () => {
  it("passes a clean chain", () => {
    const { links, seal } = build("r", 3);
    expect(verifyChain(links, seal, "r")).toEqual({
      ok: true,
      status: "verified",
      checkedCount: 3,
    });
  });

  it("breaks at the tampered seq", () => {
    const { links, seal } = build("r", 3);
    links[1] = { ...links[1], title: "tampered" };
    const res = verifyChain(links, seal, "r");
    expect(res.ok).toBe(false);
    if (!res.ok && res.status === "broken") expect(res.brokenSeq).toBe(2);
  });

  it("detects deletion", () => {
    const { links, seal } = build("r", 3);
    expect(verifyChain([links[0], links[2]], seal, "r").ok).toBe(false);
  });

  it("detects reorder (swapped seq numbers)", () => {
    // seq is part of the hashed core, so renumbering two events breaks their stored hashes.
    const { links, seal } = build("r", 3);
    const swapped = [...links];
    swapped[0] = { ...links[0], seq: 2 };
    swapped[1] = { ...links[1], seq: 1 };
    expect(verifyChain(swapped, seal, "r").ok).toBe(false);
  });

  it("detects seal mismatch", () => {
    const { links } = build("r", 3);
    expect(verifyChain(links, "deadbeef", "r").ok).toBe(false);
  });

  it("detects wrong runId (genesis)", () => {
    const { links, seal } = build("r", 3);
    expect(verifyChain(links, seal, "other").ok).toBe(false);
  });

  it("reports legacy when no hashes are present", () => {
    const legacy = [{ ...mk(1), hash: "", prevHash: "" }];
    const res = verifyChain(legacy, null, "r");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe("legacy");
  });

  it("verifies a running run (seal null)", () => {
    const { links } = build("r", 2);
    expect(verifyChain(links, null, "r").ok).toBe(true);
  });

  it("seals an empty run to genesis", () => {
    const { links, seal } = build("r", 0);
    expect(verifyChain(links, seal, "r").ok).toBe(true);
  });
});
