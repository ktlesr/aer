import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ensureWorkspace, getUserScope } from "@/lib/auth/workspace";
import type { DashboardScope } from "./scope";

/**
 * The single authorization boundary for the dashboard — used by every page read AND by the
 * audit-packet download route. Resolves the logged-in user's personal workspace (org + project).
 *
 * Unauthenticated callers are redirected to /login, so every dashboard read and the export
 * download are protected at one point (docs/SECURITY.md: exports are not public). Tenant scoping
 * comes from the session here, so a user only ever sees their own runs.
 */
export async function requireDashboardAccess(): Promise<DashboardScope> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const scope = await getUserScope(session.user.id);
  if (scope) return scope;

  // Authenticated but workspace not provisioned yet (rare) — create it lazily.
  return ensureWorkspace(session.user.id, session.user.name ?? session.user.email);
}
