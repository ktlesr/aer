import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { ensureWorkspace, getUserScope } from "@/lib/auth/workspace";
import { isOperator } from "@/lib/ops/operator";
import type { DashboardScope } from "./scope";

/**
 * The authorization boundary for operator pages (cross-workspace data). Everyone who isn't an
 * operator — logged out included — gets a 404, not a login redirect: the page's existence is not
 * disclosed (same rule as the API's cross-tenant 404s). It is deliberately absent from robots.txt
 * too, since that file is public.
 */
export async function requireOperator(): Promise<void> {
  const session = await auth();
  if (!isOperator(session?.user?.id)) notFound();
}

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
