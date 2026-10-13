"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { requireDashboardAccess } from "@/lib/dashboard/access";
import { ApiError } from "@/lib/api/errors";
import { decideApproval, revokeApproval } from "./service";

// The ONLY path to a verified decision: a signed-in user, scoped to their own workspace by the
// session (requireDashboardAccess). Nothing here accepts an API key, a user id or a tenant from
// the form — only the approval id; a foreign or unknown id is "not found".

async function decide(formData: FormData, kind: "approve" | "reject" | "revoke"): Promise<void> {
  const scope = await requireDashboardAccess(); // redirects to /login when signed out
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return;
  const id = String(formData.get("approvalId") ?? "");
  try {
    const decided =
      kind === "revoke" ? await revokeApproval(scope, userId, id) : await decideApproval(scope, userId, id, kind);
    revalidatePath(`/runs/${decided.runId}`);
  } catch (err) {
    // Stale page (already decided/expired/run sealed): the refreshed page shows the real state.
    if (!(err instanceof ApiError)) throw err;
    revalidatePath("/runs");
  }
}

export async function approveApprovalAction(formData: FormData): Promise<void> {
  await decide(formData, "approve");
}

export async function rejectApprovalAction(formData: FormData): Promise<void> {
  await decide(formData, "reject");
}

export async function revokeApprovalAction(formData: FormData): Promise<void> {
  await decide(formData, "revoke");
}
