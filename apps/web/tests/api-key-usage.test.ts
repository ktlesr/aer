import { describe, expect, it } from "vitest";
import { getStatus } from "../scripts/api-key-usage";

const cutoff = new Date("2026-07-16T12:00:00.000Z");

describe("getStatus", () => {
  it("classifies non-revoked keys by recent usage", () => {
    expect(getStatus(new Date("2026-07-16T12:00:00.000Z"), null, cutoff)).toBe(
      "ACTIVE",
    );
    expect(getStatus(new Date("2026-07-16T11:59:59.999Z"), null, cutoff)).toBe(
      "INACTIVE",
    );
    expect(getStatus(null, null, cutoff)).toBe("NEVER_USED");
  });

  it("classifies revoked keys as revoked regardless of recent usage", () => {
    expect(
      getStatus(
        new Date("2026-07-16T12:05:00.000Z"),
        new Date("2026-07-16T12:06:00.000Z"),
        cutoff,
      ),
    ).toBe("REVOKED");
  });
});
