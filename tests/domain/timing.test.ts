import { describe, expect, it } from "vitest";
import { estimateDuration, formatDuration } from "@/lib/domain/timing";
import { parseSettings } from "@/lib/sheets/rows";
import { PROPOSED_MATCH_LIMITS } from "@/lib/domain/types";
import { timingSchema } from "@/lib/schemas";

describe("session time estimate", () => {
  it("adds one rest between consecutive rounds, with no rest after the last round", () => {
    expect(estimateDuration(6, 2, { roundMinutes: 3, restSeconds: 60 })).toEqual({
      blockCount: 6, roundCount: 12, restCount: 11, totalSeconds: 2820,
    });
    expect(formatDuration(2820)).toBe("47 min");
    expect(formatDuration(3780)).toBe("1 hr 3 min");
  });
  it("counts simultaneous rings once and handles no blocks or zero rest", () => {
    expect(estimateDuration(0, 2, { roundMinutes: 3, restSeconds: 60 }).totalSeconds).toBe(0);
    expect(estimateDuration(1, 2, { roundMinutes: 2, restSeconds: 0 }).totalSeconds).toBe(240);
  });
  it("supports half-minute round lengths in estimates and the settings schema", () => {
    // 2 blocks × 2 rounds = 4 rounds at 2.5 min + 3 rests of 60s → 600 + 180 = 780
    expect(estimateDuration(2, 2, { roundMinutes: 2.5, restSeconds: 60 })).toEqual({
      blockCount: 2, roundCount: 4, restCount: 3, totalSeconds: 780,
    });
    expect(formatDuration(780)).toBe("13 min");
    expect(timingSchema.safeParse({ roundMinutes: 2.5, restSeconds: 60 }).success).toBe(true);
    expect(timingSchema.safeParse({ roundMinutes: 3.5, restSeconds: 0 }).success).toBe(true);
    expect(timingSchema.safeParse({ roundMinutes: 2.25, restSeconds: 60 }).success).toBe(false);
    expect(timingSchema.safeParse({ roundMinutes: 16, restSeconds: 60 }).success).toBe(false);
  });
  it("hydrates timing and limit defaults for older Supabase and Sheet sessions", () => {
    const old = parseSettings(JSON.stringify({ preset: "SATURDAY_THREE_HARD", limits: { maxWeightDifferenceLbs: 20 } }));
    expect("settings" in old && old.settings.timing).toEqual({ roundMinutes: 3, restSeconds: 60 });
    expect("settings" in old && old.settings.limits).toMatchObject({
      maxWeightDifferenceLbs: 20,
      maxWeightDifferencePctOfLighterAthlete: PROPOSED_MATCH_LIMITS.maxWeightDifferencePctOfLighterAthlete,
      maxSkillDifference: PROPOSED_MATCH_LIMITS.maxSkillDifference,
    });
    const blank = parseSettings(JSON.stringify({}));
    expect("settings" in blank && blank.settings.limits).toMatchObject(PROPOSED_MATCH_LIMITS);
    const updated = parseSettings(JSON.stringify({ timing: { roundMinutes: 2.5, restSeconds: 30 } }));
    expect("settings" in updated && updated.settings.timing).toEqual({ roundMinutes: 2.5, restSeconds: 30 });
  });
  it("rejects nonsensical timings", () => {
    expect(() => estimateDuration(-1, 2, { roundMinutes: 3, restSeconds: 60 })).toThrow(RangeError);
    expect(() => estimateDuration(6, 2, { roundMinutes: 0, restSeconds: 60 })).toThrow(RangeError);
    expect(() => estimateDuration(6, 2, { roundMinutes: 2.25, restSeconds: 60 })).toThrow(RangeError);
  });
});
