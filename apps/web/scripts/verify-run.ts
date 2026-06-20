// Operator-side chain verification. Loads a run's events + findings from the DB, rebuilds the
// evidence chain through the SAME pure verifyChain, and reports the verdict.
//
//   pnpm verify:run <run_id>
//     PASS (<n> events)                 exit 0  — chain intact, seal matches
//     BROKEN at seq <N>: <reason>        exit 1  — a stored event/finding was altered, or seal mismatch
//     LEGACY (unchained run)             exit 2  — run predates the chain feature (no hashes)
//
// Never prints raw event payloads — only seq numbers and the verdict.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { verifyChain } from "@ktlsr/evidence-chain";
import { PrismaClient } from "../app/generated/prisma/client";
import { toChainLink } from "../lib/audit/chainAdapter";

async function main(): Promise<number> {
  const runId = process.argv[2];
  if (!runId) {
    console.error("usage: pnpm verify:run <run_id>");
    return 1;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const run = await prisma.agentRun.findUnique({ where: { id: runId } });
    if (!run) {
      console.error(`run not found: ${runId}`);
      return 1;
    }

    const events = await prisma.agentEvent.findMany({
      where: { runId },
      orderBy: { seq: "asc" },
    });
    const findings = await prisma.redactionFinding.findMany({ where: { runId } });
    const links = events.map((e) => toChainLink(e, findings));

    const result = verifyChain(links, run.seal, run.id);

    if (result.ok) {
      console.log(`PASS (${result.checkedCount} events) — run ${runId}`);
      return 0;
    }
    if (result.status === "legacy") {
      console.log(`LEGACY (unchained run) — run ${runId}: ${result.reason}`);
      return 2;
    }
    console.error(`BROKEN at seq ${result.brokenSeq}: ${result.reason} — run ${runId}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
