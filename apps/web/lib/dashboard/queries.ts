import { prisma } from "@/lib/prisma";
import { requireDashboardAccess } from "./access";

/** All runs for the resolved tenant, newest first. */
export async function listRuns() {
  const { organizationId, projectId } = requireDashboardAccess();
  return prisma.agentRun.findMany({
    where: { organizationId, projectId },
    orderBy: { startedAt: "desc" },
  });
}

/** One run with its events, findings, and exports — scoped to the resolved tenant. */
export async function getRunDetail(runId: string) {
  const { organizationId, projectId } = requireDashboardAccess();
  return prisma.agentRun.findFirst({
    where: { id: runId, organizationId, projectId },
    include: {
      events: { orderBy: { seq: "asc" } },
      findings: { orderBy: { createdAt: "asc" } },
      exports: { orderBy: { createdAt: "desc" } },
    },
  });
}

export type RunListItem = Awaited<ReturnType<typeof listRuns>>[number];
export type RunDetail = NonNullable<Awaited<ReturnType<typeof getRunDetail>>>;
