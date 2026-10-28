import { describe, expect, it } from "vitest";
import {
  findMinimumFeasibleLimits,
  IGNORED_WEIGHT_PCT,
  MINIMUM_LIMITS_SELECTION_METHOD,
  normalizeMatchingLimits,
} from "@/lib/domain/minimum-feasible-limits";
import { evaluatePair } from "@/lib/domain/matchmaking";
import { pairCompatibility } from "@/lib/domain/scoring";
import { PROPOSED_MATCH_LIMITS, type ScheduleInput, type SessionAthlete } from "@/lib/domain/types";

function athlete(id: string, weight = 160, skill = 3): SessionAthlete {
  return { athleteId: id, displayName: id, weightLbs: weight, skill, aggression: null };
}

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    sessionId: "s-min",
    generationId: "g-min",
    fighters: [],
    volunteers: [],
    limits: { ...PROPOSED_MATCH_LIMITS },
    restrictions: [],
    overrides: [],
    fixedAssignments: [],
    requiredHardSessions: 3,
    maxVolunteerSessions: 3,
    restGapBlocks: 1,
    scoringWeights: { weight: 0.4, skill: 0.6, aggression: 0 },
    maxBlockHorizon: 12,
    ...overrides,
  };
}

describe("percent-of-lighter removal", () => {
  it("does not reject pairs that only fail an old saved percent limit", () => {
    const fighter = athlete("f", 100, 3);
    const volunteer = athlete("v", 114, 3); // 14 lb and 14%
    const decision = evaluatePair({
      sessionId: "s1",
      fighter,
      volunteer,
      limits: {
        maxWeightDifferenceLbs: 15,
        maxWeightDifferencePctOfLighterAthlete: 10,
        maxSkillDifference: 3,
        maxAggressionDifference: 1,
      },
      restrictions: [],
      overrides: [],
    });
    expect(decision.eligible).toBe(true);
    expect(decision.reasonCodes).not.toContain("WEIGHT_PCT");
  });

  it("scores pairs without using percent-of-lighter in the weight term", () => {
    const fighter = athlete("f", 100, 3);
    const close = athlete("v1", 110, 3);
    const far = athlete("v2", 150, 3);
    const limits = {
      maxWeightDifferenceLbs: 60,
      maxWeightDifferencePctOfLighterAthlete: 1, // would dominate if still used
      maxSkillDifference: 3,
      maxAggressionDifference: 1,
    };
    const weights = { weight: 1, skill: 0, aggression: 0 };
    expect(pairCompatibility(fighter, close, limits, weights)).toBeGreaterThan(
      pairCompatibility(fighter, far, limits, weights),
    );
    // Changing only the ignored pct must not change score.
    const samePctIgnored = pairCompatibility(
      fighter,
      close,
      { ...limits, maxWeightDifferencePctOfLighterAthlete: 100 },
      weights,
    );
    expect(samePctIgnored).toBe(pairCompatibility(fighter, close, limits, weights));
  });

  it("normalizeMatchingLimits forces the ignored percent sentinel", () => {
    expect(
      normalizeMatchingLimits({
        maxWeightDifferenceLbs: 40,
        maxWeightDifferencePctOfLighterAthlete: 12,
        maxSkillDifference: 2,
        maxAggressionDifference: 1,
      }).maxWeightDifferencePctOfLighterAthlete,
    ).toBe(IGNORED_WEIGHT_PCT);
  });
});

