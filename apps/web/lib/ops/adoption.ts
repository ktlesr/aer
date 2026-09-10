// Collector adoption, counted in projects: from npm install to 30-day retention. Operator-only —
// this reads across every workspace, so it must only ever be reached through requireOperator()
// (the /ops page) or the operator CLI (scripts/adoption.ts). Never from a tenant-facing route.
import type { PrismaClient } from "@/app/generated/prisma/client";

const DAY_MS = 86_400_000;
export const NPM_PACKAGE = "@ktlsr/collector-js";

export interface ProjectActivity {
  firstKeyAt: Date | null;
  firstRunAt: Date | null;
  firstEventAt: Date | null;
  lastEventAt: Date | null;
}

export interface Cohort {
  retained: number;
  eligible: number;
}

export interface Funnel {
  signedUp: number;
  keyCreated: number;
  firstRun: number;
  firstEvent: number;
  newThisWeek: number;
  active7d: number;
  active30d: number;
  retained7d: Cohort;
  retained30d: Cohort;
}

export interface ProjectRow {
  owner: string;
  workspace: string;
  project: string;
  runs: number;
  events: number;
  firstEventAt: Date;
  lastEventAt: Date;
}

export interface AdoptionReport {
  generatedAt: Date;
  excluded: { ownerless: number; internal: number };
  funnel: Funnel;
  events24h: number;
  events7d: number;
  /** [label, distinct projects], most-used first. */
  sdk: [string, number][];
  environments: [string, number][];
  /** Projects that have sent at least one event, most recently active first. */
  projects: ProjectRow[];
}

/**
 * Retained at day N = sent an event at least N days after its first one. Only projects whose
 * first event is at least N days old are eligible — a 3-day-old project hasn't had the chance
 * to churn, so counting it would inflate the denominator.
 */
function retention(projects: ProjectActivity[], days: number, now: Date): Cohort {
  const window = days * DAY_MS;
  let retained = 0;
  let eligible = 0;
  for (const p of projects) {
    if (!p.firstEventAt || !p.lastEventAt) continue;
    if (p.firstEventAt.getTime() > now.getTime() - window) continue;
    eligible++;
    if (p.lastEventAt.getTime() >= p.firstEventAt.getTime() + window) retained++;
  }
  return { retained, eligible };
}

export function buildFunnel(projects: ProjectActivity[], now: Date): Funnel {
  const since = (days: number) => now.getTime() - days * DAY_MS;
  const lastSeenSince = (days: number) =>
    projects.filter((p) => p.lastEventAt && p.lastEventAt.getTime() >= since(days)).length;
  return {
    signedUp: projects.length,
    keyCreated: projects.filter((p) => p.firstKeyAt).length,
    firstRun: projects.filter((p) => p.firstRunAt).length,
    firstEvent: projects.filter((p) => p.firstEventAt).length,
    newThisWeek: projects.filter((p) => p.firstEventAt && p.firstEventAt.getTime() >= since(7))
      .length,
    active7d: lastSeenSince(7),
    active30d: lastSeenSince(30),
    retained7d: retention(projects, 7, now),
    retained30d: retention(projects, 30, now),
  };
}

/** Distinct projects per label. A project running two SDK versions counts under both. */
export function countProjectsBy<T extends { projectId: string }>(
  rows: T[],
  label: (row: T) => string,
): [string, number][] {
  const byLabel = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = label(row);
    if (!byLabel.has(key)) byLabel.set(key, new Set());
    byLabel.get(key)!.add(row.projectId);
  }
  return [...byLabel].map(([k, ids]): [string, number] => [k, ids.size]).sort((a, b) => b[1] - a[1]);
}

