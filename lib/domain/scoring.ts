import { weightGap } from "./matchmaking";
import { countsAsHardSession, type Assignment, type MatchingLimits, type ScheduleInput, type ScoringWeights, type SessionAthlete } from "./types";

/** Higher is a closer match. This is a transparent sort key, not a medical score. */
export function pairCompatibility(
  fighter: SessionAthlete,
  volunteer: SessionAthlete,
  limits: MatchingLimits,
  weights: ScoringWeights,
): number {
  const gap = weightGap(fighter, volunteer);
  const wDen = Math.max(limits.maxWeightDifferenceLbs, 1e-6);
  const sDen = Math.max(limits.maxSkillDifference, 1);
  // Percent-of-lighter is not part of scoring (same as matchmaking).
  const weightNorm = gap.abs / wDen;
  const skillNorm = Math.abs(fighter.skill - volunteer.skill) / sDen;
  const penalty = weights.weight * weightNorm + weights.skill * skillNorm;
  return 1 - penalty;
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
    total += pairCompatibility(fighter, volunteer, input.limits, input.scoringWeights);
  }
  const loads = input.volunteers.map(
    (v) => counting.filter((a) => a.volunteerId === v.athleteId).length,
  );
  const mean = loads.reduce((sum, n) => sum + n, 0) / (loads.length || 1);
  const variance = loads.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (loads.length || 1);
  total -= Math.sqrt(variance) * 0.05;
  return Number(total.toFixed(6));
}
