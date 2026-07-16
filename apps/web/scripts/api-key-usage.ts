// Operator-only API key activity report. This reads across all workspaces directly from the
// database and must not be exposed through a tenant-facing route or dashboard.
//
//   pnpm keys:usage
//
// The report never prints plaintext keys or stored key hashes.
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

const ACTIVE_WINDOW_MINUTES = 15;
const ACTIVE_WINDOW_MS = ACTIVE_WINDOW_MINUTES * 60_000;

type KeyStatus = "ACTIVE" | "INACTIVE" | "NEVER_USED" | "REVOKED";

export function getStatus(
  lastUsedAt: Date | null,
  revokedAt: Date | null,
  cutoff: Date,
): KeyStatus {
  if (revokedAt) return "REVOKED";
  if (!lastUsedAt) return "NEVER_USED";
  return lastUsedAt >= cutoff ? "ACTIVE" : "INACTIVE";
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const generatedAt = new Date();
    const cutoff = new Date(generatedAt.getTime() - ACTIVE_WINDOW_MS);
    const keys = await prisma.apiKey.findMany({
      select: {
        name: true,
        prefix: true,
        lastUsedAt: true,
        revokedAt: true,
        organization: {
          select: {
            name: true,
            owner: { select: { email: true } },
          },
        },
        project: { select: { name: true } },
      },
      orderBy: [{ organizationId: "asc" }, { projectId: "asc" }, { createdAt: "asc" }],
    });

    const rows = keys.map((key) => ({
      user: key.organization.owner?.email ?? "(unowned)",
      workspace: key.organization.name,
      project: key.project.name,
      key: key.name,
      prefix: key.prefix,
      status: getStatus(key.lastUsedAt, key.revokedAt, cutoff),
      lastUsedAt: key.lastUsedAt?.toISOString() ?? "never",
      revokedAt: key.revokedAt?.toISOString() ?? "",
    }));
    const activeCount = rows.filter((row) => row.status === "ACTIVE").length;

    console.log(
      `API key usage report (active = used within ${ACTIVE_WINDOW_MINUTES} minutes)`,
    );
    console.log(`Generated: ${generatedAt.toISOString()}`);
    console.log(`Active cutoff: ${cutoff.toISOString()}`);
    console.log(`Total keys: ${rows.length}; active keys: ${activeCount}`);

    if (rows.length === 0) {
      console.log("No API keys found.");
      return;
    }

    console.table(rows);
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
