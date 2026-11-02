import { evaluatePair } from "./matchmaking";
import { pairCompatibility } from "./scoring";
import type { Assignment, ConflictDiagnostic, ScheduleInput, SessionAthlete } from "./types";
import { validateSchedule } from "./validator";

export type SwapVolunteerGroup = "recommended" | "other";

export type EligibleVolunteerOption = {
  volunteerId: string;
  displayName: string;
  current: boolean;
  /** False when the coach cannot apply this swap (hard conflict). Still listed. */
  available: boolean;
  group: SwapVolunteerGroup;
  reasons: string[];
};

/**
 * All checked-in volunteers for one planned/unlocked match, in two groups:
 * Recommended (ranking algorithm) then All Other (alphabetical).
 * Unavailable people stay visible and disabled with a brief reason.
 * Weight/skill may still pass via an existing numeric override; double-booking,
 * volunteer caps, duplicate pairings, and prohibited pairings stay hard blocks.
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

  const sameGenderPool = sameGenderVolunteerPool(fighter, input.volunteers);
  const scored: Array<EligibleVolunteerOption & { score: number }> = [];
  for (const volunteer of input.volunteers) {
    scored.push(optionForVolunteer(input, assignments, current, fighter, volunteer, sameGenderPool));
  }

  const recommended = scored
    .filter((row) => row.available)
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.displayName.localeCompare(b.displayName);
    })
    .map((row) => ({ ...row, group: "recommended" as const }));

  const recommendedIds = new Set(recommended.map((row) => row.volunteerId));
  const other = scored
    .filter((row) => !recommendedIds.has(row.volunteerId))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((row) => ({ ...row, group: "other" as const }));

  return [...recommended, ...other].map((row) => ({
    volunteerId: row.volunteerId,
    displayName: row.displayName,
    current: row.current,
    available: row.available,
    group: row.group,
    reasons: row.reasons,
  }));
}

function sameGenderVolunteerPool(fighter: SessionAthlete, volunteers: SessionAthlete[]): number {
  if (!fighter.gender) return 0;
  return volunteers.filter((row) => row.gender && row.gender === fighter.gender).length;
}

function optionForVolunteer(
  input: ScheduleInput,
  assignments: Assignment[],
  current: Assignment,
  fighter: SessionAthlete,
  volunteer: SessionAthlete,
  sameGenderPoolSize: number,
): EligibleVolunteerOption & { score: number } {
  const score = pairCompatibility(fighter, volunteer, input.limits, input.scoringWeights, { sameGenderPoolSize });
  const isCurrent = volunteer.athleteId === current.volunteerId;
  if (isCurrent) {
    return {
      volunteerId: volunteer.athleteId,
      displayName: volunteer.displayName,
      current: true,
      available: true,
      group: "recommended",
      reasons: ["Current partner on this match."],
      score,
    };
  }

  if ((input.unavailableIds ?? []).includes(volunteer.athleteId)) {
    return unavailable(volunteer, score, "Not available this block.");
  }

  const decision = evaluatePair({
    sessionId: input.sessionId,
    fighter,
    volunteer,
    limits: input.limits,
    restrictions: input.restrictions,
    overrides: input.overrides,
  });
  if (!decision.eligible) {
    return unavailable(volunteer, score, briefPairReason(decision.reasons));
  }

  const next: Assignment = {
    ...current,
    volunteerId: volunteer.athleteId,
    approvedNumericExceptionId: decision.overrideId,
  };
  const proposed = assignments.map((row) => (row.assignmentId === current.assignmentId ? next : row));
  const validation = validateSchedule(input, proposed, { mode: "partial" });
  if (!validation.ok) {
    return unavailable(volunteer, score, briefValidationReason(validation.errors, volunteer.athleteId, current.assignmentId));
  }

  return {
    volunteerId: volunteer.athleteId,
    displayName: volunteer.displayName,
    current: false,
    available: true,
    group: "recommended",
    reasons: decision.reasons,
    score,
  };
}

function unavailable(volunteer: SessionAthlete, score: number, reason: string): EligibleVolunteerOption & { score: number } {
  return {
    volunteerId: volunteer.athleteId,
    displayName: volunteer.displayName,
    current: false,
    available: false,
    group: "other",
    reasons: [reason],
    score,
  };
}

function briefPairReason(reasons: string[]): string {
  const joined = reasons.join(" ");
  if (/exclusion|cannot be paired/i.test(joined)) return "Prohibited pairing.";
  if (/weight/i.test(joined)) return "Outside weight limit.";
  if (/skill/i.test(joined)) return "Outside skill limit.";
  if (/exception/i.test(joined)) return "Numeric exception incomplete.";
  return reasons[0] ?? "Not eligible.";
}

function briefValidationReason(errors: ConflictDiagnostic[], volunteerId: string, assignmentId: string): string {
  const relevant =
    errors.find((row) => row.volunteerId === volunteerId || row.assignmentId === assignmentId) ?? errors[0];
  if (!relevant) return "Conflicts with this card.";
  switch (relevant.code) {
    case "ATHLETE_DOUBLE_BOOKED":
      return "Already booked this block.";
    case "VOLUNTEER_MAX_EXCEEDED":
      return "At volunteer session cap.";
    case "VOLUNTEER_SAME_FIGHTER":
    case "DUPLICATE_PAIRING":
      return "Already paired with this fighter.";
    case "REST_SPACING_CONFLICT":
      return "Needs rest between blocks.";
    case "EXPLICIT_EXCLUSION":
      return "Prohibited pairing.";
    case "NUMERIC_LIMIT":
      return /weight/i.test(relevant.message) ? "Outside weight limit." : /skill/i.test(relevant.message) ? "Outside skill limit." : "Outside match limits.";
    default:
      return relevant.message.length > 72 ? `${relevant.message.slice(0, 69)}…` : relevant.message;
  }
}
