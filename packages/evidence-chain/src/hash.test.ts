import { describe, expect, it } from "vitest";
import { genesisHash, hashEvent } from "./hash";
import type { EventCore } from "./types";

const core: EventCore = {
  seq: 1,
  type: "user_input",
  title: "t",
  occurredAt: "2026-01-01T00:00:00.000Z",
  inputRedacted: { a: 1 },
  outputRedacted: null,
  riskLevel: "low",
  costMicroUsd: null,
  metadata: null,
  findings: [],
};

describe("hash", () => {
  it("genesis binds to runId", () => {
    expect(genesisHash("r1")).not.toBe(genesisHash("r2"));
    expect(genesisHash("r1")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a core field changes", () => {
    expect(hashEvent("p", core)).not.toBe(hashEvent("p", { ...core, title: "x" }));
  });

  it("changes when prevHash changes", () => {
    expect(hashEvent("p1", core)).not.toBe(hashEvent("p2", core));
  });

  it("is independent of finding order", () => {
    const f1 = { findingType: "email", severity: "low", fieldPath: "a", originalHash: "1" };
    const f2 = { findingType: "phone", severity: "low", fieldPath: "b", originalHash: "2" };
    expect(hashEvent("p", { ...core, findings: [f1, f2] })).toBe(
      hashEvent("p", { ...core, findings: [f2, f1] }),
    );
  });

  it("changes when a finding changes", () => {
    const f = { findingType: "email", severity: "low", fieldPath: "a", originalHash: "1" };
    expect(hashEvent("p", { ...core, findings: [f] })).not.toBe(
      hashEvent("p", { ...core, findings: [{ ...f, originalHash: "2" }] }),
    );
  });
});
