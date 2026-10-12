import { describe, expect, it } from "vitest";
import { isSecretKey, redactJson } from "./index";

describe("redaction — secret field rules", () => {
  it.each(["password", "db_password", "Passwd", "clientSecret", "api_key", "X-Api-Key", "apiKey",
    "authorization", "Proxy-Authorization", "cookie", "Set-Cookie", "refresh_token", "csrfToken",
    "private_key", "credentials", "pin", "otp", "session_id"])("%s is a secret field", (k) => {
    expect(isSecretKey(k)).toBe(true);
  });

  it.each(["name", "score", "completion_tokens", "maxTokens", "tokens", "keywords", "spinner",
    "options", "description"])("%s is not a secret field", (k) => {
    expect(isSecretKey(k)).toBe(false);
  });

  it("masks the whole value under a secret key, any type, and records no hash", () => {
    const { redacted, findings } = redactJson({
      user: "ayse",
      password: "hunter2",
      headers: { Authorization: "Basic dXNlcjpwYXNz", Accept: "application/json" },
      creds: { credentials: { user: "u", pass: "p" } },
      pin: 1234,
    });
    expect(redacted).toEqual({
      user: "ayse",
      password: "[REDACTED_SECRET]",
      headers: { Authorization: "[REDACTED_SECRET]", Accept: "application/json" },
      creds: { credentials: "[REDACTED_SECRET]" },
      pin: "[REDACTED_SECRET]",
    });
    expect(findings.map((f) => [f.fieldPath, f.findingType, f.severity, f.originalHash])).toEqual([
      ["password", "secret", "high", ""],
      ["headers.Authorization", "secret", "high", ""],
      ["creds.credentials", "secret", "high", ""],
      ["pin", "secret", "high", ""],
    ]);
    expect(JSON.stringify({ redacted, findings })).not.toMatch(/hunter2|dXNlcjpwYXNz|1234/);
  });

  it("leaves empty / already-masked secrets alone (client already redacted)", () => {
    const { findings } = redactJson({ password: "", token: null, apiKey: "[REDACTED_SECRET]" });
    expect(findings).toHaveLength(0);
  });
});

describe("redaction — object keys", () => {
  it("never silently overwrites when two keys mask to the same token", () => {
    const { redacted, findings } = redactJson({ "a@x.io": 1, "b@x.io": 2, "c@x.io": 3 });
    expect(redacted).toEqual({
      "[REDACTED_EMAIL]": 1,
      "[REDACTED_EMAIL]#2": 2,
      "[REDACTED_EMAIL]#3": 3,
    });
    expect(findings.map((f) => f.fieldPath)).toEqual([
      "[REDACTED_EMAIL]",
      "[REDACTED_EMAIL]#2",
      "[REDACTED_EMAIL]#3",
    ]);
  });

  it("suffixes past a literal key that already uses the suffix", () => {
    const { redacted } = redactJson(JSON.parse('{"[REDACTED_EMAIL]#2":0,"a@x.io":1,"b@x.io":2}'));
    expect(Object.keys(redacted as object)).toEqual([
      "[REDACTED_EMAIL]#2",
      "[REDACTED_EMAIL]",
      "[REDACTED_EMAIL]#3",
    ]);
  });

  it("keeps a __proto__ key as data instead of swapping the prototype", () => {
    const { redacted } = redactJson(JSON.parse('{"__proto__":{"email":"a@x.io"}}'));
    expect(Object.getPrototypeOf(redacted)).toBe(Object.prototype);
    expect(JSON.stringify(redacted)).toBe('{"__proto__":{"email":"[REDACTED_EMAIL]"}}');
  });

  it("does not mutate the source, deep", () => {
    const src = { a: { password: "x", list: [{ email: "a@x.io" }] } };
    const copy = structuredClone(src);
    redactJson(src);
    expect(src).toEqual(copy);
  });
});
