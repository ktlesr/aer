import { prisma } from "@/lib/prisma";
import { requireDashboardAccess } from "./access";
import type { DashboardScope } from "./scope";

export const RUNS_PAGE_SIZE = 25;

/** One page of runs for a tenant, newest first, plus the total for pagination. */
export async function listRuns(
  scope: DashboardScope,
  page = 1,
  pageSize = RUNS_PAGE_SIZE,
) {
  const safePage = Math.max(1, page);
  const [runs, total] = await Promise.all([
    prisma.agentRun.findMany({
      where: { organizationId: scope.organizationId, projectId: scope.projectId },
      orderBy: { startedAt: "desc" },
      take: pageSize,
      skip: (safePage - 1) * pageSize,
    }),
    prisma.agentRun.count({
      where: { organizationId: scope.organizationId, projectId: scope.projectId },
    }),
  ]);
  return {
    runs,
    total,
    page: safePage,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Workspace-wide run aggregates (accurate regardless of the current page). */
export async function getRunStats(scope: DashboardScope) {
  const where = { organizationId: scope.organizationId, projectId: scope.projectId };
  const [total, withRedactions, agg] = await Promise.all([
    prisma.agentRun.count({ where }),
    prisma.agentRun.count({ where: { ...where, redactionCount: { gt: 0 } } }),
    prisma.agentRun.aggregate({ where, _sum: { redactionCount: true } }),
  ]);
  return { total, withRedactions, totalRedactions: agg._sum.redactionCount ?? 0 };
}

/** One run with its events, findings, and exports — scoped to the resolved tenant. */
export async function getRunDetail(runId: string) {
  const { organizationId, projectId } = await requireDashboardAccess();
  return prisma.agentRun.findFirst({
    where: { id: runId, organizationId, projectId },
    include: {
      events: { orderBy: { seq: "asc" } },
      findings: { orderBy: { createdAt: "asc" } },
      exports: { orderBy: { createdAt: "desc" } },
    },
  });
}

export type RunListItem = Awaited<ReturnType<typeof listRuns>>["runs"][number];
export type RunDetail = NonNullable<Awaited<ReturnType<typeof getRunDetail>>>;
