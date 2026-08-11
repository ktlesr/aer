import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { DashboardScope } from "./scope";

export const RUNS_PAGE_SIZE = 10;
export const RUNS_PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * The ledger's canonical order: newest first, `id` breaking ties. Runs recorded in the same
 * millisecond are common (seeded and scripted runs), and without the tie-breaker their relative
 * order is undefined — which would let pagination repeat or skip a row, and would make the
 * detail-page pager disagree with the list. Every read that walks the ledger uses this order.
 */
const RUNS_ORDER: Prisma.AgentRunOrderByWithRelationInput[] = [
  { startedAt: "desc" },
  { id: "desc" },
];

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
      orderBy: RUNS_ORDER,
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

/**
 * One run with its events, findings, and exports — scoped to the tenant the caller resolved.
 * Like every other read here, the scope is a required argument: callers pass the result of
 * requireDashboardAccess(), so a run can never be loaded without a resolved tenant.
 */
export async function getRunDetail(scope: DashboardScope, runId: string) {
  return prisma.agentRun.findFirst({
    where: { id: runId, organizationId: scope.organizationId, projectId: scope.projectId },
    include: {
      events: { orderBy: { seq: "asc" } },
      findings: { orderBy: { createdAt: "asc" } },
      exports: { orderBy: { createdAt: "desc" } },
    },
  });
}

export interface RunNeighbor {
  id: string;
  agentName: string;
}

/**
 * The runs sitting immediately above and below this one in the ledger order, so the detail page
 * can walk the list without returning to it. `newer` is the previous row (towards the top of the
 * list), `older` is the next one; either is null at the ends. Same tenant filter and same
 * (startedAt, id) total order as listRuns() — so the pager can never skip or repeat a run.
 */
export async function getRunNeighbors(
  scope: DashboardScope,
  run: { id: string; startedAt: Date },
): Promise<{ newer: RunNeighbor | null; older: RunNeighbor | null }> {
  const tenant = { organizationId: scope.organizationId, projectId: scope.projectId };
  const select = { id: true, agentName: true };

  const [newer, older] = await Promise.all([
    prisma.agentRun.findFirst({
      where: {
        ...tenant,
        OR: [{ startedAt: { gt: run.startedAt } }, { startedAt: run.startedAt, id: { gt: run.id } }],
      },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }], // nearest one above, i.e. the list order reversed
      select,
    }),
    prisma.agentRun.findFirst({
      where: {
        ...tenant,
        OR: [{ startedAt: { lt: run.startedAt } }, { startedAt: run.startedAt, id: { lt: run.id } }],
      },
      orderBy: RUNS_ORDER,
      select,
    }),
  ]);

  return { newer, older };
}

export type RunListItem = Awaited<ReturnType<typeof listRuns>>["runs"][number];
export type RunDetail = NonNullable<Awaited<ReturnType<typeof getRunDetail>>>;
