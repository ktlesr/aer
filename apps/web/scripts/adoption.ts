// Operator-only collector adoption report: from npm install to 30-day retention, counted in
// projects. This reads across all workspaces directly from the database and must not be exposed
// through a tenant-facing route or dashboard.
//
//   pnpm adoption
//
// Internal accounts are excluded so the numbers mean "someone else": ownerless orgs (seed, demo,
// integration tests) always, plus any owner email in AER_INTERNAL_EMAILS (comma-separated).
// Prints owner emails and project names only — never keys, payloads or event content.
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

const DAY_MS = 86_400_000;
const NPM_PACKAGE = "@ktlsr/collector-js";

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
async function npmDownloads(): Promise<number | null> {
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

const pct = (part: number, whole: number) =>
  whole === 0 ? "" : `${Math.round((part / whole) * 100)}%`;
const iso = (d: Date | null) => d?.toISOString().slice(0, 16).replace("T", " ") ?? "";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const now = new Date();
    const internal = parseInternalEmails(process.env.AER_INTERNAL_EMAILS);

    const [projects, keys, runs, events, sdkRows, envRows, downloads] = await Promise.all([
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
      npmDownloads(),
    ]);

    let ownerless = 0;
    let internalCount = 0;
    const included = projects.filter((p) => {
      const email = p.organization.owner?.email;
      if (!email) {
        ownerless++;
        return false;
      }
      if (internal.has(email.toLowerCase())) {
        internalCount++;
        return false;
      }
      return true;
    });
    const includedIds = new Set(included.map((p) => p.id));

    const keyBy = new Map(keys.map((k) => [k.projectId, k]));
    const runBy = new Map(runs.map((r) => [r.projectId, r]));
    const eventBy = new Map(events.map((e) => [e.projectId, e]));

    const activity: ProjectActivity[] = included.map((p) => ({
      firstKeyAt: keyBy.get(p.id)?._min.createdAt ?? null,
      firstRunAt: runBy.get(p.id)?._min.startedAt ?? null,
      firstEventAt: eventBy.get(p.id)?._min.occurredAt ?? null,
      lastEventAt: eventBy.get(p.id)?._max.occurredAt ?? null,
    }));
    const f = buildFunnel(activity, now);

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

    const row = (label: string, value: number | string, note = "") =>
      console.log(`  ${label.padEnd(30)}${String(value).padStart(10)}   ${note}`);

    console.log("Collector adoption report (unit: project)");
    console.log(`Generated: ${now.toISOString()}`);
    console.log(
      `Excluded: ${ownerless} ownerless (seed/demo/test), ${internalCount} internal via AER_INTERNAL_EMAILS`,
    );

    console.log("\nFUNNEL");
    row("npm downloads (last 365d)", downloads ?? "n/a", "installs, not people — includes CI and mirrors");
    row("signed up", f.signedUp);
    row("API key created", f.keyCreated, pct(f.keyCreated, f.signedUp));
    row("first run", f.firstRun, pct(f.firstRun, f.keyCreated));
    row("first event", f.firstEvent, `${pct(f.firstEvent, f.firstRun)}   <- connected and running`);
    row("retained 7d", `${f.retained7d.retained} / ${f.retained7d.eligible}`, "of projects whose first event is 7d+ old");
    row("retained 30d", `${f.retained30d.retained} / ${f.retained30d.eligible}`, "of projects whose first event is 30d+ old");

    console.log("\nACTIVITY");
    row("active last 7d", f.active7d);
    row("active last 30d", f.active30d);
    row("first event this week", f.newThisWeek);
    row("events last 24h", events24h.toLocaleString("en-US"));
    row("events last 7d", events7d.toLocaleString("en-US"));

    const mine = <T extends { projectId: string }>(rows: T[]) =>
      rows.filter((r) => includedIds.has(r.projectId));

    console.log("\nSDK (projects per version)");
    for (const [label, n] of countProjectsBy(mine(sdkRows), (r) =>
      r.sdkName ? `${r.sdkName} ${r.sdkVersion}` : "unknown (<=0.1.0 / raw API)",
    ))
      row(label, n);

    console.log("\nENVIRONMENT (projects per label)");
    for (const [label, n] of countProjectsBy(mine(envRows), (r) => r.environment ?? "(not set)"))
      row(label, n);

    const table = included
      .filter((p) => eventBy.has(p.id))
      .map((p) => ({
        owner: p.organization.owner!.email,
        workspace: p.organization.name,
        project: p.name,
        runs: runBy.get(p.id)?._count._all ?? 0,
        events: eventBy.get(p.id)!._count._all,
        firstEvent: iso(eventBy.get(p.id)!._min.occurredAt),
        lastEvent: iso(eventBy.get(p.id)!._max.occurredAt),
      }))
      .sort((a, b) => b.lastEvent.localeCompare(a.lastEvent));

    console.log(`\nPROJECTS SENDING EVENTS (${table.length})`);
    if (table.length > 0) console.table(table);
  } finally {
    await prisma.$disconnect();
  }
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
