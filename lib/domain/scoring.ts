import { weightGap } from "./matchmaking";
import {
  countsAsHardSession,
  type Assignment,
  type MatchingLimits,
  type ScheduleInput,
  type ScoringWeights,
  type SessionAthlete,
} from "./types";

/**
 * Slight same-gender preference when weight/skill are close.
 * Kept small so lb, skill, availability, and caps dominate.
 * Skipped when the same-gender volunteer pool is tiny (avoids over-concentration).
 */
export const GENDER_SOFT_BONUS = 0.025;
export const MIN_SAME_GENDER_POOL_FOR_BONUS = 2;

export function sameGenderVolunteerCount(fighter: SessionAthlete, volunteers: SessionAthlete[]): number {
  if (!fighter.gender) return 0;
  return volunteers.filter((row) => row.gender && row.gender === fighter.gender).length;
}

/** Higher is a closer match. This is a transparent sort key, not a medical score. */
export function pairCompatibility(
  fighter: SessionAthlete,
  volunteer: SessionAthlete,
  limits: MatchingLimits,
  weights: ScoringWeights,
  options?: { sameGenderPoolSize?: number },
): number {
  const gap = weightGap(fighter, volunteer);
  const wDen = Math.max(limits.maxWeightDifferenceLbs, 1e-6);
  const sDen = Math.max(limits.maxSkillDifference, 1);
  // Percent-of-lighter is not part of scoring (same as matchmaking).
  const weightNorm = gap.abs / wDen;
  const skillNorm = Math.abs(fighter.skill - volunteer.skill) / sDen;
  const penalty = weights.weight * weightNorm + weights.skill * skillNorm;
  let score = 1 - penalty;

  const pool = options?.sameGenderPoolSize ?? MIN_SAME_GENDER_POOL_FOR_BONUS;
  if (
    fighter.gender &&
    volunteer.gender &&
    fighter.gender === volunteer.gender &&
    pool >= MIN_SAME_GENDER_POOL_FOR_BONUS
  ) {
    score += GENDER_SOFT_BONUS;
  }
  return score;
}

export function scoreSchedule(input: ScheduleInput, assignments: Assignment[]): number {
  const fighters = new Map(input.fighters.map((f) => [f.athleteId, f]));
  const volunteers = new Map(input.volunteers.map((v) => [v.athleteId, v]));
  let total = 0;
  const counting = assignments.filter((a) => countsAsHardSession(a.status));
  for (const assignment of counting) {
    const fighter = fighters.get(assignment.fighterId);
    const volunteer = volunteers.get(assignment.volunteerId);
    if (!fighter || !volunteer) continue;
    const pool = sameGenderVolunteerCount(fighter, input.volunteers);
    total += pairCompatibility(fighter, volunteer, input.limits, input.scoringWeights, { sameGenderPoolSize: pool });
  }
  const loads = input.volunteers.map(
    (v) => counting.filter((a) => a.volunteerId === v.athleteId).length,
  );
  const mean = loads.reduce((sum, n) => sum + n, 0) / (loads.length || 1);
  const variance = loads.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (loads.length || 1);
  total -= Math.sqrt(variance) * 0.05;
  return Number(total.toFixed(6));
}
