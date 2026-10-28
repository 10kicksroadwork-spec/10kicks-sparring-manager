import { evaluatePair } from "./matchmaking";
import type { Assignment, ScheduleInput, SessionAthlete } from "./types";
import { validateSchedule } from "./validator";

export type EligibleVolunteerOption = {
  volunteerId: string;
  displayName: string;
  current: boolean;
  reasons: string[];
};

/**
 * Volunteers who may replace the partner on one planned/unlocked match.
 * Pair limits, exclusions, rest, workload, double-booking, and locks elsewhere
 * are enforced by the same validator used after a swap. Coach choice among these
 * options is first-come / human judgment — algorithm preference is not applied.
 */
export function eligibleVolunteersForAssignment(
  input: ScheduleInput,
  assignments: Assignment[],
  assignmentId: string,
): EligibleVolunteerOption[] {
  const current = assignments.find((row) => row.assignmentId === assignmentId);
  if (!current) return [];
  if (current.locked || current.status !== "PLANNED") return [];

  const fighter = input.fighters.find((row) => row.athleteId === current.fighterId);
  if (!fighter) return [];

  const options: EligibleVolunteerOption[] = [];
  for (const volunteer of input.volunteers) {
    const option = optionIfEligible(input, assignments, current, fighter, volunteer);
    if (option) options.push(option);
  }
  return options.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

function optionIfEligible(
  input: ScheduleInput,
  assignments: Assignment[],
  current: Assignment,
  fighter: SessionAthlete,
  volunteer: SessionAthlete,
): EligibleVolunteerOption | null {
  const isCurrent = volunteer.athleteId === current.volunteerId;
  if (isCurrent) {
    return {
      volunteerId: volunteer.athleteId,
      displayName: volunteer.displayName,
      current: true,
      reasons: ["Current partner on this match."],
    };
  }

  const decision = evaluatePair({
    sessionId: input.sessionId,
    fighter,
    volunteer,
    limits: input.limits,
    restrictions: input.restrictions,
    overrides: input.overrides,
  });
  if (!decision.eligible) return null;

  const next: Assignment = {
    ...current,
    volunteerId: volunteer.athleteId,
    approvedNumericExceptionId: decision.overrideId,
  };
  const proposed = assignments.map((row) => (row.assignmentId === current.assignmentId ? next : row));
  const validation = validateSchedule(input, proposed);
  if (!validation.ok) return null;

  return {
    volunteerId: volunteer.athleteId,
    displayName: volunteer.displayName,
    current: false,
    reasons: decision.reasons,
  };
}
