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
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

interface Options {
  days: number;
  apply: boolean;
  orgId?: string;
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

async function main(): Promise<void> {
  const { days, apply, orgId } = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(days) || days < 1) {
    throw new Error("--older-than must be a positive number of days");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const where = {
      startedAt: { lt: cutoff },
      ...(orgId ? { organizationId: orgId } : {}),
    };

    const count = await prisma.agentRun.count({ where });
    const scopeLabel = orgId ? ` in org ${orgId}` : "";
    console.log(
      `${count} run(s) started before ${cutoff.toISOString()} (older than ${days} days)${scopeLabel}.`,
    );

    if (count === 0) {
      console.log("Nothing to prune.");
      return;
    }

    if (!apply) {
      console.log("DRY RUN — nothing deleted. Re-run with --apply to delete (cascades to events, findings, exports).");
      return;
    }

    const res = await prisma.agentRun.deleteMany({ where });
    console.log(`Deleted ${res.count} run(s) and their cascaded events/findings/exports.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
