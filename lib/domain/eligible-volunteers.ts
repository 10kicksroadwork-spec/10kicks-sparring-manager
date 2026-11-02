import { evaluatePair } from "./matchmaking";
import { pairCompatibility } from "./scoring";
import type { Assignment, ConflictDiagnostic, ScheduleInput, SessionAthlete } from "./types";
import { validateSchedule } from "./validator";

export type SwapVolunteerGroup = "recommended" | "other";

export type EligibleVolunteerOption = {
  volunteerId: string;
  displayName: string;
  current: boolean;
  /**
   * Always true for the dropdown — coach may select Recommended or All Other.
   * Brief conflict notes stay in `reasons` as hints; the API hard-blocks only
   * truly illegal cases (same-block double-book, prohibited pairing, etc.).
   */
  available: boolean;
  group: SwapVolunteerGroup;
  reasons: string[];
};

/**
 * All checked-in volunteers for one planned/unlocked match, in two groups:
 * Recommended (clean fits, ranking algorithm) then All Other (alphabetical).
 * Everyone is selectable. Soft conflicts are hint notes only.
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
  const scored: Array<EligibleVolunteerOption & { score: number; clean: boolean }> = [];
  for (const volunteer of input.volunteers) {
    scored.push(optionForVolunteer(input, assignments, current, fighter, volunteer, sameGenderPool));
  }

  const recommended = scored
    .filter((row) => row.clean)
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.displayName.localeCompare(b.displayName);
    })
    .map((row) => ({ ...row, group: "recommended" as const, available: true }));

  const recommendedIds = new Set(recommended.map((row) => row.volunteerId));
  const other = scored
    .filter((row) => !recommendedIds.has(row.volunteerId))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((row) => ({ ...row, group: "other" as const, available: true }));

  return [...recommended, ...other].map((row) => ({
    volunteerId: row.volunteerId,
    displayName: row.displayName,
    current: row.current,
    available: true,
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
): EligibleVolunteerOption & { score: number; clean: boolean } {
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
      clean: true,
    };
  }

  if ((input.unavailableIds ?? []).includes(volunteer.athleteId)) {
    return hinted(volunteer, score, "Not available this block.");
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
    return hinted(volunteer, score, briefPairReason(decision.reasons));
  }

  const next: Assignment = {
    ...current,
    volunteerId: volunteer.athleteId,
    approvedNumericExceptionId: decision.overrideId,
  };
  const proposed = assignments.map((row) => (row.assignmentId === current.assignmentId ? next : row));
  const validation = validateSchedule(input, proposed, { mode: "partial" });
  if (!validation.ok) {
    return hinted(volunteer, score, briefValidationReason(validation.errors, volunteer.athleteId, current.assignmentId));
  }

  return {
    volunteerId: volunteer.athleteId,
    displayName: volunteer.displayName,
    current: false,
    available: true,
    group: "recommended",
    reasons: decision.reasons,
    score,
    clean: true,
  };
}

function hinted(volunteer: SessionAthlete, score: number, reason: string): EligibleVolunteerOption & { score: number; clean: boolean } {
  return {
    volunteerId: volunteer.athleteId,
    displayName: volunteer.displayName,
    current: false,
    available: true,
    group: "other",
    reasons: [reason],
    score,
    clean: false,
  };
}

function briefPairReason(reasons: string[]): string {
  const joined = reasons.join(" ");
  if (/exclusion|cannot be paired/i.test(joined)) return "Prohibited pairing.";
  if (/weight/i.test(joined)) return "Outside weight limit.";
  if (/skill/i.test(joined)) return "Outside skill limit.";
  if (/exception/i.test(joined)) return "Numeric exception incomplete.";
  return reasons[0] ?? "Note for coach.";
}

function briefValidationReason(errors: ConflictDiagnostic[], volunteerId: string, assignmentId: string): string {
  const relevant =
    errors.find((row) => row.volunteerId === volunteerId || row.assignmentId === assignmentId) ?? errors[0];
  if (!relevant) return "Note for coach.";
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
      return /weight/i.test(relevant.message)
        ? "Outside weight limit."
        : /skill/i.test(relevant.message)
          ? "Outside skill limit."
          : "Outside match limits.";
    default:
      return relevant.message.length > 72 ? `${relevant.message.slice(0, 69)}…` : relevant.message;
  }
}
