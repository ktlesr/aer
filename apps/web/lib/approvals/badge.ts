// Timeline label for approval events. AER wrote the event only if it carries the server-only
// metadata key AND names an Approval of this run (a client could have written the key before it was
// reserved, but can never create an Approval row). Within AER-written events the label says WHO
// acted: a request and a use are the agent's steps that AER recorded/checked; only a granted or
// rejected event with a deciding user is a signed-in user's decision.
export type ApprovalBadge = "request" | "decision" | "use" | "reported";

const APPROVAL_TYPES = new Set([
  "human_approval_requested",
  "human_approval_granted",
  "human_approval_rejected",
  "human_approval_used",
]);

export function approvalBadge(type: string, metadata: unknown, approvalIds: Set<string>): ApprovalBadge | undefined {
  if (!APPROVAL_TYPES.has(type)) return undefined;
  const raw = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).aer_approval : undefined;
  const m = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
  if (!m || typeof m.id !== "string" || !approvalIds.has(m.id) || m.recorded_by !== "aer-server") return "reported";
  if (type === "human_approval_requested" && m.state === "requested") return "request";
  if (type === "human_approval_used" && m.state === "used") return "use";
  const decided = typeof m.decided_by_user_id === "string" && m.decided_by_user_id.length > 0;
  if (type === "human_approval_granted" && m.state === "approved" && decided) return "decision";
  if (type === "human_approval_rejected" && (m.state === "rejected" || m.state === "revoked") && decided) return "decision";
  return "reported";
}
