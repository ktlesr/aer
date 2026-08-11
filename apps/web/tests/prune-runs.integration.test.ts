import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { pruneRuns } from "../scripts/prune-runs";

const ORG = "org_prune_itest";
const PROJECT = "proj_prune";
const HELD = "run_prune_held";
const OLD = "run_prune_old";
const RECENT = "run_prune_recent";

const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);
const purge = () => prisma.organization.deleteMany({ where: { id: ORG } });

const remainingIds = async (): Promise<string[]> => {
  const runs = await prisma.agentRun.findMany({
    where: { organizationId: ORG },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return runs.map((r) => r.id);
};

beforeAll(async () => {
  await purge();
  await prisma.organization.create({
    data: { id: ORG, name: "Prune Test Org", projects: { create: { id: PROJECT, name: "P" } } },
  });
  await prisma.agentRun.createMany({
    data: [
      // Well past any cutoff, but under legal hold.
      { id: HELD, organizationId: ORG, projectId: PROJECT, agentName: "Held", startedAt: daysAgo(400), legalHold: true },
      { id: OLD, organizationId: ORG, projectId: PROJECT, agentName: "Old", startedAt: daysAgo(400) },
      { id: RECENT, organizationId: ORG, projectId: PROJECT, agentName: "Recent", startedAt: daysAgo(1) },
    ],
  });
});

afterAll(async () => {
  await purge();
  await prisma.$disconnect();
});

describe("retention — prune-runs respects legal hold", () => {
  it("reports held runs on a dry run and deletes nothing", async () => {
    const summary = await pruneRuns(prisma, { days: 30, apply: false, orgId: ORG });

    expect(summary).toEqual({ eligible: 1, held: 1, deleted: 0 });
    expect(await remainingIds()).toEqual([HELD, OLD, RECENT].sort());
  });

  it("keeps a run under legal hold even though it is past the cutoff", async () => {
    const summary = await pruneRuns(prisma, { days: 30, apply: true, orgId: ORG });

    expect(summary).toEqual({ eligible: 1, held: 1, deleted: 1 });
    // The old unheld run is gone; the held one survives alongside the recent one.
    expect(await remainingIds()).toEqual([HELD, RECENT].sort());
    expect(await prisma.agentRun.findUnique({ where: { id: HELD } })).not.toBeNull();
  });
});
