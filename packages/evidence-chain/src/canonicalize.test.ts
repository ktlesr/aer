import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonicalize";

describe("canonicalize", () => {
  it("is stable across object key order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("preserves array order", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("normalizes undefined to null", () => {
    expect(canonicalize({ a: undefined })).toBe(canonicalize({ a: null }));
  });

  it("sorts nested keys recursively", () => {
    expect(canonicalize({ x: { d: 1, c: 2 } })).toBe(canonicalize({ x: { c: 2, d: 1 } }));
  });

  it("distinguishes different values", () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 2 }));
  });
});
