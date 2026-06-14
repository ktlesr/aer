import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ApiError } from "./errors";

export interface AuthContext {
  organizationId: string;
  projectId: string;
  apiKeyId: string;
}

/**
 * Resolve org+project from a Bearer API key. The key is never stored or logged in plaintext —
 * we hash the presented value and look it up by keyHash. Revoked/invalid keys are rejected.
 */
export async function authenticate(request: Request): Promise<AuthContext> {
  const header = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    throw new ApiError("unauthorized", "Missing or malformed Authorization header", 401);
  }

  const presented = match[1].trim();
  const keyHash = createHash("sha256").update(presented).digest("hex");

  const key = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (!key || key.revokedAt) {
    throw new ApiError("unauthorized", "Invalid API key", 401);
  }

  // Best-effort usage timestamp; never block the request on it.
  void prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    organizationId: key.organizationId,
    projectId: key.projectId,
    apiKeyId: key.id,
  };
}
