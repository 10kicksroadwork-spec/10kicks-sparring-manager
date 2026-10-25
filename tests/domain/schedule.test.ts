import { describe, expect, it } from "vitest";
import { evaluatePair } from "@/lib/domain/matchmaking";
import { solveSchedule } from "@/lib/domain/solver";
import {
  HARD_ROUNDS_PER_ASSIGNMENT,
  LOCATIONS,
  PROPOSED_LIMITS_NOTICE,
  PROPOSED_MATCH_LIMITS,
  countsAsCompletedTwoRoundSession,
  countsAsHardSession,
  type Assignment,
  type NumericOverride,
  type ScheduleInput,
  type SessionAthlete,
} from "@/lib/domain/types";
import { validateSchedule } from "@/lib/domain/validator";

function athlete(id: string, weight = 160, skill = 3, aggression = 3): SessionAthlete {
  return { athleteId: id, displayName: id, weightLbs: weight, skill, aggression };
}

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    sessionId: "s1",
    generationId: "g-new",
    fighters: [],
    volunteers: [],
    limits: { ...PROPOSED_MATCH_LIMITS },
    restrictions: [],
    overrides: [],
    fixedAssignments: [],
    requiredHardSessions: 3,
    maxVolunteerSessions: 2,
    restGapBlocks: 1,
    scoringWeights: { weight: 0.4, skill: 0.3, aggression: 0.3 },
    maxBlockHorizon: 12,
    ...overrides,
  };
}

function demoInput(): ScheduleInput {
  return input({
    fighters: [1, 2, 3, 4, 5].map((n) => athlete(`f${n}`)),
    volunteers: Array.from({ length: 15 }, (_, i) => athlete(`v${i + 1}`)),
  });
}

function solve(schedule: ScheduleInput, ms = 8000, seed = 1) {
  return solveSchedule(schedule, { maxComputeMs: ms, deterministicSeed: seed });
}

function override(partial: Partial<NumericOverride> = {}): NumericOverride {
  return {
    overrideId: "ov1",
    sessionId: "s1",
    fighterId: "f1",
    volunteerId: "v1",
    coachEmail: "coach@10kicks.test",
    reason: "Coach watched the first round and accepts the gap for this session only",
    acknowledgedAt: "2026-10-25T14:00:00.000Z",
    active: true,
    ...partial,
  };
}

