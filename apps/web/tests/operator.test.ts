import { describe, expect, it } from "vitest";
import { isOperator } from "@/lib/ops/operator";

describe("isOperator", () => {
  it("fails closed when no allowlist is configured", () => {
    expect(isOperator("user_1", undefined)).toBe(false);
    expect(isOperator("user_1", "")).toBe(false);
  });

  it("rejects a missing user id, even against a sloppy allowlist", () => {
    expect(isOperator(undefined, "user_1")).toBe(false);
    expect(isOperator(null, "user_1")).toBe(false);
    expect(isOperator("", "user_1,,")).toBe(false);
  });

  it("matches exact ids from a comma-separated list, ignoring whitespace", () => {
    expect(isOperator("user_1", "user_1")).toBe(true);
    expect(isOperator("user_2", " user_1 , user_2 ")).toBe(true);
    expect(isOperator("user_3", "user_1,user_2")).toBe(false);
  });

  it("never matches on a prefix or substring", () => {
    expect(isOperator("user_1", "user_10")).toBe(false);
    expect(isOperator("user", "user_1")).toBe(false);
  });
});
