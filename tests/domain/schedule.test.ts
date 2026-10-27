import { describe, expect, it } from "vitest";
import { evaluatePair } from "@/lib/domain/matchmaking";
import { solveSchedule } from "@/lib/domain/solver";
import {
  HARD_ROUNDS_PER_ASSIGNMENT,
  LOCATIONS,
  PROPOSED_MATCH_LIMITS,
  countsAsCompletedTwoRoundSession,
  countsAsHardSession,
  locationLabel,
  type Assignment,
  type NumericOverride,
  type ScheduleInput,
  type SessionAthlete,
} from "@/lib/domain/types";
import {
  isContiguousLeftPack,
  leftPackPenalty,
  sortPlansByLeftPack,
} from "@/lib/domain/location-packing";
import { validateSchedule } from "@/lib/domain/validator";
import { canCoverWithoutVolunteerReuse } from "@/lib/domain/volunteer-load";

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
    scoringWeights: { weight: 0.4, skill: 0.6, aggression: 0 },
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

function solve(schedule: ScheduleInput, ms = 15_000, seed = 1) {
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
  it("accepts skill 7 with no aggression and blocks a bad skill or missing weight", () => {
    const ready = validateSchedule(
      input({
        fighters: [{ athleteId: "f", displayName: "Ready", weightLbs: 190, skill: 7, aggression: null }],
      }),
      [],
      { mode: "partial" },
    );
    expect(ready.errors.some((error) => error.code === "INCOMPLETE_PROFILE")).toBe(false);

    const missingWeight = validateSchedule(
      input({
        fighters: [{ athleteId: "f", displayName: "Directory", weightLbs: 0, skill: 7, aggression: null }],
      }),
      [],
      { mode: "partial" },
    );
    expect(missingWeight.ok).toBe(false);
    expect(missingWeight.errors.some((error) => error.code === "INCOMPLETE_PROFILE" && error.message.includes("weight"))).toBe(true);

    const skill = validateSchedule(
      input({
        fighters: [{ athleteId: "f", displayName: "High", weightLbs: 190, skill: 8, aggression: null }],
      }),
      [],
      { mode: "partial" },
    );
    expect(skill.errors.some((error) => error.code === "INCOMPLETE_PROFILE" && error.message.includes("1 to 7"))).toBe(true);
  });

  it("uses the configured weight and skill thresholds", () => {
    expect(PROPOSED_MATCH_LIMITS).toMatchObject({
      maxWeightDifferenceLbs: 60,
      maxWeightDifferencePctOfLighterAthlete: 50,
      maxSkillDifference: 3,
      maxAggressionDifference: 1,
    });
  });

  it("schedules 5 fighters and 15 volunteers in ~6 blocks, one block per volunteer", () => {
    const full = solve(demoInput());
    expect(full.status).toBe("FEASIBLE");
    if (full.status !== "FEASIBLE") return;
    // Left packing within blocks must not inflate the card; prior proven length is 6.
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

    expect(canCoverWithoutVolunteerReuse(demoInput())).toBe(true);
    const byVolunteer = new Map<string, Assignment[]>();
    for (const assignment of full.assignments) {
      const list = byVolunteer.get(assignment.volunteerId) ?? [];
      list.push(assignment);
      byVolunteer.set(assignment.volunteerId, list);
    }
    for (const list of byVolunteer.values()) {
      // 15 volunteers cover 15 hard sessions — solver must not reuse anyone.
      expect(list.length).toBe(1);
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

  it("uses two locations when fewer than five fighters are checked in", () => {
    const schedule = input({
      fighters: [1, 2, 3, 4].map((n) => athlete(`f${n}`)),
      volunteers: Array.from({ length: 12 }, (_, i) => athlete(`v${i + 1}`)),
    });
    const result = solve(schedule);
    expect(result.status).toBe("FEASIBLE");
    if (result.status !== "FEASIBLE") return;
    expect(new Set(result.assignments.map((row) => row.location))).toEqual(new Set(["MAIN_RING", "FLOOR_1"]));
    expect(result.assignments.some((row) => row.location === "FLOOR_2")).toBe(false);
    const byBlock = new Map<number, number>();
    for (const row of result.assignments) {
      byBlock.set(row.blockIndex, (byBlock.get(row.blockIndex) ?? 0) + 1);
    }
    for (const [block, count] of byBlock) {
      expect(count).toBeLessThanOrEqual(2);
      const locs = result.assignments.filter((row) => row.blockIndex === block).map((row) => row.location);
      expect(locs).toContain("MAIN_RING");
    }
    expect(validateSchedule(schedule, result.assignments).ok).toBe(true);
  }, 20_000);

  it("allows volunteer reuse up to 2 when the pool is too thin for single-block use", () => {
    const schedule = input({
      fighters: [1, 2, 3, 4, 5].map((n) => athlete(`f${n}`)),
      volunteers: Array.from({ length: 10 }, (_, i) => athlete(`v${i + 1}`)),
    });
    expect(canCoverWithoutVolunteerReuse(schedule)).toBe(false);
    const result = solve(schedule, 12_000);
    expect(result.status).toBe("FEASIBLE");
    if (result.status !== "FEASIBLE") return;
    const byVolunteer = new Map<string, number>();
    for (const row of result.assignments) {
      byVolunteer.set(row.volunteerId, (byVolunteer.get(row.volunteerId) ?? 0) + 1);
    }
    expect(Math.max(...byVolunteer.values())).toBeGreaterThan(1);
    expect(Math.max(...byVolunteer.values())).toBeLessThanOrEqual(2);
    expect(result.blockCount).toBeLessThanOrEqual(6);
  }, 20_000);

  it("packs two matches in a three-location block onto Main ring and Back Mat (Front open)", () => {
    // Coach Block-4 annotation: Main Open | Back | Front → shift to Main | Back | Front Open.
    expect(isContiguousLeftPack(["FLOOR_1", "FLOOR_2"], [...LOCATIONS])).toBe(false);
    expect(isContiguousLeftPack(["MAIN_RING", "FLOOR_1"], [...LOCATIONS])).toBe(true);
    expect(isContiguousLeftPack(["MAIN_RING", "FLOOR_2"], [...LOCATIONS])).toBe(false);
    expect(isContiguousLeftPack(["MAIN_RING", "FLOOR_1", "FLOOR_2"], [...LOCATIONS])).toBe(true);

    const ranked = sortPlansByLeftPack(
      [
        ["FLOOR_1", "FLOOR_2"],
        ["MAIN_RING", "FLOOR_1"],
        ["MAIN_RING", "FLOOR_2"],
      ],
      [...LOCATIONS],
    );
    expect(new Set(ranked[0])).toEqual(new Set(["MAIN_RING", "FLOOR_1"]));
    expect(leftPackPenalty(["MAIN_RING", "FLOOR_1"], [...LOCATIONS])).toBeLessThan(
      leftPackPenalty(["FLOOR_1", "FLOOR_2"], [...LOCATIONS]),
    );

    const full = solve(demoInput());
    expect(full.status).toBe("FEASIBLE");
    if (full.status !== "FEASIBLE") return;
    expect(full.blockCount).toBe(6);
    for (const block of new Set(full.assignments.map((row) => row.blockIndex))) {
      const rows = full.assignments.filter((row) => row.blockIndex === block);
      const locs = rows.map((row) => row.location);
      const set = new Set(locs);
      if (locs.length === 3) {
        expect(set).toEqual(new Set(LOCATIONS));
      }
      // Main + Front with Back open is only OK when neither fighter can still take Back Mat.
      if (locs.length === 2 && set.has("MAIN_RING") && set.has("FLOOR_2") && !set.has("FLOOR_1")) {
        for (const row of rows) {
          const elsewhere = full.assignments.filter(
            (other) => other.fighterId === row.fighterId && other.blockIndex !== block,
          );
          expect(elsewhere.some((other) => other.location === "FLOOR_1")).toBe(true);
        }
      }
      // Floor1+Floor2 without Main is only OK when neither fighter can still take Main.
      if (locs.length === 2 && set.has("FLOOR_1") && set.has("FLOOR_2") && !set.has("MAIN_RING")) {
        for (const row of rows) {
          const elsewhere = full.assignments.filter(
            (other) => other.fighterId === row.fighterId && other.blockIndex !== block,
          );
          expect(elsewhere.some((other) => other.location === "MAIN_RING")).toBe(true);
        }
      }
    }
  });

  it("warns when a volunteer is reused even though the pool was large enough", () => {
    const schedule = input({
      fighters: [athlete("f1"), athlete("f2")],
      volunteers: [1, 2, 3, 4, 5, 6].map((n) => athlete(`v${n}`)),
    });
    const reused: Assignment[] = [
      {
        assignmentId: "a1",
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
        assignmentId: "a2",
        sessionId: "s1",
        generationId: "g",
        blockIndex: 1,
        location: "FLOOR_1",
        fighterId: "f2",
        volunteerId: "v2",
        status: "PLANNED",
        locked: false,
      },
      {
        assignmentId: "a3",
        sessionId: "s1",
        generationId: "g",
        blockIndex: 3,
        location: "FLOOR_1",
        fighterId: "f1",
        volunteerId: "v3",
        status: "PLANNED",
        locked: false,
      },
      {
        assignmentId: "a4",
        sessionId: "s1",
        generationId: "g",
        blockIndex: 3,
        location: "MAIN_RING",
        fighterId: "f2",
        volunteerId: "v1",
        status: "PLANNED",
        locked: false,
      },
      {
        assignmentId: "a5",
        sessionId: "s1",
        generationId: "g",
        blockIndex: 5,
        location: "MAIN_RING",
        fighterId: "f1",
        volunteerId: "v4",
        status: "PLANNED",
        locked: false,
      },
      {
        assignmentId: "a6",
        sessionId: "s1",
        generationId: "g",
        blockIndex: 5,
        location: "FLOOR_1",
        fighterId: "f2",
        volunteerId: "v5",
        status: "PLANNED",
        locked: false,
      },
    ];
    const validation = validateSchedule(schedule, reused);
    expect(validation.ok).toBe(true);
    expect(validation.warnings.some((w) => w.code === "VOLUNTEER_REUSE_WHEN_AVOIDABLE" && w.volunteerId === "v1")).toBe(
      true,
    );
  });

  it("labels FLOOR_1/FLOOR_2 as Back Mat and Front Mat for coaches", () => {
    expect(locationLabel("MAIN_RING")).toBe("Main ring");
    expect(locationLabel("FLOOR_1")).toBe("Back Mat");
    expect(locationLabel("FLOOR_2")).toBe("Front Mat");
  });

  it("does not count an interruption as a completed two-round session", () => {
    expect(HARD_ROUNDS_PER_ASSIGNMENT).toBe(2);
    expect(countsAsCompletedTwoRoundSession("COMPLETED")).toBe(true);
    expect(countsAsCompletedTwoRoundSession("INTERRUPTED")).toBe(false);
    expect(countsAsHardSession("INTERRUPTED")).toBe(false);
    expect(countsAsHardSession("PLANNED")).toBe(true);
  });

  it("enforces absolute weight and percent together", () => {
    // Fixture limits stay tight so AND-of-both-weight-rules stays observable; session defaults are looser.
    const limits = {
      maxWeightDifferenceLbs: 15,
      maxWeightDifferencePctOfLighterAthlete: 10,
      maxSkillDifference: 1,
      maxAggressionDifference: 1,
    };
    const fighter = athlete("f1", 100);
    const heavyPercent = athlete("v1", 114);
    const withinBoth = athlete("v2", 200);
    const fighterHeavy = athlete("f2", 200);
    const absoluteMiss = athlete("v3", 166);
    const fighterMid = athlete("f3", 150);
    const base = { sessionId: "s1", limits, restrictions: [], overrides: [] };

    expect(evaluatePair({ ...base, fighter, volunteer: heavyPercent }).eligible).toBe(false);
    expect(evaluatePair({ ...base, fighter: fighterHeavy, volunteer: athlete("v4", 214) }).reasonCodes).not.toContain("WEIGHT_LBS");
    expect(evaluatePair({ ...base, fighter: fighterHeavy, volunteer: athlete("v4", 214) }).eligible).toBe(true);
    expect(evaluatePair({ ...base, fighter: fighterMid, volunteer: absoluteMiss }).reasonCodes).toContain("WEIGHT_LBS");
    expect(evaluatePair({ ...base, fighter, volunteer: withinBoth }).eligible).toBe(false);
  });

  it("enforces skill and ignores aggression", () => {
    const base = {
      sessionId: "s1",
      limits: { ...PROPOSED_MATCH_LIMITS, maxSkillDifference: 1 },
      restrictions: [],
      overrides: [],
    };
    const skill = evaluatePair({
      ...base,
      fighter: athlete("f1", 160, 1, 3),
      volunteer: athlete("v1", 160, 3, 3),
    });
    expect(skill.eligible).toBe(false);
    expect(skill.reasonCodes).toContain("SKILL");

    const aggression = evaluatePair({
      ...base,
      fighter: athlete("f1", 160, 3, 1),
      volunteer: athlete("v1", 160, 3, 5),
    });
    expect(aggression.eligible).toBe(true);
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
      limits: {
        maxWeightDifferenceLbs: 15,
        maxWeightDifferencePctOfLighterAthlete: 10,
        maxSkillDifference: 1,
        maxAggressionDifference: 1,
      },
      restrictions: [],
    };
    expect(evaluatePair({ ...args, overrides: [override({ reason: "  " })] }).eligible).toBe(false);
    expect(evaluatePair({ ...args, overrides: [override({ coachEmail: "" })] }).eligible).toBe(false);
    expect(evaluatePair({ ...args, overrides: [override({ acknowledgedAt: "" })] }).eligible).toBe(false);
    const allowed = evaluatePair({ ...args, overrides: [override()] });
    expect(allowed.eligible).toBe(true);
    expect(allowed.overrideId).toBe("ov1");
  });

  it("asks for volunteers instead of pairing fighters with themselves", () => {
    const result = solve(
      input({
        fighters: [1, 2, 3, 4, 5].map((n) => athlete(`f${n}`)),
        volunteers: [],
      }),
    );
    expect(result.status).toBe("UNSAT");
    if (result.status !== "UNSAT") return;
    expect(result.diagnostics.some((d) => d.code === "EMPTY_VOLUNTEER_ATTENDANCE")).toBe(true);
    expect(result.diagnostics.some((d) => /themselves/i.test(d.message))).toBe(true);
    expect("assignments" in result).toBe(false);
  });

  it("refuses a person who is listed as both fighter and volunteer", () => {
    const result = solve(
      input({
        fighters: [athlete("same")],
        volunteers: [athlete("same"), athlete("v1")],
      }),
    );
    expect(result.status).toBe("UNSAT");
    if (result.status !== "UNSAT") return;
    expect(result.diagnostics.some((d) => d.code === "ROLE_CONFLICT")).toBe(true);
    expect("assignments" in result).toBe(false);
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
    // 220 vs 150 is 70 lb (fails the 60 lb default) even though 46.7% is under the 50% default.
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

  it("still surfaces zero-eligible diagnostics at the loose default limits", () => {
    const result = solve(
      input({
        fighters: [athlete("f1", 120, 1)],
        volunteers: [athlete("v1", 300, 7), athlete("v2", 310, 7)],
      }),
    );
    expect(result.status).toBe("UNSAT");
    if (result.status === "UNSAT") {
      const zero = result.diagnostics.find((d) => d.code === "INSUFFICIENT_ELIGIBLE_PARTNERS" && d.fighterId === "f1");
      expect(zero).toBeTruthy();
      expect(zero?.details).toMatchObject({ eligible: 0, needed: 3 });
      expect(zero?.message).toMatch(/0 eligible/);
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
      blockIndex: 3,
      location: "MAIN_RING",
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
