import { describe, expect, it } from "vitest";
import { coachSwapWarningMessages, HARD_COACH_SWAP_CODES, partitionCoachSwapDiagnostics } from "@/lib/domain/coach-swap";
import { diagnostic } from "@/lib/domain/diagnostics";

describe("coach swap hard vs soft", () => {
  it("treats double-booking and prohibited pairing as hard", () => {
    expect(HARD_COACH_SWAP_CODES.has("ATHLETE_DOUBLE_BOOKED")).toBe(true);
    expect(HARD_COACH_SWAP_CODES.has("EXPLICIT_EXCLUSION")).toBe(true);
    expect(HARD_COACH_SWAP_CODES.has("VOLUNTEER_MAX_EXCEEDED")).toBe(false);
    expect(HARD_COACH_SWAP_CODES.has("NUMERIC_LIMIT")).toBe(false);
    expect(HARD_COACH_SWAP_CODES.has("REST_SPACING_CONFLICT")).toBe(false);
  });

  it("partitions soft conflicts for warn-and-allow", () => {
    const { hard, soft } = partitionCoachSwapDiagnostics([
      diagnostic("ATHLETE_DOUBLE_BOOKED", "Already booked this block."),
      diagnostic("VOLUNTEER_MAX_EXCEEDED", "At volunteer session cap."),
      diagnostic("NUMERIC_LIMIT", "Outside weight limit."),
    ]);
    expect(hard.map((row) => row.code)).toEqual(["ATHLETE_DOUBLE_BOOKED"]);
    expect(soft.map((row) => row.code)).toEqual(["VOLUNTEER_MAX_EXCEEDED", "NUMERIC_LIMIT"]);
    expect(coachSwapWarningMessages(soft)).toEqual(["At volunteer session cap.", "Outside weight limit."]);
  });
});
