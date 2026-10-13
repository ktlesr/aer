import type { Approval } from "@/app/generated/prisma/client";
import { effectiveStatus, type EffectiveStatus } from "@/lib/approvals/service";
import { approveApprovalAction, rejectApprovalAction, revokeApprovalAction } from "@/lib/approvals/actions";
import { formatDateTime } from "@/lib/format";

// Verified approvals for one run. Decisions here come from the signed-in user (server actions,
// session-scoped) — the only way an approval becomes "approved". What the application later says
// happened is shown as its claim, not as something AER checked.

const STATUS_LABEL: Record<EffectiveStatus, string> = {
  pending: "Waiting for a decision",
  approved: "Approved",
  rejected: "Rejected",
  revoked: "Revoked",
  expired: "Expired",
  used_up: "Used",
};

function Button({ action, id, label, tone }: { action: (f: FormData) => Promise<void>; id: string; label: string; tone: "primary" | "plain" }) {
  return (
    <form action={action}>
      <input type="hidden" name="approvalId" value={id} />
      <button
        type="submit"
        className={
          tone === "primary"
            ? "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground outline-none hover:opacity-95 focus-visible:ring-3 focus-visible:ring-ring/50"
            : "rounded-md border border-border px-3 py-1.5 text-xs font-medium outline-none hover:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50"
        }
      >
        {label}
      </button>
    </form>
  );
}

export function ApprovalsPanel({
  approvals,
  deciders,
  runOpen,
}: {
  approvals: Approval[];
  /** userId → display label (email) for decided approvals in this workspace. */
  deciders: Record<string, string>;
  runOpen: boolean;
}) {
  if (approvals.length === 0) return null;
  return (
    <ul className="surface overflow-hidden">
      {approvals.map((a) => {
        const state = effectiveStatus(a);
        const outcome = a.outcome as { status?: string; external_ref?: string | null } | null;
        return (
          <li key={a.id} className="border-b border-border/60 px-3.5 py-3 last:border-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">{a.action}</span>
              <span className="eyebrow shrink-0">{STATUS_LABEL[state]}</span>
            </div>
            <div className="mt-1 font-mono text-[0.66rem] text-muted-foreground">
              params sha256:{a.paramsHash.slice(0, 12)}… · uses {a.uses}/{a.maxUses} · expires {formatDateTime(a.expiresAt)}
            </div>
            {a.paramsRedacted ? (
              <pre className="mt-1.5 max-h-32 overflow-auto rounded border border-border/60 bg-muted/40 p-2 font-mono text-[0.66rem] whitespace-pre-wrap break-words">
                {JSON.stringify(a.paramsRedacted, null, 2)}
              </pre>
            ) : null}
            {a.decidedAt && a.decidedByUserId ? (
              <div className="mt-1.5 text-xs" style={{ color: "var(--seal)" }}>
                Verified by AER: {a.status} by {deciders[a.decidedByUserId] ?? "a workspace user"} at {formatDateTime(a.decidedAt)}
              </div>
            ) : null}
            {outcome ? (
              <div className="mt-1 text-xs text-amber-500">
                Outcome reported by the application (not verified): {outcome.status}
                {outcome.external_ref ? ` · ref ${outcome.external_ref}` : ""}
              </div>
            ) : null}
            {runOpen && (state === "pending" || state === "approved") ? (
              <div className="mt-2.5 flex gap-2">
                {state === "pending" ? (
                  <>
                    <Button action={approveApprovalAction} id={a.id} label="Approve" tone="primary" />
                    <Button action={rejectApprovalAction} id={a.id} label="Reject" tone="plain" />
                  </>
                ) : (
                  <Button action={revokeApprovalAction} id={a.id} label="Revoke" tone="plain" />
                )}
              </div>
            ) : null}
          </li>
        );
      })}
      <li className="px-3.5 py-2.5 text-xs text-muted-foreground">
        AER records and checks approvals; it does not stop the action itself. The application must
        call consume and stop when it is refused.
      </li>
    </ul>
  );
}
