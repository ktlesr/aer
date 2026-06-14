import { resolveDashboardScope, type DashboardScope } from "./scope";

/**
 * The single authorization boundary for the dashboard — used by every page read AND by the
 * audit-packet download route. Login is deferred for the MVP (SSO/RBAC are out of scope), so this
 * currently grants access and returns the demo scope.
 *
 * When authentication lands, enforce the session HERE (throw / redirect if unauthenticated). Every
 * dashboard read and the export download are then protected at one point — satisfying
 * docs/SECURITY.md "exports are not public" without touching individual pages or routes.
 */
export function requireDashboardAccess(): DashboardScope {
  // TODO(auth): replace with a session check; throw/redirect when unauthenticated.
  return resolveDashboardScope();
}
