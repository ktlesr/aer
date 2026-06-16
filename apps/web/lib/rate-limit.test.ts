import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit, __resetRateLimit } from "./rate-limit";

describe("rateLimit — fixed window", () => {
  beforeEach(() => __resetRateLimit());

  it("allows up to the limit, then blocks within the window", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("k", 3, 1000, t0).ok).toBe(true);
    }
    const blocked = rateLimit("k", 3, 1000, t0 + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const t0 = 2_000_000;
    expect(rateLimit("k", 1, 1000, t0).ok).toBe(true);
    expect(rateLimit("k", 1, 1000, t0 + 500).ok).toBe(false);
    expect(rateLimit("k", 1, 1000, t0 + 1001).ok).toBe(true); // new window
  });

  it("tracks keys independently", () => {
    const t0 = 3_000_000;
    expect(rateLimit("a", 1, 1000, t0).ok).toBe(true);
    expect(rateLimit("a", 1, 1000, t0).ok).toBe(false);
    expect(rateLimit("b", 1, 1000, t0).ok).toBe(true); // different key unaffected
  });
});
