// Issue real credentials for the AER API (GO_LIVE G2).
// Reuses a default organization + project if they already exist, then ALWAYS mints a fresh API key.
//
// Security (docs/SECURITY.md): only sha256(key) is stored (keyHash). The plaintext `aer_...` key is
// printed to stdout exactly ONCE here and can never be recovered from the DB.
//
//   pnpm key:create
//   pnpm key:create --org "Acme" --project "Support Agents"
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export interface IssuedKey {
  /** Plaintext key — show once, never stored. */
  apiKey: string;
  organizationId: string;
  projectId: string;
  apiKeyId: string;
  prefix: string;
}

export interface IssueKeyOptions {
  orgName?: string;
  projectName?: string;
  keyName?: string;
}

/** Generate a fresh `aer_<32-hex>` key (128 bits of entropy after the prefix). */
function generateKey(): string {
  return `aer_${randomBytes(16).toString("hex")}`;
}

function newClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/**
 * Create (or reuse) one organization + project, then mint a brand-new API key for them.
 * Manages its own Prisma connection so it is safe to import and call from other scripts.
 */
export async function issueKey(options: IssueKeyOptions = {}): Promise<IssuedKey> {
  const orgName = options.orgName ?? "Default Org";
  const projectName = options.projectName ?? "Default Project";
  const keyName = options.keyName ?? "cli key";

  const prisma = newClient();
  try {
    const org = await prisma.organization.upsert({
      where: { id: "org_default" },
      update: { name: orgName },
      create: { id: "org_default", name: orgName },
    });

    const project = await prisma.project.upsert({
      where: { id_organizationId: { id: "proj_default", organizationId: org.id } },
      update: { name: projectName },
      create: { id: "proj_default", organizationId: org.id, name: projectName },
    });

    const apiKey = generateKey();
    const created = await prisma.apiKey.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        name: keyName,
        keyHash: sha256(apiKey),
        prefix: apiKey.slice(0, 13),
      },
    });

    return {
      apiKey,
      organizationId: org.id,
      projectId: project.id,
      apiKeyId: created.id,
      prefix: created.prefix,
    };
  } finally {
    await prisma.$disconnect();
  }
}

function parseArgs(argv: string[]): IssueKeyOptions {
  const opts: IssueKeyOptions = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--org") opts.orgName = argv[++i];
    else if (argv[i] === "--project") opts.projectName = argv[++i];
    else if (argv[i] === "--name") opts.keyName = argv[++i];
  }
  return opts;
}

async function cli(): Promise<void> {
  const issued = await issueKey(parseArgs(process.argv.slice(2)));
  console.log("API key created. Copy it now — it will NOT be shown again:\n");
  console.log(`  ${issued.apiKey}\n`);
  console.log(`  organization: ${issued.organizationId}`);
  console.log(`  project:      ${issued.projectId}`);
  console.log(`  key id:       ${issued.apiKeyId}`);
  console.log(`  prefix:       ${issued.prefix}`);
  console.log("\nUse it as:  Authorization: Bearer <key>");
}

const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  cli().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
