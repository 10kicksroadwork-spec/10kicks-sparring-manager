import type { MatchingLimits, SessionAthlete } from "./types";

/** Checked-in person used only for coach-facing limit examples. */
export type LimitExampleAthlete = Pick<SessionAthlete, "displayName" | "weightLbs" | "skill">;

/**
 * Partner weight window for one athlete under both absolute-lb and % of lighter rules.
 * Both limits must pass, so the window is the intersection of the two constraints.
 */
export function partnerWeightRangeLbs(
  athleteWeightLbs: number,
  maxWeightDifferenceLbs: number,
  maxWeightDifferencePctOfLighterAthlete: number,
): { minLbs: number; maxLbs: number } {
  const w = athleteWeightLbs;
  const abs = Math.max(0, maxWeightDifferenceLbs);
  const pct = Math.max(0, maxWeightDifferencePctOfLighterAthlete);
  const byLbsMin = w - abs;
  const byLbsMax = w + abs;
  const factor = 1 + pct / 100;
  // Heavier partner: lighter is W → max = W * (1 + pct/100)
  const byPctMax = w * factor;
  // Lighter partner V: lighter is V → (W - V) / V * 100 <= pct → V >= W / (1 + pct/100)
  const byPctMin = factor > 0 ? w / factor : Number.POSITIVE_INFINITY;
  return {
    minLbs: Math.max(byLbsMin, byPctMin),
    maxLbs: Math.min(byLbsMax, byPctMax),
  };
}

export function skillBand(skill: number, maxSkillDifference: number): { minSkill: number; maxSkill: number } {
  const gap = Math.max(0, Math.floor(maxSkillDifference));
  return {
    minSkill: Math.max(1, skill - gap),
    maxSkill: Math.min(7, skill + gap),
  };
}

export type WeightLimitExplanation = {
  kind: "weight";
  athleteName: string;
  athleteWeightLbs: number;
  minPartnerLbs: number;
  maxPartnerLbs: number;
  text: string;
};

export type SkillLimitExplanation = {
  kind: "skill";
  athleteName: string;
  athleteSkill: number;
  minSkill: number;
  maxSkill: number;
  text: string;
};

function formatLbs(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Lightest checked-in fighter drives the weight example; both lb and % limits apply. */
export function explainWeightLimits(
  fighters: LimitExampleAthlete[],
  limits: Pick<MatchingLimits, "maxWeightDifferenceLbs" | "maxWeightDifferencePctOfLighterAthlete">,
): WeightLimitExplanation | null {
  if (fighters.length === 0) return null;
  const lightest = fighters.reduce((best, row) => (row.weightLbs < best.weightLbs ? row : best));
  const range = partnerWeightRangeLbs(
    lightest.weightLbs,
    limits.maxWeightDifferenceLbs,
    limits.maxWeightDifferencePctOfLighterAthlete,
  );
  return {
    kind: "weight",
    athleteName: lightest.displayName,
    athleteWeightLbs: lightest.weightLbs,
    minPartnerLbs: range.minLbs,
    maxPartnerLbs: range.maxLbs,
    text:
      `Both weight limits must pass. With ${lightest.displayName} at ${formatLbs(lightest.weightLbs)} lb ` +
      `(lightest checked-in fighter), partners must be between ${formatLbs(range.minLbs)} and ${formatLbs(range.maxLbs)} lb ` +
      `under ${formatLbs(limits.maxWeightDifferenceLbs)} lb and ${formatLbs(limits.maxWeightDifferencePctOfLighterAthlete)}% of the lighter person.`,
  };
}

/** Lowest-skill checked-in fighter drives the skill example. */
export function explainSkillLimits(
  fighters: LimitExampleAthlete[],
  limits: Pick<MatchingLimits, "maxSkillDifference">,
): SkillLimitExplanation | null {
  if (fighters.length === 0) return null;
  const lowest = fighters.reduce((best, row) => (row.skill < best.skill ? row : best));
  const band = skillBand(lowest.skill, limits.maxSkillDifference);
  return {
    kind: "skill",
    athleteName: lowest.displayName,
    athleteSkill: lowest.skill,
    minSkill: band.minSkill,
    maxSkill: band.maxSkill,
    text:
      `With ${lowest.displayName} at skill ${lowest.skill} (lowest among checked-in fighters), ` +
      `partners must be skill ${band.minSkill}–${band.maxSkill} under a max skill difference of ${limits.maxSkillDifference}.`,
  };
}
