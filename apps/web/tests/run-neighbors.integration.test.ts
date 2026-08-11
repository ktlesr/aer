import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getRunNeighbors, listRuns } from "@/lib/dashboard/queries";

const ORG = "org_neighbors_itest";
const PROJECT = "proj_neighbors";
const OTHER_ORG = "org_neighbors_other_itest";
const OTHER_PROJECT = "proj_neighbors_other";

const NEWEST = "run_nb_1_newest";
// Same startedAt as TIE_A — only the id can order them. Ids are chosen so that under
// (startedAt desc, id desc) TIE_B comes before TIE_A.
const TIE_B = "run_nb_2_tie_b";
const TIE_A = "run_nb_2_tie_a";
const OLDEST = "run_nb_3_oldest";
const FOREIGN = "run_nb_foreign";

const scope = { organizationId: ORG, projectId: PROJECT };
const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);
const TIE_AT = daysAgo(2);

/** The order the runs list renders: newest first, id breaking ties. */
const EXPECTED_ORDER = [NEWEST, TIE_B, TIE_A, OLDEST];

async function purge() {
  await prisma.organization.deleteMany({ where: { id: { in: [ORG, OTHER_ORG] } } });
}

beforeAll(async () => {
  await purge();
  await prisma.organization.create({
    data: { id: ORG, name: "Neighbors Org", projects: { create: { id: PROJECT, name: "P" } } },
  });
  await prisma.organization.create({
    data: {
      id: OTHER_ORG,
      name: "Other Org",
      projects: { create: { id: OTHER_PROJECT, name: "P" } },
    },
  });
  await prisma.agentRun.createMany({
    data: [
      { id: NEWEST, organizationId: ORG, projectId: PROJECT, agentName: "Newest", startedAt: daysAgo(1) },
      { id: TIE_B, organizationId: ORG, projectId: PROJECT, agentName: "Tie B", startedAt: TIE_AT },
      { id: TIE_A, organizationId: ORG, projectId: PROJECT, agentName: "Tie A", startedAt: TIE_AT },
      { id: OLDEST, organizationId: ORG, projectId: PROJECT, agentName: "Oldest", startedAt: daysAgo(3) },
      // Another tenant, timestamped right in the middle of the window above.
      {
        id: FOREIGN,
        organizationId: OTHER_ORG,
        projectId: OTHER_PROJECT,
        agentName: "Foreign",
        startedAt: TIE_AT,
      },
    ],
  });
});

afterAll(async () => {
  await purge();
  await prisma.$disconnect();
});

const neighborsOf = async (id: string) => {
  const run = await prisma.agentRun.findUniqueOrThrow({
    where: { id },
    select: { id: true, startedAt: true },
  });
  return getRunNeighbors(scope, run);
};

describe("run pager — neighbours follow the runs list", () => {
  it("matches the order the list itself renders", async () => {
    const { runs } = await listRuns(scope, 1, 50);
    expect(runs.map((r) => r.id)).toEqual(EXPECTED_ORDER);
  });

  it("walks the whole ledger forwards without skipping or repeating a run", async () => {
    const walked = [EXPECTED_ORDER[0]];
    for (;;) {
      const { older } = await neighborsOf(walked[walked.length - 1]);
      if (!older) break;
      expect(walked).not.toContain(older.id); // a cycle would hang the pager
      walked.push(older.id);
    }
    expect(walked).toEqual(EXPECTED_ORDER);
  });

  it("walks backwards to the same order reversed", async () => {
    const walked = [OLDEST];
    for (;;) {
      const { newer } = await neighborsOf(walked[walked.length - 1]);
      if (!newer) break;
      walked.push(newer.id);
    }
    expect(walked).toEqual([...EXPECTED_ORDER].reverse());
  });

  it("has no neighbour past either end of the ledger", async () => {
    expect((await neighborsOf(NEWEST)).newer).toBeNull();
    expect((await neighborsOf(OLDEST)).older).toBeNull();
  });

  it("orders runs sharing a startedAt by id instead of skipping one", async () => {
    const tieB = await neighborsOf(TIE_B);
    expect(tieB.newer?.id).toBe(NEWEST);
    expect(tieB.older?.id).toBe(TIE_A);

    const tieA = await neighborsOf(TIE_A);
    expect(tieA.newer?.id).toBe(TIE_B);
    expect(tieA.older?.id).toBe(OLDEST);
  });

  it("never points at another tenant's run", async () => {
    for (const id of EXPECTED_ORDER) {
      const { newer, older } = await neighborsOf(id);
      expect([newer?.id, older?.id]).not.toContain(FOREIGN);
    }
    // ...and asking from the other tenant's scope sees only that tenant's own ledger.
    const foreign = await prisma.agentRun.findUniqueOrThrow({
      where: { id: FOREIGN },
      select: { id: true, startedAt: true },
    });
    const fromForeignScope = await getRunNeighbors(
      { organizationId: OTHER_ORG, projectId: OTHER_PROJECT },
      foreign,
    );
    expect(fromForeignScope).toEqual({ newer: null, older: null });
  });
});
