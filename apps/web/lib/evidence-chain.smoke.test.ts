import { describe, expect, it } from "vitest";
import { genesisHash, verifyChain } from "@ktlsr/evidence-chain";

// Confirms the dependency-free package resolves and runs from inside apps/web.
describe("evidence-chain import", () => {
  it("resolves from apps/web", () => {
    expect(genesisHash("r")).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyChain([], genesisHash("r"), "r").ok).toBe(true);
  });
});
