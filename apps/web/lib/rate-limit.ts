// In-process fixed-window rate limiter. No external store (Redis/etc. are out of scope per
// CLAUDE.md) — appropriate for the current single-instance deployment. Trade-off: counters reset on
// restart and are not shared across instances; revisit if the app is ever horizontally scaled.

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the window resets (useful for a Retry-After hint). */
  retryAfterSec: number;
}

/**
 * Count one hit against `key`. Allows up to `limit` hits per `windowMs`. `now` is injectable so the
 * behaviour is deterministic in tests.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  // Opportunistic sweep so the map can't grow unbounded from one-off keys.
  if (store.size > 10_000) {
    for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
  }

  const bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: Math.ceil(windowMs / 1000) };
  }

  bucket.count += 1;
  const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
  if (bucket.count > limit) {
    return { ok: false, remaining: 0, retryAfterSec };
  }
  return { ok: true, remaining: limit - bucket.count, retryAfterSec };
}

/** Best-effort client IP from common proxy headers (Dokploy/Traefik set x-forwarded-for). */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test-only: clear all counters. */
export function __resetRateLimit(): void {
  store.clear();
}
