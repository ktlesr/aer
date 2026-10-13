// Source-field access-URI rule (security review of 47dedc5): bypass forms and linear-time checks.
import { describe, expect, it } from "vitest";
import { sourcedSchema } from "./schemas";

const parse = (id: string) =>
  sourcedSchema.safeParse({ profile: "sourced_assistant", version: 1, citedSources: [{ id }] }).success;

describe("source ids carrying access material are rejected", () => {
  it.each([
    "https://x.example.invalid/d?X-Amz-Signature=s",
    "x.example.invalid/d?sig=s",
    "https://x.example.invalid/d#access_token=s",
    "https://x.example.invalid/d;jsessionid=s",
    "https://x.example.invalid/d%3FX-Amz-Signature%3Ds",
    "https://user:s@x.example.invalid/d",
  ])("%s", (id) => expect(parse(id)).toBe(false));

  it.each(["9903_karar.madde_9", "https://mevzuat.example.invalid/9903#madde-9", "Yatırım Kararı 2024.pdf", "kb:tesvik/9903"])(
    "accepts %s",
    (id) => expect(parse(id)).toBe(true),
  );
});

describe("oversized / adversarial values are rejected in linear time", () => {
  it.each([
    ["?".repeat(1_000_000)],
    ["?a".repeat(500_000)],
    ["a://".repeat(250_000)],
    ["%3".repeat(500_000)],
  ])("1 MB adversarial id (%#)", (id) => {
    const t = performance.now();
    expect(parse(id)).toBe(false);
    expect(performance.now() - t).toBeLessThan(250);
  });

  it("within max length, worst-case shapes stay fast", () => {
    for (const id of ["?".repeat(200), ";".repeat(200), "a://".repeat(50)]) {
      const t = performance.now();
      parse(id);
      expect(performance.now() - t).toBeLessThan(20);
    }
  });
});
