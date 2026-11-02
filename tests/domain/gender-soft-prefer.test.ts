import { describe, expect, it } from "vitest";
import {
  GENDER_SOFT_BONUS,
  MIN_SAME_GENDER_POOL_FOR_BONUS,
  pairCompatibility,
  sameGenderVolunteerCount,
} from "@/lib/domain/scoring";
import { DEFAULT_SCORING_WEIGHTS, PROPOSED_MATCH_LIMITS, type SessionAthlete } from "@/lib/domain/types";

function athlete(
  id: string,
  opts: Partial<Pick<SessionAthlete, "weightLbs" | "skill" | "gender">> = {},
): SessionAthlete {
  return {
    athleteId: id,
    displayName: id,
    weightLbs: opts.weightLbs ?? 160,
    skill: opts.skill ?? 4,
    aggression: null,
    gender: opts.gender ?? null,
  };
}

describe("soft gender preference", () => {
  const limits = { ...PROPOSED_MATCH_LIMITS };
  const weights = { ...DEFAULT_SCORING_WEIGHTS };

  it("adds a small same-gender bonus when the pool is large enough", () => {
    const fighter = athlete("f", { gender: "FEMALE" });
    const same = athlete("v-same", { gender: "FEMALE" });
    const other = athlete("v-other", { gender: "MALE" });
    const sameScore = pairCompatibility(fighter, same, limits, weights, {
      sameGenderPoolSize: MIN_SAME_GENDER_POOL_FOR_BONUS,
    });
    const otherScore = pairCompatibility(fighter, other, limits, weights, {
      sameGenderPoolSize: MIN_SAME_GENDER_POOL_FOR_BONUS,
    });
    expect(sameScore - otherScore).toBeCloseTo(GENDER_SOFT_BONUS, 6);
  });

  it("does not prefer gender when either side is missing gender", () => {
    const fighter = athlete("f", { gender: "MALE" });
    const blank = athlete("v-blank", { gender: null });
    const withGender = athlete("v-m", { gender: "MALE" });
    const blankScore = pairCompatibility(fighter, blank, limits, weights, { sameGenderPoolSize: 3 });
    const base = pairCompatibility(fighter, withGender, limits, weights, { sameGenderPoolSize: 0 });
    expect(blankScore).toBe(base);
  });

  it("skips the bonus for a tiny same-gender pool", () => {
    const fighter = athlete("f", { gender: "FEMALE" });
    const only = athlete("v1", { gender: "FEMALE" });
    const mixed = athlete("v2", { gender: "MALE" });
    const tinySame = pairCompatibility(fighter, only, limits, weights, { sameGenderPoolSize: 1 });
    const tinyMixed = pairCompatibility(fighter, mixed, limits, weights, { sameGenderPoolSize: 1 });
    expect(tinySame).toBe(tinyMixed);
  });

  it("keeps weight difference more important than the gender bonus", () => {
    const fighter = athlete("f", { weightLbs: 160, skill: 4, gender: "FEMALE" });
    const sameFar = athlete("far", { weightLbs: 190, skill: 4, gender: "FEMALE" });
    const mixedClose = athlete("close", { weightLbs: 161, skill: 4, gender: "MALE" });
    const sameScore = pairCompatibility(fighter, sameFar, limits, weights, { sameGenderPoolSize: 3 });
    const mixedScore = pairCompatibility(fighter, mixedClose, limits, weights, { sameGenderPoolSize: 3 });
    expect(mixedScore).toBeGreaterThan(sameScore);
  });

  it("counts same-gender volunteers without inventing gender from names", () => {
    const fighter = athlete("Zahra", { gender: "FEMALE" });
    const pool = [
      athlete("Emma", { gender: "FEMALE" }),
      athlete("Malachi", { gender: null }),
      athlete("Mason", { gender: "MALE" }),
    ];
    expect(sameGenderVolunteerCount(fighter, pool)).toBe(1);
    expect(sameGenderVolunteerCount(athlete("x", { gender: null }), pool)).toBe(0);
  });
});
