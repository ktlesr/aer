import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The panel's buttons post to server actions; the actions themselves are tested via the service.
vi.mock("@/lib/approvals/actions", () => ({
  approveApprovalAction: async () => undefined,
  rejectApprovalAction: async () => undefined,
  revokeApprovalAction: async () => undefined,
}));

const base = {
  organizationId: "o", projectId: "p", runId: "r", action: "refund", paramsRedacted: { orderId: "ord-1" },
  actionHash: "b".repeat(64), paramsHash: "a".repeat(64), paramsSalt: "s", maxUses: 1, uses: 0, requestedAt: new Date(), lastUsedAt: null, outcome: null,
};
const future = new Date(Date.now() + 600_000);

describe("ApprovalsPanel", () => {
  it("separates a verified decision from the application's claimed outcome, and offers actions only while open", async () => {
    const { ApprovalsPanel } = await import("./approvals-panel");
    const html = renderToStaticMarkup(
      <ApprovalsPanel
        runOpen
        deciders={{ u1: "owner@example.invalid" }}
        approvals={[
          { ...base, id: "a1", status: "pending", expiresAt: future, decidedAt: null, decidedByUserId: null },
          { ...base, id: "a2", status: "approved", uses: 1, expiresAt: future, decidedAt: new Date(), decidedByUserId: "u1",
            outcome: { status: "succeeded", external_ref: "psp-1", source: "application" } },
        ]}
      />,
    );
    expect(html).toContain("Waiting for a decision");
    expect(html).toContain(">Approve<");
    expect(html).toContain("Verified by AER: approved by owner@example.invalid");
    expect(html).toContain("Outcome reported by the application (not verified): succeeded");
    expect(html).toContain("does not stop the action itself");
    const closed = renderToStaticMarkup(
      <ApprovalsPanel runOpen={false} deciders={{}} approvals={[{ ...base, id: "a3", status: "pending", expiresAt: future, decidedAt: null, decidedByUserId: null }]} />,
    );
    expect(closed).not.toContain(">Approve<");
  });
});
