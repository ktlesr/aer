import { describe, expect, it } from "vitest";
import { computeChain } from "./chain";
import { genesisHash } from "./hash";
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

describe("computeChain", () => {
  it("links sequentially from genesis, ordered by seq", () => {
    const links = computeChain("r", [mk(2), mk(1)]);
    expect(links.map((l) => l.seq)).toEqual([1, 2]);
    expect(links[0].prevHash).toBe(genesisHash("r"));
    expect(links[1].prevHash).toBe(links[0].hash);
  });

  it("returns an empty chain for no events", () => {
    expect(computeChain("r", [])).toEqual([]);
  });
});
