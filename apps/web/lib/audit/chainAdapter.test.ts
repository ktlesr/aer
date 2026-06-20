import { describe, expect, it } from "vitest";
import { computeChain, verifyChain } from "@ktlsr/evidence-chain";
import { toChainLink, toEventCore } from "./chainAdapter";
import type { AgentEvent, RedactionFinding } from "@/app/generated/prisma/client";

const event = (id: string, seq: number, extra: Partial<AgentEvent> = {}): AgentEvent =>
  ({
    id,
    organizationId: "o",
    projectId: "p",
    runId: "run_x",
    seq,
    type: "user_input",
    title: `e${seq}`,
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    inputRedacted: null,
    outputRedacted: null,
    riskLevel: null,
    costMicroUsd: null,
    metadata: null,
    hash: null,
    prevHash: null,
    ...extra,
  }) as unknown as AgentEvent;

const finding = (eventId: string): RedactionFinding =>
  ({
    id: `f_${eventId}`,
    organizationId: "o",
    projectId: "p",
    runId: "run_x",
    eventId,
    findingType: "email",
    severity: "medium",
    fieldPath: "input.email",
    originalHash: "a".repeat(64),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  }) as unknown as RedactionFinding;

describe("chainAdapter", () => {
  it("attaches only the event's own findings to its core", () => {
    const core = toEventCore(event("e1", 1), [finding("e1"), finding("e2")]);
    expect(core.findings).toHaveLength(1);
    expect(core.findings[0].fieldPath).toBe("input.email");
  });

  it("round-trips through computeChain → toChainLink → verifyChain", () => {
    // Compute the canonical chain for two events, then stamp the rows as the write-path would.
    const e1 = event("e1", 1);
    const e2 = event("e2", 2);
    const cores = [toEventCore(e1, []), toEventCore(e2, [])];
    const links = computeChain("run_x", cores);
    const rows = [
      event("e1", 1, { hash: links[0].hash, prevHash: links[0].prevHash }),
      event("e2", 2, { hash: links[1].hash, prevHash: links[1].prevHash }),
    ];
    const rebuilt = rows.map((r) => toChainLink(r, []));
    expect(verifyChain(rebuilt, links[1].hash, "run_x")).toEqual({
      ok: true,
      status: "verified",
      checkedCount: 2,
    });
  });
});