describe("Saturday rules", () => {
  it("labels the numeric thresholds as pending coach review", () => {
    expect(PROPOSED_LIMITS_NOTICE.toLowerCase()).toContain("pending coach");
    expect(PROPOSED_LIMITS_NOTICE.toLowerCase()).toContain("not safety-certified");
    expect(PROPOSED_MATCH_LIMITS).toMatchObject({
      maxWeightDifferenceLbs: 15,
      maxWeightDifferencePctOfLighterAthlete: 10,
      maxSkillDifference: 1,
      maxAggressionDifference: 1,
    });
  });

  it("schedules 5 fighters and 15 volunteers in 6 blocks and fails when forced to 5", () => {
    const full = solve(demoInput());
    expect(full.status).toBe("FEASIBLE");
    if (full.status !== "FEASIBLE") return;
    expect(full.blockCount).toBe(6);
    expect(full.assignments).toHaveLength(15);
    expect(full.optimality).toBe("PROVEN");
    const validation = validateSchedule(demoInput(), full.assignments);
    expect(validation.ok).toBe(true);

    for (const fighterId of ["f1", "f2", "f3", "f4", "f5"]) {
      const mine = full.assignments.filter((a) => a.fighterId === fighterId);
      expect(mine).toHaveLength(3);
      expect(new Set(mine.map((a) => a.volunteerId)).size).toBe(3);
      expect(new Set(mine.map((a) => a.location))).toEqual(new Set(LOCATIONS));
      const blocks = mine.map((a) => a.blockIndex).sort((a, b) => a - b);
      expect(blocks[1] - blocks[0]).toBeGreaterThanOrEqual(2);
      expect(blocks[2] - blocks[1]).toBeGreaterThanOrEqual(2);
    }

    const byVolunteer = new Map<string, Assignment[]>();
    for (const assignment of full.assignments) {
      const list = byVolunteer.get(assignment.volunteerId) ?? [];
      list.push(assignment);
      byVolunteer.set(assignment.volunteerId, list);
    }
    for (const list of byVolunteer.values()) {
      expect(list.length).toBeLessThanOrEqual(2);
      expect(new Set(list.map((a) => a.fighterId)).size).toBe(list.length);
    }

    for (const assignment of full.assignments) {
      const sharing = full.assignments.filter(
        (other) =>
          other.blockIndex === assignment.blockIndex &&
          (other.fighterId === assignment.fighterId ||
            other.volunteerId === assignment.fighterId ||
            other.fighterId === assignment.volunteerId ||
            other.volunteerId === assignment.volunteerId),
      );
      expect(sharing).toHaveLength(1);
    }

    const blocked = solve(demoInput(), 8000, 1);
    const five = solve({ ...demoInput(), maxBlockHorizon: 5 });
    expect(five.status).toBe("UNSAT");
    if (five.status === "UNSAT") {
      expect(five.diagnostics.some((d) => d.code === "SEARCH_BUDGET_EXHAUSTED")).toBe(false);
    }
    expect(blocked.status).toBe("FEASIBLE");
  });

  it("does not count an interruption as a completed two-round session", () => {
    expect(HARD_ROUNDS_PER_ASSIGNMENT).toBe(2);
    expect(countsAsCompletedTwoRoundSession("COMPLETED")).toBe(true);
    expect(countsAsCompletedTwoRoundSession("INTERRUPTED")).toBe(false);
    expect(countsAsHardSession("INTERRUPTED")).toBe(false);
    expect(countsAsHardSession("PLANNED")).toBe(true);
  });

  it("enforces absolute weight and percent together", () => {
    const fighter = athlete("f1", 100);
    const heavyPercent = athlete("v1", 114);
    const withinBoth = athlete("v2", 200);
    const fighterHeavy = athlete("f2", 200);
    const absoluteMiss = athlete("v3", 166);
    const fighterMid = athlete("f3", 150);
    const limits = { ...PROPOSED_MATCH_LIMITS };
    const base = { sessionId: "s1", limits, restrictions: [], overrides: [] };

    expect(evaluatePair({ ...base, fighter, volunteer: heavyPercent }).eligible).toBe(false);
    expect(evaluatePair({ ...base, fighter: fighterHeavy, volunteer: athlete("v4", 214) }).reasonCodes).not.toContain("WEIGHT_LBS");
    expect(evaluatePair({ ...base, fighter: fighterHeavy, volunteer: athlete("v4", 214) }).eligible).toBe(true);
    expect(evaluatePair({ ...base, fighter: fighterMid, volunteer: absoluteMiss }).reasonCodes).toContain("WEIGHT_LBS");
    expect(evaluatePair({ ...base, fighter, volunteer: withinBoth }).eligible).toBe(false);
  });

  it("enforces skill and aggression independently", () => {
    const base = { sessionId: "s1", limits: { ...PROPOSED_MATCH_LIMITS }, restrictions: [], overrides: [] };
    const skill = evaluatePair({
      ...base,
      fighter: athlete("f1", 160, 1, 3),
      volunteer: athlete("v1", 160, 3, 3),
    });
    expect(skill.eligible).toBe(false);
    expect(skill.reasonCodes).toContain("SKILL");
    expect(skill.reasonCodes).not.toContain("AGGRESSION");

    const aggression = evaluatePair({
      ...base,
      fighter: athlete("f1", 160, 3, 1),
      volunteer: athlete("v1", 160, 3, 3),
    });
    expect(aggression.eligible).toBe(false);
    expect(aggression.reasonCodes).toContain("AGGRESSION");
    expect(aggression.reasonCodes).not.toContain("SKILL");
  });

  it("keeps a named exclusion even when a numeric exception is complete", () => {
    const decision = evaluatePair({
      sessionId: "s1",
      fighter: athlete("f1", 160, 1, 1),
      volunteer: athlete("v1", 200, 5, 5),
      limits: { ...PROPOSED_MATCH_LIMITS },
      restrictions: [
        { restrictionId: "r1", athleteAId: "v1", athleteBId: "f1", reason: "bad chemistry", active: true },
      ],
      overrides: [override({ volunteerId: "v1" })],
    });
    expect(decision.eligible).toBe(false);
    expect(decision.reasonCodes).toContain("EXPLICIT_EXCLUSION");
  });

  it("requires coach identity, reason, and acknowledgment on a numeric exception", () => {
    const args = {
      sessionId: "s1",
      fighter: athlete("f1", 150),
      volunteer: athlete("v1", 190),
      limits: { ...PROPOSED_MATCH_LIMITS },
      restrictions: [],
    };
    expect(evaluatePair({ ...args, overrides: [override({ reason: "  " })] }).eligible).toBe(false);
    expect(evaluatePair({ ...args, overrides: [override({ coachEmail: "" })] }).eligible).toBe(false);
    expect(evaluatePair({ ...args, overrides: [override({ acknowledgedAt: "" })] }).eligible).toBe(false);
    const allowed = evaluatePair({ ...args, overrides: [override()] });
    expect(allowed.eligible).toBe(true);
    expect(allowed.overrideId).toBe("ov1");
  });

  it("does not publish an empty fighter list", () => {
    const result = solve(input({ volunteers: [athlete("v1")] }));
    expect(result.status).toBe("UNSAT");
    if (result.status === "UNSAT") {
      expect(result.diagnostics.some((d) => d.code === "EMPTY_FIGHTER_ATTENDANCE")).toBe(true);
    }
  });

  it("reports volunteer capacity when 7 volunteers cannot cover 15 sessions", () => {
    const result = solve(
      input({
        fighters: [1, 2, 3, 4, 5].map((n) => athlete(`f${n}`)),
        volunteers: [1, 2, 3, 4, 5, 6, 7].map((n) => athlete(`v${n}`)),
      }),
    );
    expect(result.status).toBe("UNSAT");
    if (result.status === "UNSAT") {
      expect(result.diagnostics.some((d) => d.code === "INSUFFICIENT_TOTAL_VOLUNTEER_CAPACITY")).toBe(true);
    }
  });

  it("reports a fighter who has only two eligible volunteers", () => {
    const result = solve(
      input({
        fighters: [athlete("f1", 150)],
        volunteers: [athlete("v1", 150), athlete("v2", 150), athlete("v3", 220)],
      }),
    );
    expect(result.status).toBe("UNSAT");
    if (result.status === "UNSAT") {
      expect(result.diagnostics.some((d) => d.code === "INSUFFICIENT_ELIGIBLE_PARTNERS" && d.fighterId === "f1")).toBe(true);
    }
  });

  it("preserves completed and locked assignments", () => {
    const fixed: Assignment = {
      assignmentId: "fixed-1",
      sessionId: "s1",
      generationId: "g-old",
      blockIndex: 1,
      location: "MAIN_RING",
      fighterId: "f1",
      volunteerId: "v1",
      status: "COMPLETED",
      locked: true,
    };
    const locked: Assignment = {
      assignmentId: "locked-2",
      sessionId: "s1",
      generationId: "g-old",
      blockIndex: 2,
      location: "FLOOR_1",
      fighterId: "f2",
      volunteerId: "v2",
      status: "PLANNED",
      locked: true,
    };
    const schedule = input({
      fighters: [athlete("f1"), athlete("f2")],
      volunteers: [1, 2, 3, 4, 5, 6].map((n) => athlete(`v${n}`)),
      fixedAssignments: [fixed, locked],
    });
    const result = solve(schedule);
    expect(result.status).toBe("FEASIBLE");
    if (result.status !== "FEASIBLE") return;
    expect(result.assignments.find((a) => a.assignmentId === fixed.assignmentId)).toEqual(fixed);
    expect(result.assignments.find((a) => a.assignmentId === locked.assignmentId)).toEqual(locked);
    expect(validateSchedule(schedule, result.assignments).ok).toBe(true);
  });

  it("does not call a timed-out search unsatisfiable", () => {
    const result = solve(demoInput(), 0);
    expect(result.status).toBe("TIME_BUDGET_EXHAUSTED");
    if (result.status === "TIME_BUDGET_EXHAUSTED") {
      expect(result.diagnostics.some((d) => d.code === "SEARCH_BUDGET_EXHAUSTED")).toBe(true);
    }
  });

  it("is deterministic for the same seed and input", () => {
    const schedule = demoInput();
    const first = solve(schedule, 8000, 7);
    const second = solve(schedule, 8000, 7);
    expect(first.status).toBe("FEASIBLE");
    expect(second.status).toBe("FEASIBLE");
    if (first.status !== "FEASIBLE" || second.status !== "FEASIBLE") return;
    const key = (rows: Assignment[]) =>
      rows.map((a) => [a.blockIndex, a.location, a.fighterId, a.volunteerId, a.status, a.locked].join(":"));
    expect(key(first.assignments)).toEqual(key(second.assignments));
    expect(first.score).toBe(second.score);
  });

  it("rejects a same-block double booking and a both-role clash", () => {
    const schedule = input({
      fighters: [athlete("f1"), athlete("f2")],
      volunteers: [athlete("v1"), athlete("v2")],
    });
    const doubled: Assignment[] = [
      {
        assignmentId: "a",
        sessionId: "s1",
        generationId: "g",
        blockIndex: 1,
        location: "MAIN_RING",
        fighterId: "f1",
        volunteerId: "v1",
        status: "PLANNED",
        locked: false,
      },
      {
        assignmentId: "b",
        sessionId: "s1",
        generationId: "g",
        blockIndex: 1,
        location: "FLOOR_1",
        fighterId: "f1",
        volunteerId: "v2",
        status: "PLANNED",
        locked: false,
      },
    ];
    const validation = validateSchedule(schedule, doubled, { mode: "partial" });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.code === "ATHLETE_DOUBLE_BOOKED")).toBe(true);

    const clash = solve(
      input({
        fighters: [athlete("both")],
        volunteers: [athlete("both"), athlete("v2"), athlete("v3")],
      }),
    );
    expect(clash.status).toBe("UNSAT");
    if (clash.status === "UNSAT") {
      expect(clash.diagnostics.some((d) => d.code === "ROLE_CONFLICT" || d.code === "FIXED_ASSIGNMENT_CONFLICT")).toBe(true);
    }
  });

  it("passes every feasible fuzz candidate through the validator", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const weightA = 150 + (seed % 5);
      const weightB = 150 + ((seed * 3) % 5);
      const schedule = input({
        sessionId: `fuzz-${seed}`,
        generationId: `g-${seed}`,
        fighters: [athlete("f1", weightA, 3, 3), athlete("f2", weightB, 3, 3)],
        volunteers: [1, 2, 3, 4, 5, 6].map((n) => athlete(`v${n}`, 150 + (n % 3), 3, 3)),
        restrictions:
          seed % 17 === 0
            ? [{ restrictionId: "rx", athleteAId: "f1", athleteBId: "v1", reason: "hold", active: true }]
            : [],
        maxBlockHorizon: 8,
      });
      const result = solve(schedule, 2000, seed);
      if (result.status === "FEASIBLE") {
        const validation = validateSchedule(schedule, result.assignments);
        expect(validation.ok, JSON.stringify(validation.errors)).toBe(true);
      }
      if (result.status === "UNSAT") {
        expect(result.diagnostics.some((d) => d.code === "SEARCH_BUDGET_EXHAUSTED")).toBe(false);
      }
    }
  });
});
