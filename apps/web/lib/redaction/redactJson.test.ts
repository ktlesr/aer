import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { redactJson, type RedactionFinding } from "./index";

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

function findingFor(
  findings: RedactionFinding[],
  fieldPath: string,
): RedactionFinding | undefined {
  return findings.find((f) => f.fieldPath === fieldPath);
}

describe("redactJson — per-pattern detection", () => {
  it("redacts an email and reports a medium finding with the value hash", () => {
    const raw = "jane.doe@example.com";
    const { redacted, findings } = redactJson({ email: raw });

    expect((redacted as { email: string }).email).toBe("[REDACTED_EMAIL]");
    const f = findingFor(findings, "email");
    expect(f).toBeDefined();
    expect(f?.findingType).toBe("email");
    expect(f?.severity).toBe("medium");
    expect(f?.originalHash).toBe(sha256(raw));
  });

  it("redacts a phone number", () => {
    const raw = "+1 415 555 0142";
    const { redacted, findings } = redactJson({ phone: raw });

    expect((redacted as { phone: string }).phone).toBe("[REDACTED_PHONE]");
    const f = findingFor(findings, "phone");
    expect(f?.findingType).toBe("phone");
    expect(f?.severity).toBe("medium");
    expect(f?.originalHash).toBe(sha256(raw));
  });

  it("redacts a prefixed API key as high severity", () => {
    const raw = "sk-1234567890ABCDEFghijKLmn";
    const { redacted, findings } = redactJson({ token: raw });

    expect((redacted as { token: string }).token).toBe("[REDACTED_API_KEY]");
    const f = findingFor(findings, "token");
    expect(f?.findingType).toBe("api_key");
    expect(f?.severity).toBe("high");
    expect(f?.originalHash).toBe(sha256(raw));
  });

  it("redacts an aer_live_ API key", () => {
    const raw = "aer_live_0123456789abcdef0123456789abcdef";
    const { redacted } = redactJson({ key: raw });
    expect((redacted as { key: string }).key).toBe("[REDACTED_API_KEY]");
  });

  it("redacts an sk-proj- style API key (hyphenated body)", () => {
    const raw = "sk-proj-abcDEF123456ghiJKL789mno";
    const { redacted, findings } = redactJson({ key: raw });
    expect((redacted as { key: string }).key).toBe("[REDACTED_API_KEY]");
    expect(findingFor(findings, "key")?.findingType).toBe("api_key");
  });

  it("redacts our own aer_<hex> minted key format", () => {
    const raw = "aer_a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const { redacted, findings } = redactJson({ note: `my key is ${raw}` });
    expect((redacted as { note: string }).note).toBe("my key is [REDACTED_API_KEY]");
    expect(findingFor(findings, "note")?.findingType).toBe("api_key");
    expect(findingFor(findings, "note")?.originalHash).toBe(sha256(raw));
  });

  it("redacts a JWT/bearer token as high severity", () => {
    const raw =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const { redacted, findings } = redactJson({ auth: raw });

    expect((redacted as { auth: string }).auth).toBe("[REDACTED_BEARER_TOKEN]");
    const f = findingFor(findings, "auth");
    expect(f?.findingType).toBe("bearer_token");
    expect(f?.severity).toBe("high");
  });

  it("redacts a Luhn-valid credit card as high severity", () => {
    const raw = "4111111111111111";
    const { redacted, findings } = redactJson({ card: raw });

    expect((redacted as { card: string }).card).toBe("[REDACTED_CREDIT_CARD]");
    const f = findingFor(findings, "card");
    expect(f?.findingType).toBe("credit_card");
    expect(f?.severity).toBe("high");
    expect(f?.originalHash).toBe(sha256(raw));
  });

  it("does NOT treat a Luhn-invalid 16-digit number as a credit card", () => {
    const { findings } = redactJson({ num: "4111111111111112" });
    expect(findings.some((f) => f.findingType === "credit_card")).toBe(false);
  });

  it("redacts an SSN-style national id as high severity", () => {
    const raw = "123-45-6789";
    const { redacted, findings } = redactJson({ ssn: raw });

    expect((redacted as { ssn: string }).ssn).toBe("[REDACTED_NATIONAL_ID]");
    const f = findingFor(findings, "ssn");
    expect(f?.findingType).toBe("national_id");
    expect(f?.severity).toBe("high");
  });
});

