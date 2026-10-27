import { describe, expect, it } from "vitest";
import { estimateDuration, formatDuration } from "@/lib/domain/timing";
import { parseSettings } from "@/lib/sheets/rows";

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
  it("hydrates timing defaults for older Supabase and Sheet sessions", () => {
    const old = parseSettings(JSON.stringify({ preset: "SATURDAY_THREE_HARD", limits: { maxWeightDifferenceLbs: 20 } }));
    expect("settings" in old && old.settings.timing).toEqual({ roundMinutes: 3, restSeconds: 60 });
    const updated = parseSettings(JSON.stringify({ timing: { roundMinutes: 2, restSeconds: 30 } }));
    expect("settings" in updated && updated.settings.timing).toEqual({ roundMinutes: 2, restSeconds: 30 });
  });
  it("rejects nonsensical timings", () => {
    expect(() => estimateDuration(-1, 2, { roundMinutes: 3, restSeconds: 60 })).toThrow(RangeError);
    expect(() => estimateDuration(6, 2, { roundMinutes: 0, restSeconds: 60 })).toThrow(RangeError);
  });
});