describe("findMinimumFeasibleLimits (joint skill-then-lbs)", () => {
  it("documents the joint selection method", () => {
    expect(MINIMUM_LIMITS_SELECTION_METHOD).toMatch(/skill/i);
    expect(MINIMUM_LIMITS_SELECTION_METHOD).toMatch(/lbs|lb/i);
    expect(MINIMUM_LIMITS_SELECTION_METHOD.toLowerCase()).toMatch(/joint|binary|0→6|0->6/);
  });

  it("returns a verified joint minimum for a workable pool", () => {
    const schedule = input({
      fighters: [1, 2, 3, 4, 5].map((n) => athlete(`f${n}`, 150 + n, 3)),
      volunteers: Array.from({ length: 15 }, (_, i) => athlete(`v${i + 1}`, 155 + (i % 3), 3)),
    });
    const result = findMinimumFeasibleLimits(schedule, {
      maxComputeMs: 12_000,
      probeComputeMs: 3_000,
      deterministicSeed: 5,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.method).toBe(MINIMUM_LIMITS_SELECTION_METHOD);
    expect(result.limits.maxWeightDifferencePctOfLighterAthlete).toBe(IGNORED_WEIGHT_PCT);
    expect(result.limits.maxSkillDifference).toBeGreaterThanOrEqual(0);
    expect(result.limits.maxSkillDifference).toBeLessThanOrEqual(6);
    expect(result.limits.maxWeightDifferenceLbs).toBeGreaterThanOrEqual(1);
    expect(result.limits.maxWeightDifferenceLbs).toBeLessThanOrEqual(100);
    // Uniform skill-3 pool should not need a skill gap above 0.
    expect(result.limits.maxSkillDifference).toBe(0);
  }, 60_000);

  it("needs a joint skill+lbs pair when weights and skills both vary", () => {
    const fighters = [
      athlete("f1", 120, 1),
      athlete("f2", 130, 2),
      athlete("f3", 145, 3),
      athlete("f4", 160, 4),
      athlete("f5", 175, 5),
    ];
    const volunteers = [
      athlete("v1", 125, 2),
      athlete("v2", 135, 3),
      athlete("v3", 150, 4),
      athlete("v4", 165, 5),
      athlete("v5", 180, 6),
      athlete("v6", 122, 1),
      athlete("v7", 140, 3),
      athlete("v8", 155, 4),
      athlete("v9", 170, 5),
      athlete("v10", 128, 2),
      athlete("v11", 148, 3),
      athlete("v12", 162, 4),
      athlete("v13", 118, 1),
      athlete("v14", 158, 4),
      athlete("v15", 172, 5),
    ];
    const result = findMinimumFeasibleLimits(input({ fighters, volunteers }), {
      maxComputeMs: 15_000,
      probeComputeMs: 4_000,
      deterministicSeed: 9,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    // Not independent mins: both axes come from one feasible solve pair.
    expect(result.limits.maxSkillDifference).toBeGreaterThanOrEqual(0);
    expect(result.limits.maxWeightDifferenceLbs).toBeGreaterThanOrEqual(1);
    // Re-check the returned pair is jointly feasible via assess path: skill-only 0 with tiny lbs would fail.
    expect(
      result.limits.maxSkillDifference > 0 || result.limits.maxWeightDifferenceLbs > 5,
    ).toBe(true);
  }, 90_000);

  it("explains structural blockers and never treats timeout as impossible", () => {
    const thin = findMinimumFeasibleLimits(
      input({
        fighters: [1, 2, 3, 4, 5].map((n) => athlete(`f${n}`)),
        volunteers: [1, 2, 3, 4].map((n) => athlete(`v${n}`)),
      }),
      { maxComputeMs: 4_000, probeComputeMs: 1_000, deterministicSeed: 2 },
    );
    expect(thin.status).toBe("impossible");
    if (thin.status === "impossible") {
      expect(thin.message.toLowerCase()).toMatch(/volunteer/);
      expect(thin.codes).toContain("INSUFFICIENT_TOTAL_VOLUNTEER_CAPACITY");
    }

    const timed = findMinimumFeasibleLimits(
      input({
        fighters: [1, 2, 3, 4, 5].map((n) => athlete(`f${n}`)),
        volunteers: Array.from({ length: 12 }, (_, i) => athlete(`v${i + 1}`)),
      }),
      { maxComputeMs: 1, probeComputeMs: 1, deterministicSeed: 44 },
    );
    expect(timed.status).not.toBe("impossible");
    if (timed.status === "inconclusive") {
      expect(timed.message.toLowerCase()).toMatch(/not proof|not.*impossible/);
    }
  });
});
