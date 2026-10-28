import { describe, expect, it } from "vitest";
import {
  formatNumericDraft,
  parseNumericDraft,
  sanitizeNumericDraft,
  validateRequiredNumericDraft,
} from "@/lib/ui/numeric-draft";

describe("sanitizeNumericDraft", () => {
  it("allows clearing to empty", () => {
    expect(sanitizeNumericDraft("", { allowDecimal: true })).toBe("");
    expect(sanitizeNumericDraft("30".slice(0, 0))).toBe("");
  });

  it("strips non-digits for integers", () => {
    expect(sanitizeNumericDraft("1a2b", { allowDecimal: false })).toBe("12");
    expect(sanitizeNumericDraft("3.5", { allowDecimal: false })).toBe("35");
  });

  it("keeps one decimal point when allowed", () => {
    expect(sanitizeNumericDraft("2.", { allowDecimal: true })).toBe("2.");
    expect(sanitizeNumericDraft("2.5", { allowDecimal: true })).toBe("2.5");
    expect(sanitizeNumericDraft("2.5.1", { allowDecimal: true })).toBe("2.51");
  });
});

describe("parseNumericDraft", () => {
  it("returns null for blank drafts instead of 0", () => {
    expect(parseNumericDraft("")).toBeNull();
    expect(parseNumericDraft("   ")).toBeNull();
    expect(parseNumericDraft(".")).toBeNull();
    expect(Number("")).toBe(0);
  });

  it("parses whole and fractional values", () => {
    expect(parseNumericDraft("15")).toBe(15);
    expect(parseNumericDraft("2.5")).toBe(2.5);
    expect(parseNumericDraft("0")).toBe(0);
  });
});

describe("validateRequiredNumericDraft", () => {
  it("asks for a value when blank — does not invent one", () => {
    expect(validateRequiredNumericDraft({ label: "a max weight difference in pounds", draft: "" })).toBe(
      "Enter a max weight difference in pounds.",
    );
  });

  it("checks bounds and half-minute steps", () => {
    expect(validateRequiredNumericDraft({ label: "round minutes", draft: "2.5", min: 1, max: 15, halfMinuteStep: true })).toBeNull();
    expect(validateRequiredNumericDraft({ label: "round minutes", draft: "2.25", min: 1, max: 15, halfMinuteStep: true })).toMatch(/half-minute/);
    expect(validateRequiredNumericDraft({ label: "rest seconds", draft: "60.5", integer: true })).toMatch(/whole number/);
  });
});

describe("formatNumericDraft", () => {
  it("round-trips loaded settings into editable drafts", () => {
    expect(formatNumericDraft(30)).toBe("30");
    expect(formatNumericDraft(2.5)).toBe("2.5");
  });
});
