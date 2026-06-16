import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ApiError } from "./errors";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export interface AuthContext {
  organizationId: string;
  projectId: string;
  apiKeyId: string;
}

// Per-IP guards unauthenticated flooding (cheap, before any DB lookup); per-key bounds a single
// tenant/agent. Generous enough for legitimate bursts (a run emits ~10 events back-to-back).
const IP_LIMIT = 600; // requests / minute / IP
const KEY_LIMIT = 240; // requests / minute / API key
const WINDOW_MS = 60_000;

/**
 * Resolve org+project from a Bearer API key. The key is never stored or logged in plaintext —
 * we hash the presented value and look it up by keyHash. Revoked/invalid keys are rejected.
 * Rate-limited per IP (pre-auth) and per key (post-auth).
 */
export async function authenticate(request: Request): Promise<AuthContext> {
  if (!rateLimit(`v1:ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS).ok) {
    throw new ApiError("rate_limited", "Rate limit exceeded", 429);
  }

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

  if (!rateLimit(`v1:key:${key.id}`, KEY_LIMIT, WINDOW_MS).ok) {
    throw new ApiError("rate_limited", "Rate limit exceeded", 429);
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
