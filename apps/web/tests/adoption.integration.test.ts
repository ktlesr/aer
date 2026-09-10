import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { loadAdoptionReport } from "@/lib/ops/adoption";

// Test files run in parallel against one database, and other files create their own workspaces
// and keys at the same time — so global totals (signups, keys, events) can't be asserted here
// without races. Every assertion below is on something only these fixtures can produce: their
// own project rows, a unique internal email, unique SDK/environment labels. The funnel and
// retention arithmetic is covered by the pure-function tests in adoption.test.ts.
const P = "adopt_itest_";
const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
const INTERNAL = `${P}me@internal.test`;

async function cleanup() {
  await prisma.organization.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

async function workspace(name: string, ownerEmail: string | null) {
  if (ownerEmail) await prisma.user.create({ data: { id: `${P}u_${name}`, email: ownerEmail } });
  await prisma.organization.create({
    data: {
      id: `${P}o_${name}`,
      name,
      ownerUserId: ownerEmail ? `${P}u_${name}` : null,
      projects: { create: { id: `${P}p_${name}`, name: "Default Project" } },
    },
  });
  return { organizationId: `${P}o_${name}`, projectId: `${P}p_${name}` };
}

async function run(
  scope: { organizationId: string; projectId: string },
  id: string,
  opts: { sdk?: [string, string]; environment?: string; eventsAt: Date[] },
) {
  await prisma.agentRun.create({
    data: {
      ...scope,
      id: `${P}r_${id}`,
      agentName: "a",
      startedAt: opts.eventsAt[0],
      sdkName: opts.sdk?.[0],
      sdkVersion: opts.sdk?.[1],
      environment: opts.environment,
    },
  });
  await prisma.agentEvent.createMany({
    data: opts.eventsAt.map((occurredAt, i) => ({
      ...scope,
      runId: `${P}r_${id}`,
      seq: i + 1,
      type: "run_started" as const,
      title: "t",
      occurredAt,
    })),
  });
}

const load = () => loadAdoptionReport(prisma, { now, internalEmails: new Set([INTERNAL]) });
const count = (rows: [string, number][], label: string) => rows.find(([l]) => l === label)?.[1];

beforeAll(async () => {
  await cleanup();

  // A customer with two runs in two environments, first event 40 days ago, still sending.
  const real = await workspace("real", `${P}real@customer.test`);
  await run(real, "real1", {
    sdk: ["adopt-itest-sdk", "0.2.0"],
    environment: "adopt-itest-prod",
    eventsAt: [ago(40)],
  });
  await run(real, "real2", {
    sdk: ["adopt-itest-sdk", "0.2.0"],
    environment: "adopt-itest-staging",
    eventsAt: [ago(0), ago(0)],
  });

  // A second customer, one run two days ago.
  const other = await workspace("other", `${P}other@customer.test`);
  await run(other, "other", { eventsAt: [ago(2)] });

  // Signed up, never sent anything — must not appear among sending projects.
  await workspace("idle", `${P}idle@customer.test`);

  // Must be excluded everywhere: the operator's own account and an ownerless seed workspace.
  const me = await workspace("me", INTERNAL);
  await run(me, "me", {
    sdk: ["adopt-itest-me-sdk", "1.0.0"],
    environment: "adopt-itest-me-env",
    eventsAt: [ago(1)],
  });
  const seed = await workspace("seed", null);
  await run(seed, "seed", { environment: "adopt-itest-seed-env", eventsAt: [ago(1)] });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("loadAdoptionReport (database)", () => {
  it("excludes workspaces owned by an internal email", async () => {
    const r = await load();
    expect(r.excluded.internal).toBe(1); // INTERNAL is unique to this file
    expect(r.projects.some((p) => p.owner === INTERNAL)).toBe(false);
  });

  it("excludes ownerless (seed/demo) workspaces", async () => {
    const r = await load();
    expect(r.excluded.ownerless).toBeGreaterThanOrEqual(1);
    expect(r.projects.some((p) => p.workspace === "seed")).toBe(false);
  });

  it("lists only projects that sent events, with per-project totals, most recent first", async () => {
    const mine = (await load()).projects.filter((p) => p.owner.startsWith(P));
    expect(mine.map((p) => [p.owner, p.runs, p.events])).toEqual([
      [`${P}real@customer.test`, 2, 3],
      [`${P}other@customer.test`, 1, 1],
    ]);
    expect(mine[0].firstEventAt.getTime()).toBe(ago(40).getTime());
    expect(mine[0].lastEventAt.getTime()).toBe(ago(0).getTime());
  });

  it("breaks down SDK versions and environments by distinct project, excluded ones left out", async () => {
    const r = await load();
    expect(count(r.sdk, "adopt-itest-sdk 0.2.0")).toBe(1); // two runs, one project
    expect(count(r.sdk, "adopt-itest-me-sdk 1.0.0")).toBeUndefined();
    expect(count(r.environments, "adopt-itest-prod")).toBe(1);
    expect(count(r.environments, "adopt-itest-staging")).toBe(1);
    expect(count(r.environments, "adopt-itest-me-env")).toBeUndefined();
    expect(count(r.environments, "adopt-itest-seed-env")).toBeUndefined();
  });
});
