export interface DashboardScope {
  organizationId: string;
  projectId: string;
}

/**
 * Single source of truth for which tenant the dashboard reads.
 *
 * Dashboard login is deferred for the MVP (SSO/RBAC are out of scope). Every dashboard query goes
 * through this one seam, so when authentication lands it only changes here — read the org/project
 * from the session instead of the env — without touching any page or query.
 */
export function resolveDashboardScope(): DashboardScope {
  return {
    organizationId: process.env.AER_DASHBOARD_ORG ?? "org_demo",
    projectId: process.env.AER_DASHBOARD_PROJECT ?? "proj_demo",
  };
}