describe("redactJson — phone precision (no false positives on money / document numbers)", () => {
  const hasPhone = (v: unknown) =>
    redactJson({ v }).findings.some((f) => f.findingType === "phone");

  it.each([
    "+90 555 123 4567",
    "+90 555 123 45 67",
    "+1 415 555 0142",
    "0 555 123 45 67",
    "0555 123 4567",
    "05551234567",
    "0212 345 67 89",
    "(415) 555-0142",
    "(0212) 345 67 89",
  ])("redacts a real phone number: %s", (raw) => {
    const { redacted, findings } = redactJson({ v: raw });
    expect((redacted as { v: string }).v).toBe("[REDACTED_PHONE]");
    expect(findings.some((f) => f.findingType === "phone")).toBe(true);
  });

  it.each([
    "100.000.000 TL",
    "4.000.000",
    "1.500.000,50 TL",
    "asgari sabit yatırım tutarı 4.000.000 TL'dir",
    "9903_teblig.pdf",
    "2003_Proje_Bazli.pdf",
    "9903_karar.pdf_madde_9_p_1_s1",
    "ykh-2026-ykh_2026_185",
    "31.12.2026",
  ])("does NOT treat money / document numbers as a phone: %s", (raw) => {
    expect(hasPhone(raw)).toBe(false);
  });

  it("classifies an 11-digit TCKN as national_id, and an 0-prefixed number as phone", () => {
    const tckn = redactJson({ v: "12345678901" });
    expect(tckn.findings.some((f) => f.findingType === "national_id")).toBe(true);
    expect(tckn.findings.some((f) => f.findingType === "phone")).toBe(false);

    const phone = redactJson({ v: "05551234567" });
    expect(phone.findings.some((f) => f.findingType === "phone")).toBe(true);
    expect(phone.findings.some((f) => f.findingType === "national_id")).toBe(false);
  });
});

describe("redactJson — safety invariants", () => {
  it("never includes a raw sensitive value in the findings", () => {
    const raw = "jane.doe@example.com";
    const { findings } = redactJson({ email: raw });
    expect(JSON.stringify(findings)).not.toContain(raw);
    expect(JSON.stringify(findings)).not.toContain("jane.doe");
  });

  it("does not mutate the input object", () => {
    const input = { email: "jane.doe@example.com" };
    redactJson(input);
    expect(input.email).toBe("jane.doe@example.com");
  });

  it("leaves non-sensitive scalar types untouched", () => {
    const { redacted, findings } = redactJson({
      n: 42,
      b: true,
      z: null,
      s: "nothing sensitive here",
    });
    expect(redacted).toEqual({ n: 42, b: true, z: null, s: "nothing sensitive here" });
    expect(findings).toHaveLength(0);
  });

  it("redacts a sensitive value sent as a JSON number (not a string)", () => {
    const { redacted, findings } = redactJson({ card: 4111111111111111, ssn: 12345678901 });
    const r = redacted as { card: string; ssn: string };
    expect(r.card).toBe("[REDACTED_CREDIT_CARD]");
    expect(r.ssn).toBe("[REDACTED_NATIONAL_ID]");
    expect(findingFor(findings, "card")?.findingType).toBe("credit_card");
    expect(findingFor(findings, "ssn")?.findingType).toBe("national_id");
    expect(findingFor(findings, "card")?.originalHash).toBe(sha256("4111111111111111"));
  });

  it("redacts a sensitive value used as an object KEY", () => {
    const email = "jane.doe@example.com";
    const { redacted, findings } = redactJson({ [email]: "x" });
    expect(redacted).toEqual({ "[REDACTED_EMAIL]": "x" });
    expect(findingFor(findings, "[REDACTED_EMAIL]")?.findingType).toBe("email");
    expect(findingFor(findings, "[REDACTED_EMAIL]")?.originalHash).toBe(sha256(email));
    expect(JSON.stringify(redacted)).not.toContain("jane.doe");
    expect(JSON.stringify(findings)).not.toContain("jane.doe");
  });

  it("is idempotent — re-redacting produces no new findings", () => {
    const first = redactJson({ email: "jane.doe@example.com" });
    const second = redactJson(first.redacted);
    expect(second.findings).toHaveLength(0);
    expect(second.redacted).toEqual(first.redacted);
  });
});

describe("redactJson — traversal", () => {
  it("walks nested objects and arrays and reports dotted/indexed field paths", () => {
    const { redacted, findings } = redactJson({
      customer: { email: "jane.doe@example.com", phone: "+1 415 555 0142" },
      items: [{ card: "4111111111111111" }],
    });

    expect(findingFor(findings, "customer.email")?.findingType).toBe("email");
    expect(findingFor(findings, "customer.phone")?.findingType).toBe("phone");
    expect(findingFor(findings, "items[0].card")?.findingType).toBe("credit_card");

    const r = redacted as {
      customer: { email: string; phone: string };
      items: { card: string }[];
    };
    expect(r.customer.email).toBe("[REDACTED_EMAIL]");
    expect(r.items[0].card).toBe("[REDACTED_CREDIT_CARD]");
  });

  it("redacts multiple matches inside a single string", () => {
    const { redacted, findings } = redactJson({
      note: "reach jane.doe@example.com or +1 415 555 0142",
    });
    const note = (redacted as { note: string }).note;
    expect(note).toContain("[REDACTED_EMAIL]");
    expect(note).toContain("[REDACTED_PHONE]");
    expect(note).not.toContain("jane.doe@example.com");
    expect(findings.filter((f) => f.fieldPath === "note")).toHaveLength(2);
  });

  it("returns no findings for clean input", () => {
    const { findings } = redactJson({
      title: "Quarterly report",
      count: 7,
      when: "tomorrow at 2 pm",
    });
    expect(findings).toHaveLength(0);
  });
});
