// Operator-only collector adoption report, printed to the terminal. The same numbers are on the
// /ops page for operators (AER_OPERATOR_USER_IDS). This reads across all workspaces directly from
// the database and must not be exposed through a tenant-facing route or dashboard.
//
//   pnpm adoption
//   (prod container) cd /app/apps/web && ./node_modules/.bin/tsx scripts/adoption.ts
//
// Internal accounts are excluded so the numbers mean "someone else": ownerless orgs (seed, demo,
// integration tests) always, plus any owner email in AER_INTERNAL_EMAILS (comma-separated).
// Prints owner emails and project names only — never keys, payloads or event content.
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";
import { fetchNpmDownloads, loadAdoptionReport, parseInternalEmails } from "../lib/ops/adoption";

const pct = (part: number, whole: number) =>
  whole === 0 ? "" : `${Math.round((part / whole) * 100)}%`;
const iso = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const [r, downloads] = await Promise.all([
      loadAdoptionReport(prisma, {
        now: new Date(),
        internalEmails: parseInternalEmails(process.env.AER_INTERNAL_EMAILS),
      }),
      fetchNpmDownloads(),
    ]);
    const f = r.funnel;

    const row = (label: string, value: number | string, note = "") =>
      console.log(`  ${label.padEnd(30)}${String(value).padStart(10)}   ${note}`);

    console.log("Collector adoption report (unit: project)");
    console.log(`Generated: ${r.generatedAt.toISOString()}`);
    console.log(
      `Excluded: ${r.excluded.ownerless} ownerless (seed/demo/test), ${r.excluded.internal} internal via AER_INTERNAL_EMAILS`,
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
    row("events last 24h", r.events24h.toLocaleString("en-US"));
    row("events last 7d", r.events7d.toLocaleString("en-US"));

    console.log("\nSDK (projects per version)");
    for (const [label, n] of r.sdk) row(label, n);

    console.log("\nENVIRONMENT (projects per label)");
    for (const [label, n] of r.environments) row(label, n);

    console.log(`\nPROJECTS SENDING EVENTS (${r.projects.length})`);
    if (r.projects.length > 0) {
      console.table(
        r.projects.map((p) => ({
          ...p,
          firstEventAt: iso(p.firstEventAt),
          lastEventAt: iso(p.lastEventAt),
        })),
      );
    }
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
