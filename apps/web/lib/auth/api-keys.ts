import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { DashboardScope } from "@/lib/dashboard/scope";

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export interface CreatedApiKey {
  /** Plaintext key — returned ONCE so the UI can show it; never persisted. */
  apiKey: string;
  id: string;
  prefix: string;
}

/** Mint a fresh `aer_<32-hex>` key for the caller's workspace. Only the sha256 hash is stored. */
export async function createApiKey(
  scope: DashboardScope,
  name: string,
): Promise<CreatedApiKey> {
  const apiKey = `aer_${randomBytes(16).toString("hex")}`;
  const created = await prisma.apiKey.create({
    data: {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      name: name.trim() || "api key",
      keyHash: sha256(apiKey),
      prefix: apiKey.slice(0, 13),
    },
  });
  return { apiKey, id: created.id, prefix: created.prefix };
}

/** Keys for the caller's workspace — metadata only, never the hash or plaintext. */
export async function listApiKeys(scope: DashboardScope) {
  return prisma.apiKey.findMany({
    where: { organizationId: scope.organizationId, projectId: scope.projectId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
}

/** Revoke a key, scoped to the caller's workspace so one tenant can't revoke another's key. */
export async function revokeApiKey(
  scope: DashboardScope,
  keyId: string,
): Promise<boolean> {
  const res = await prisma.apiKey.updateMany({
    where: {
      id: keyId,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  return res.count > 0;
}

export type ApiKeyListItem = Awaited<ReturnType<typeof listApiKeys>>[number];
