import { describe, expect, it } from "vitest";
import { saturdayPresetSettings } from "@/lib/domain/types";
import type { Athlete, SessionRecord, StoredAssignment } from "@/lib/repository/types";
import { summarizeVolunteerAttendance } from "@/lib/services/volunteer-attendance";

function athlete(id: string, name = id): Athlete {
  return {
    athleteId: id,
    displayName: name,
    weightLbs: 150,
    skill: 4,
    aggression: null,
    roleEligibility: "BOTH",
    active: true,
    coachNotes: "",
    createdAt: "t",
    updatedAt: "t",
  };
}

function session(id: string, generationId: string): SessionRecord {
  return {
    sessionId: id,
    dateLocal: "2026-10-25",
    timezone: "America/New_York",
    status: "COMPLETED",
    revision: 1,
    activeGenerationId: generationId,
    currentBlockIndex: 1,
    settings: { ...saturdayPresetSettings(), timezone: "America/New_York" },
    createdBy: "coach",
    createdAt: "t",
    updatedBy: "coach",
    updatedAt: "t",
  };
}

function row(partial: Partial<StoredAssignment> & Pick<StoredAssignment, "assignmentId" | "sessionId" | "generationId" | "volunteerId">): StoredAssignment {
  return {
    fighterId: "f1",
    blockIndex: 1,
    location: "MAIN_RING",
    status: "COMPLETED",
    locked: false,
    updatedAt: "t",
    updatedBy: "coach",
    ...partial,
  };
}

describe("summarizeVolunteerAttendance", () => {
  it("counts completed volunteer work on the active generation only and sorts by helpfulness", () => {
    const sessions = [session("s1", "g-live"), session("s2", "g2")];
    const assignments = [
      row({ assignmentId: "a1", sessionId: "s1", generationId: "g-live", volunteerId: "v-star", status: "COMPLETED" }),
      row({ assignmentId: "a2", sessionId: "s1", generationId: "g-live", volunteerId: "v-star", status: "COMPLETED", blockIndex: 3, location: "FLOOR_1" }),
      row({ assignmentId: "old", sessionId: "s1", generationId: "g-old", volunteerId: "v-star", status: "COMPLETED" }),
      row({ assignmentId: "a3", sessionId: "s2", generationId: "g2", volunteerId: "v-star", status: "COMPLETED" }),
      row({ assignmentId: "a4", sessionId: "s2", generationId: "g2", volunteerId: "v-other", status: "COMPLETED" }),
      row({ assignmentId: "planned", sessionId: "s2", generationId: "g2", volunteerId: "v-other", status: "PLANNED", blockIndex: 2 }),
    ];
    const summary = summarizeVolunteerAttendance(sessions, assignments, [athlete("v-star", "Star"), athlete("v-other", "Other")]);
    expect(summary).toEqual([
      {
        athleteId: "v-star",
        displayName: "Star",
        sessionsHelped: 2,
        hardSessionsCompleted: 3,
        roundsCompleted: 6,
      },
      {
        athleteId: "v-other",
        displayName: "Other",
        sessionsHelped: 1,
        hardSessionsCompleted: 1,
        roundsCompleted: 2,
      },
    ]);
  });

  it("ignores people who only appeared as fighters", () => {
    const sessions = [session("s1", "g1")];
    const assignments = [row({ assignmentId: "a1", sessionId: "s1", generationId: "g1", volunteerId: "v1", fighterId: "fighter-only" })];
    const summary = summarizeVolunteerAttendance(sessions, assignments, [athlete("fighter-only"), athlete("v1", "Vol")]);
    expect(summary.map((row) => row.athleteId)).toEqual(["v1"]);
  });
});
