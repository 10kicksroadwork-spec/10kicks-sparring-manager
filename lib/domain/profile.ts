/** Roster ratings. Skill is 1–7 so the gym sheet is preserved. Aggression may be stored and is not required. */

export const SKILL_MIN = 1;
export const SKILL_MAX = 7;
export const AGGRESSION_MIN = 1;
export const AGGRESSION_MAX = 5;

export type MatchProfile = {
  weightLbs: number | null;
  skill: number | null;
};

function ratingOk(value: number | null, min: number, max: number): boolean {
  return value !== null && Number.isInteger(value) && value >= min && value <= max;
}

export function isReadyForHardMatch(person: MatchProfile): boolean {
  const weightOk = person.weightLbs !== null && Number.isFinite(person.weightLbs) && person.weightLbs > 0 && person.weightLbs <= 500;
  return weightOk && ratingOk(person.skill, SKILL_MIN, SKILL_MAX);
}
