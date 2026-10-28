import { describe, expect, it } from "vitest";
import {
  assessMatchupFeasibility,
  practicalLimitCandidates,
} from "@/lib/domain/matchup-feasibility";
import { PROPOSED_MATCH_LIMITS, type MatchingLimits, type ScheduleInput, type SessionAthlete } from "@/lib/domain/types";

function athlete(id: string, weight = 160, skill = 3): SessionAthlete {
  return { athleteId: id, displayName: id, weightLbs: weight, skill, aggression: null };
}

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    sessionId: "s-feas",
    generationId: "g-feas",
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

const tight: MatchingLimits = {
  maxWeightDifferenceLbs: 1,
  maxWeightDifferencePctOfLighterAthlete: 1,
  maxSkillDifference: 0,
  maxAggressionDifference: 1,
};

describe("practicalLimitCandidates", () => {
  it("only proposes lb/skill increases and ignores percent", () => {
    const current = { ...PROPOSED_MATCH_LIMITS };
    const rows = practicalLimitCandidates(current);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.maxWeightDifferenceLbs).toBeGreaterThanOrEqual(current.maxWeightDifferenceLbs);
      expect(row.maxSkillDifference).toBeGreaterThanOrEqual(current.maxSkillDifference);
      expect(row.maxWeightDifferencePctOfLighterAthlete).toBe(100);
    }
  });
});

describe("assessMatchupFeasibility", () => {
  it("reports ok when current settings already support a complete schedule", () => {
    const schedule = input({
      fighters: [1, 2, 3, 4, 5].map((n) => athlete(`f${n}`)),
      volunteers: Array.from({ length: 15 }, (_, i) => athlete(`v${i + 1}`)),
      limits: { ...PROPOSED_MATCH_LIMITS },
    });
    const result = assessMatchupFeasibility(schedule, schedule.limits, {
      maxComputeMs: 12_000,
      probeComputeMs: 2_000,
      deterministicSeed: 7,
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.message).toBe("Current settings support a complete schedule.");
    }
  });

  it("says impossible when volunteer capacity cannot cover demand regardless of limits", () => {
    const schedule = input({
      fighters: [1, 2, 3, 4, 5].map((n) => athlete(`f${n}`)),
      // 5 fighters × 3 = 15 sessions; 4 volunteers × 3 = 12 capacity
      volunteers: [1, 2, 3, 4].map((n) => athlete(`v${n}`)),
      limits: { ...PROPOSED_MATCH_LIMITS },
    });
    const result = assessMatchupFeasibility(schedule, schedule.limits, {
      maxComputeMs: 4_000,
      probeComputeMs: 1_000,
      deterministicSeed: 3,
    });
    expect(result.status).toBe("impossible");
    if (result.status === "impossible") {
      expect(result.message.toLowerCase()).toMatch(/volunteer/);
      expect(result.message.toLowerCase()).not.toMatch(/impossible solely|timeout/);
      expect(result.codes).toContain("INSUFFICIENT_TOTAL_VOLUNTEER_CAPACITY");
    }
  });

  it("suggests looser lb/skill limits when tight thresholds block an otherwise workable pool", () => {
    const fighters = [
      athlete("f1", 120, 2),
      athlete("f2", 130, 2),
      athlete("f3", 140, 3),
      athlete("f4", 150, 3),
      athlete("f5", 160, 4),
    ];
    const volunteers = Array.from({ length: 15 }, (_, i) => athlete(`v${i + 1}`, 145 + (i % 5) * 5, 2 + (i % 4)));
    const schedule = input({ fighters, volunteers, limits: tight });
    const result = assessMatchupFeasibility(schedule, tight, {
      maxComputeMs: 8_000,
      probeComputeMs: 3_000,
      deterministicSeed: 11,
    });
    expect(result.status).toBe("needs_looser_limits");
    if (result.status === "needs_looser_limits") {
      expect(result.suggestion.maxWeightDifferenceLbs).toBeGreaterThanOrEqual(tight.maxWeightDifferenceLbs);
      expect(result.suggestion.maxSkillDifference).toBeGreaterThanOrEqual(tight.maxSkillDifference);
      expect(result.suggestion.maxWeightDifferencePctOfLighterAthlete).toBe(100);
      expect(
        result.suggestion.maxWeightDifferenceLbs > tight.maxWeightDifferenceLbs ||
          result.suggestion.maxSkillDifference > tight.maxSkillDifference,
      ).toBe(true);
      expect(result.message).toMatch(/practical increase|not a proven mathematical minimum/i);
      expect(result.message).not.toMatch(/% of lighter/i);
      expect(result.message).toMatch(/Save Session Settings/i);
    }
  }, 60_000);

  it("does not call a timeout an impossibility", () => {
    const schedule = input({
      fighters: [1, 2, 3, 4, 5].map((n) => athlete(`f${n}`)),
      volunteers: Array.from({ length: 12 }, (_, i) => athlete(`v${i + 1}`)),
      limits: { ...PROPOSED_MATCH_LIMITS },
    });
    const result = assessMatchupFeasibility(schedule, schedule.limits, {
      maxComputeMs: 1,
      probeComputeMs: 1,
      deterministicSeed: 99,
    });
    expect(result.status).not.toBe("impossible");
    if (result.status === "inconclusive") {
      expect(result.message.toLowerCase()).toMatch(/not proof|not.*impossible/);
    }
  });
});
