/** Draft helpers for mobile-friendly numeric fields (blank while editing). */

export type NumericDraftOptions = {
  /** When true, allow one `.` and fractional digits (e.g. 2.5). */
  allowDecimal?: boolean;
};

/**
 * Keep only characters that can form a non-negative number draft.
 * Empty string and a lone trailing `.` are allowed so clearing / typing decimals works on mobile.
 */
export function sanitizeNumericDraft(raw: string, options: NumericDraftOptions = {}): string {
  const allowDecimal = options.allowDecimal ?? false;
  let cleaned = "";
  let sawDot = false;
  for (const char of raw) {
    if (char >= "0" && char <= "9") {
      cleaned += char;
      continue;
    }
    if (allowDecimal && char === "." && !sawDot) {
      cleaned += char;
      sawDot = true;
    }
  }
  return cleaned;
}

/** Parse a draft; blank or incomplete drafts ("" / ".") yield null — never coerce to 0. */
export function parseNumericDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (trimmed === "" || trimmed === ".") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function formatNumericDraft(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(value);
}

export type NumericDraftCheck = {
  label: string;
  draft: string;
  min?: number;
  max?: number;
  integer?: boolean;
  halfMinuteStep?: boolean;
};

function isHalfMinuteStep(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 2 - Math.round(value * 2)) < 1e-9;
}

/** Validate a required numeric draft. Returns a short message, or null when valid. Does not invent a value. */
export function validateRequiredNumericDraft(check: NumericDraftCheck): string | null {
  const parsed = parseNumericDraft(check.draft);
  if (parsed === null) return `Enter ${check.label}.`;
  if (check.integer && !Number.isInteger(parsed)) return `${check.label} must be a whole number.`;
  if (check.halfMinuteStep && !isHalfMinuteStep(parsed)) {
    return `${check.label} must be in half-minute steps (1, 1.5, …).`;
  }
  if (typeof check.min === "number" && parsed < check.min) {
    return `${check.label} must be at least ${check.min}.`;
  }
  if (typeof check.max === "number" && parsed > check.max) {
    return `${check.label} must be at most ${check.max}.`;
  }
  return null;
}
