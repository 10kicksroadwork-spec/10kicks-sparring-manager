import { describe, expect, it } from "vitest";
import { eligibleVolunteersForAssignment } from "@/lib/domain/eligible-volunteers";
import { DEFAULT_SCORING_WEIGHTS, PROPOSED_MATCH_LIMITS, type Assignment, type ScheduleInput, type SessionAthlete } from "@/lib/domain/types";

function athlete(id: string, weight = 150, skill = 4): SessionAthlete {
  return { athleteId: id, displayName: id, weightLbs: weight, skill, aggression: null };
}

function assignment(partial: Partial<Assignment> & Pick<Assignment, "assignmentId" | "fighterId" | "volunteerId" | "blockIndex" | "location">): Assignment {
  return {
    sessionId: "s1",
    generationId: "g1",
    status: "PLANNED",
    locked: false,
    approvedNumericExceptionId: undefined,
    ...partial,
  };
}

function input(fighters: SessionAthlete[], volunteers: SessionAthlete[], fixed: Assignment[] = []): ScheduleInput {
  return {
    sessionId: "s1",
    generationId: "g1",
    fighters,
    volunteers,
    limits: { ...PROPOSED_MATCH_LIMITS },
    restrictions: [],
    overrides: [],
    fixedAssignments: fixed,
    requiredHardSessions: 3,
    maxVolunteerSessions: 2,
    restGapBlocks: 1,
    scoringWeights: DEFAULT_SCORING_WEIGHTS,
    maxBlockHorizon: 12,
    unavailableIds: [],
  };
}

/**
 * Two fighters (<5 → two mats, location repeats allowed). Each gets 3 hard sessions
 * with rest gap 1. Volunteers stay at or under the max of 2.
 */
function twoFighterBoard(extraVolunteers: SessionAthlete[] = []) {
  const fighters = [athlete("f1"), athlete("f2")];
  const volunteers = [athlete("v1"), athlete("v2"), athlete("v3"), athlete("v4"), athlete("v5"), ...extraVolunteers];
  const rows = [
    assignment({ assignmentId: "a1", fighterId: "f1", volunteerId: "v1", blockIndex: 1, location: "MAIN_RING" }),
    assignment({ assignmentId: "a2", fighterId: "f2", volunteerId: "v2", blockIndex: 1, location: "FLOOR_1" }),
    assignment({ assignmentId: "a3", fighterId: "f1", volunteerId: "v2", blockIndex: 3, location: "FLOOR_1" }),
    assignment({ assignmentId: "a4", fighterId: "f2", volunteerId: "v1", blockIndex: 3, location: "MAIN_RING" }),
    assignment({ assignmentId: "a5", fighterId: "f1", volunteerId: "v3", blockIndex: 5, location: "MAIN_RING" }),
    assignment({ assignmentId: "a6", fighterId: "f2", volunteerId: "v4", blockIndex: 5, location: "FLOOR_1" }),
  ];
  return { fighters, volunteers, rows };
}

describe("eligibleVolunteersForAssignment", () => {
  it("lists every checked-in volunteer with recommended and other groups", () => {
    const heavy = athlete("v-heavy", 250);
    const { fighters, volunteers, rows } = twoFighterBoard([heavy]);
    const options = eligibleVolunteersForAssignment(input(fighters, volunteers), rows, "a5");
    // a5 is f1/v3 in block 5. Available: current v3 + free v5. Others stay listed disabled.
    expect(options.map((row) => row.volunteerId).sort()).toEqual(["v-heavy", "v1", "v2", "v3", "v4", "v5"]);
    const recommended = options.filter((row) => row.group === "recommended");
    expect(recommended.map((row) => row.volunteerId)).toEqual(["v3", "v5"]);
    expect(recommended.every((row) => row.available)).toBe(true);
    expect(options.find((row) => row.volunteerId === "v-heavy")).toMatchObject({
      group: "other",
      available: false,
    });
    expect(options.find((row) => row.volunteerId === "v4")?.available).toBe(false);
    expect(options.find((row) => row.volunteerId === "v4")?.reasons[0]).toMatch(/booked|cap|paired|rest/i);
  });

  it("keeps a same-block volunteer visible but unavailable", () => {
    const { fighters, volunteers, rows } = twoFighterBoard();
    const options = eligibleVolunteersForAssignment(input(fighters, volunteers), rows, "a1");
    expect(options.some((row) => row.volunteerId === "v1" && row.current && row.available)).toBe(true);
    const booked = options.find((row) => row.volunteerId === "v2");
    expect(booked).toBeTruthy();
    expect(booked?.available).toBe(false);
    expect(booked?.group).toBe("other");
  });

  it("returns nothing for locked or completed matches", () => {
    const { fighters, volunteers, rows } = twoFighterBoard();
    const locked = rows.map((row) => (row.assignmentId === "a1" ? { ...row, locked: true } : row));
    const done = rows.map((row) => (row.assignmentId === "a1" ? { ...row, status: "COMPLETED" as const } : row));
    expect(eligibleVolunteersForAssignment(input(fighters, volunteers), locked, "a1")).toEqual([]);
    expect(eligibleVolunteersForAssignment(input(fighters, volunteers), done, "a1")).toEqual([]);
  });
});
