// Retention: delete agent runs older than N days (their events, findings and exports cascade via
// the DB foreign keys). Runs accumulate forever otherwise — including their full JSON packets.
//
// SAFE BY DEFAULT: this is a dry run unless you pass --apply.
//
//   pnpm prune:runs                      # dry run, 90-day cutoff — shows what WOULD be deleted
//   pnpm prune:runs --older-than 30      # dry run, 30-day cutoff
//   pnpm prune:runs --older-than 90 --apply         # actually delete
//   pnpm prune:runs --org org_xyz --apply           # restrict to one workspace
//
// On Dokploy, run it as a scheduled task / cron against the app container, e.g. daily:
//   cd /app/apps/web && pnpm exec tsx scripts/prune-runs.ts --older-than 90 --apply
//
// Runs flagged with `legalHold` are never deleted, however old they are.
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

interface Options {
  days: number;
  apply: boolean;
  orgId?: string;
}

export interface PruneSummary {
  /** Old runs that are prunable (legal hold excluded). */
  eligible: number;
  /** Old runs left alone because they are under legal hold. */
  held: number;
  /** Actually deleted — always 0 on a dry run. */
  deleted: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { days: 90, apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--older-than") opts.days = parseInt(argv[++i] ?? "", 10);
    else if (argv[i] === "--apply") opts.apply = true;
    else if (argv[i] === "--org") opts.orgId = argv[++i];
  }
  return opts;
}

export async function pruneRuns(
  prisma: PrismaClient,
  { days, apply, orgId }: Options,
): Promise<PruneSummary> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const older = {
    startedAt: { lt: cutoff },
    ...(orgId ? { organizationId: orgId } : {}),
  };
  const prunable = { ...older, legalHold: false };

  const [eligible, held] = await Promise.all([
    prisma.agentRun.count({ where: prunable }),
    prisma.agentRun.count({ where: { ...older, legalHold: true } }),
  ]);

  const scopeLabel = orgId ? ` in org ${orgId}` : "";
  console.log(
    `${eligible} run(s) started before ${cutoff.toISOString()} (older than ${days} days)${scopeLabel}.`,
  );
  if (held > 0) {
    console.log(`${held} further run(s) in that window kept: legal hold.`);
  }

  if (eligible === 0) {
    console.log("Nothing to prune.");
    return { eligible, held, deleted: 0 };
  }

  if (!apply) {
    console.log("DRY RUN — nothing deleted. Re-run with --apply to delete (cascades to events, findings, exports).");
    return { eligible, held, deleted: 0 };
  }

  const res = await prisma.agentRun.deleteMany({ where: prunable });
  console.log(`Deleted ${res.count} run(s) and their cascaded events/findings/exports.`);
  return { eligible, held, deleted: res.count };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(opts.days) || opts.days < 1) {
    throw new Error("--older-than must be a positive number of days");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    await pruneRuns(prisma, opts);
  } finally {
    await prisma.$disconnect();
  }
}

const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