export function parseInternalEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Last-365-day npm downloads (covers all time for this package), or null if npm is unreachable. */
export async function fetchNpmDownloads(): Promise<number | null> {
  try {
    const res = await fetch(`https://api.npmjs.org/downloads/point/last-year/${NPM_PACKAGE}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { downloads?: number };
    return typeof json.downloads === "number" ? json.downloads : null;
  } catch {
    return null;
  }
}

/**
 * Build the report from the database. Internal accounts are excluded so the numbers mean
 * "someone else": ownerless orgs (seed, demo, integration tests) always, plus `internalEmails`.
 */
export async function loadAdoptionReport(
  prisma: PrismaClient,
  { now, internalEmails }: { now: Date; internalEmails: Set<string> },
): Promise<AdoptionReport> {
  const [projects, keys, runs, events, sdkRows, envRows] = await Promise.all([
    prisma.project.findMany({
      select: {
        id: true,
        name: true,
        organization: { select: { name: true, owner: { select: { email: true } } } },
      },
    }),
    prisma.apiKey.groupBy({ by: ["projectId"], _min: { createdAt: true } }),
    prisma.agentRun.groupBy({
      by: ["projectId"],
      _min: { startedAt: true },
      _count: { _all: true },
    }),
    prisma.agentEvent.groupBy({
      by: ["projectId"],
      _min: { occurredAt: true },
      _max: { occurredAt: true },
      _count: { _all: true },
    }),
    prisma.agentRun.groupBy({ by: ["projectId", "sdkName", "sdkVersion"] }),
    prisma.agentRun.groupBy({ by: ["projectId", "environment"] }),
  ]);

  let ownerless = 0;
  let internal = 0;
  const included = projects.filter((p) => {
    const email = p.organization.owner?.email;
    if (!email) {
      ownerless++;
      return false;
    }
    if (internalEmails.has(email.toLowerCase())) {
      internal++;
      return false;
    }
    return true;
  });
  const includedIds = new Set(included.map((p) => p.id));

  const keyBy = new Map(keys.map((k) => [k.projectId, k]));
  const runBy = new Map(runs.map((r) => [r.projectId, r]));
  const eventBy = new Map(events.map((e) => [e.projectId, e]));

  const funnel = buildFunnel(
    included.map((p) => ({
      firstKeyAt: keyBy.get(p.id)?._min.createdAt ?? null,
      firstRunAt: runBy.get(p.id)?._min.startedAt ?? null,
      firstEventAt: eventBy.get(p.id)?._min.occurredAt ?? null,
      lastEventAt: eventBy.get(p.id)?._max.occurredAt ?? null,
    })),
    now,
  );

  // ponytail: `in` over every included project id. Fine at hundreds; switch to a join on
  // Organization.ownerUserId if this ever reaches tens of thousands of projects.
  const eventsSince = (days: number) =>
    prisma.agentEvent.count({
      where: {
        projectId: { in: [...includedIds] },
        occurredAt: { gte: new Date(now.getTime() - days * DAY_MS) },
      },
    });
  const [events24h, events7d] = await Promise.all([eventsSince(1), eventsSince(7)]);

  const mine = <T extends { projectId: string }>(rows: T[]) =>
    rows.filter((r) => includedIds.has(r.projectId));

  const projectRows: ProjectRow[] = [];
  for (const p of included) {
    const e = eventBy.get(p.id);
    if (!e?._min.occurredAt || !e._max.occurredAt) continue;
    projectRows.push({
      owner: p.organization.owner!.email,
      workspace: p.organization.name,
      project: p.name,
      runs: runBy.get(p.id)?._count._all ?? 0,
      events: e._count._all,
      firstEventAt: e._min.occurredAt,
      lastEventAt: e._max.occurredAt,
    });
  }
  projectRows.sort((a, b) => b.lastEventAt.getTime() - a.lastEventAt.getTime());

  return {
    generatedAt: now,
    excluded: { ownerless, internal },
    funnel,
    events24h,
    events7d,
    sdk: countProjectsBy(mine(sdkRows), (r) =>
      r.sdkName ? `${r.sdkName} ${r.sdkVersion}` : "unknown (<=0.1.0 / raw API)",
    ),
    environments: countProjectsBy(mine(envRows), (r) => r.environment ?? "(not set)"),
    projects: projectRows,
  };
}
