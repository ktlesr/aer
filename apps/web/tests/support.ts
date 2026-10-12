// Shared fixtures for integration tests that run against a real PostgreSQL (DATABASE_URL).
// Synthetic tenants only — every org created here is deleted by dropTenants().
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

export function req(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json", ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

export const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

/** Create an org + project + API key. Returns the plaintext key (test fixture, not a secret). */
export async function makeTenant(orgId: string, key: string): Promise<{ projectId: string }> {
  const projectId = `${orgId}_proj`;
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.organization.create({
    data: { id: orgId, name: orgId, projects: { create: { id: projectId, name: "P" } } },
  });
  await prisma.apiKey.create({
    data: { organizationId: orgId, projectId, name: "k", keyHash: sha256(key), prefix: key.slice(0, 13) },
  });
  return { projectId };
}

export async function dropTenants(...orgIds: string[]): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
}
