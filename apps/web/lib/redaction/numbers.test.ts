import { describe, expect, it } from "vitest";
import { luhnValid, redactJson } from "./index";

// Regression for a real Teşvik Asistanı record: {"score": "0.[REDACTED_CREDIT_CARD]"}.
// The fraction digits of a score happened to pass the Luhn check and were redacted as a card.
// Fixtures are deterministic: each fraction's digits are a Luhn-valid 13-digit run.
const LUHN_FRACTIONS = ["0.0000246913578", "0.0004320987615", "0.0005185185138"];

describe("redaction — numeric values are not cards", () => {
  it("fixtures really trigger the old bug (fraction digits are Luhn-valid, 13–19 long)", () => {
    for (const f of LUHN_FRACTIONS) {
      const digits = f.split(".")[1];
      expect(digits.length).toBeGreaterThanOrEqual(13);
      expect(luhnValid(digits)).toBe(true);
    }
  });

  it.each([
    ...LUHN_FRACTIONS.map(Number),
    0.48000000000000004,
    0.5143552127546813,
    -0.0000246913578,
    -0.5143552127546813,
    1e-7,
    5.0000246913578e-15,
    1.2345678901234567e21,
    123456.0000246913578,
    Number.MAX_SAFE_INTEGER / 3,
  ])("keeps the number %s as the same number with no finding", (score) => {
    const { redacted, findings } = redactJson({ score });
    expect((redacted as { score: unknown }).score).toBe(score);
    expect(findings).toHaveLength(0);
  });

  it.each(LUHN_FRACTIONS)("keeps the decimal string %s untouched", (s) => {
    const { redacted, findings } = redactJson({ score: s, text: `score=${s}; tr=${s.replace(".", ",")}` });
    expect(redacted).toEqual({ score: s, text: `score=${s}; tr=${s.replace(".", ",")}` });
    expect(findings).toHaveLength(0);
  });

  it("does not read an 11-digit fraction as a national id", () => {
    const { findings } = redactJson({ v: "0.12345678901", n: 0.12345678901 });
    expect(findings).toHaveLength(0);
  });

  it("still redacts a real card sent as a safe JSON integer", () => {
    const { redacted, findings } = redactJson({ card: 4111111111111111 });
    expect((redacted as { card: unknown }).card).toBe("[REDACTED_CREDIT_CARD]");
    expect(findings[0]?.findingType).toBe("credit_card");
  });

  it("fails closed on 17–19 digit integers: precision is already lost, the value can't be checked", () => {
    // 4111111111111111111 is not a safe integer; JSON.parse already rounded it.
    const n = JSON.parse("4111111111111111111") as number;
    expect(Number.isSafeInteger(n)).toBe(false);
    const { redacted, findings } = redactJson({ pan: n });
    expect((redacted as { pan: unknown }).pan).toBe("[REDACTED_CREDIT_CARD]");
    expect(findings[0]?.findingType).toBe("credit_card");
  });

  it("still redacts cards in text, including at a sentence end and next to amounts", () => {
    const { redacted, findings } = redactJson({
      a: "Kart 4111111111111111.",
      b: "4111 1111 1111 1111, tutar 1.250,00 TL",
      c: "toplam 0.0000246913578 puan, kart 4111-1111-1111-1111",
    });
    expect(redacted).toEqual({
      a: "Kart [REDACTED_CREDIT_CARD].",
      b: "[REDACTED_CREDIT_CARD], tutar 1.250,00 TL",
      c: "toplam 0.0000246913578 puan, kart [REDACTED_CREDIT_CARD]",
    });
    expect(findings.map((f) => f.findingType)).toEqual(["credit_card", "credit_card", "credit_card"]);
  });

  it("treats a long digit run glued to a decimal point as part of the number, not a card", () => {
    // Both sides of a decimal separator belong to the number.
    const { findings } = redactJson({ a: "4111111111111111.5", b: "1,4111111111111111" });
    expect(findings).toHaveLength(0);
  });
});
