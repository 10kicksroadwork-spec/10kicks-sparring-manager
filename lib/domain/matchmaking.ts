import { pairKey, type MatchingLimits, type NumericOverride, type Restriction, type SessionAthlete } from "./types";

export type PairReasonCode =
  | "WEIGHT_LBS"
  | "WEIGHT_PCT"
  | "SKILL"
  | "EXPLICIT_EXCLUSION"
  | "INVALID_OVERRIDE"
  | "NUMERIC_EXCEPTION_APPLIED";

export type PairDecision = {
  eligible: boolean;
  reasonCodes: PairReasonCode[];
  reasons: string[];
  overrideId?: string;
};

function activeRestriction(
  restrictions: Restriction[],
  a: string,
  b: string,
): Restriction | undefined {
  const key = pairKey(a, b);
  return restrictions.find((r) => r.active && pairKey(r.athleteAId, r.athleteBId) === key);
}

function matchingOverride(
  overrides: NumericOverride[],
  sessionId: string,
  fighterId: string,
  volunteerId: string,
): NumericOverride | undefined {
  return overrides.find(
    (o) =>
      o.active &&
      o.sessionId === sessionId &&
      o.fighterId === fighterId &&
      o.volunteerId === volunteerId,
  );
}

export function overrideIsComplete(o: NumericOverride | undefined): o is NumericOverride {
  if (!o) return false;
  return Boolean(o.overrideId.trim() && o.coachEmail.trim() && o.reason.trim() && o.acknowledgedAt.trim());
}

export function weightGap(a: SessionAthlete, b: SessionAthlete): { abs: number; pctOfLighter: number } {
  const abs = Math.abs(a.weightLbs - b.weightLbs);
  const lighter = Math.min(a.weightLbs, b.weightLbs);
  const pctOfLighter = lighter > 0 ? (abs / lighter) * 100 : Number.POSITIVE_INFINITY;
  return { abs, pctOfLighter };
}

/**
 * Decide whether a fighter/volunteer pair may hard spar.
 * Absolute weight, relative weight, and skill must all pass.
 * Aggression is not a limit. A complete one-session override may waive numeric limits only.
 * An active named exclusion always loses.
 */
export function evaluatePair(args: {
  sessionId: string;
  fighter: SessionAthlete;
  volunteer: SessionAthlete;
  limits: MatchingLimits;
  restrictions: Restriction[];
  overrides: NumericOverride[];
}): PairDecision {
  const { fighter, volunteer, limits } = args;
  const reasons: string[] = [];
  const reasonCodes: PairReasonCode[] = [];

  const excluded = activeRestriction(args.restrictions, fighter.athleteId, volunteer.athleteId);
  if (excluded) {
    reasons.push(
      `Named exclusion: ${fighter.displayName} and ${volunteer.displayName} cannot be paired${excluded.reason ? ` (${excluded.reason})` : ""}. An exception cannot override this.`,
    );
    reasonCodes.push("EXPLICIT_EXCLUSION");
    return { eligible: false, reasonCodes, reasons };
  }

  const gap = weightGap(fighter, volunteer);
  const weightLbsOk = gap.abs <= limits.maxWeightDifferenceLbs + 1e-9;
  const weightPctOk = gap.pctOfLighter <= limits.maxWeightDifferencePctOfLighterAthlete + 1e-9;
  const skillOk = Math.abs(fighter.skill - volunteer.skill) <= limits.maxSkillDifference;

  if (!weightLbsOk) {
    reasonCodes.push("WEIGHT_LBS");
    reasons.push(
      `Weight gap is ${gap.abs.toFixed(1)} lb, above the ${limits.maxWeightDifferenceLbs} lb limit.`,
    );
  }
  if (!weightPctOk) {
    reasonCodes.push("WEIGHT_PCT");
    reasons.push(
      `Weight gap is ${gap.pctOfLighter.toFixed(1)}% of the lighter athlete, above the ${limits.maxWeightDifferencePctOfLighterAthlete}% limit.`,
    );
  }
  if (!skillOk) {
    reasonCodes.push("SKILL");
    reasons.push(
      `Skill gap is ${Math.abs(fighter.skill - volunteer.skill)}, above the maximum of ${limits.maxSkillDifference}.`,
    );
  }

  if (reasonCodes.length === 0) {
    return { eligible: true, reasonCodes, reasons: ["Within the current numeric limits."] };
  }

  const override = matchingOverride(args.overrides, args.sessionId, fighter.athleteId, volunteer.athleteId);
  if (override && !overrideIsComplete(override)) {
    reasonCodes.push("INVALID_OVERRIDE");
    reasons.push("A numeric exception is missing the coach email, reason, or acknowledgment time, so it was not applied.");
    return { eligible: false, reasonCodes, reasons };
  }
  if (overrideIsComplete(override)) {
    return {
      eligible: true,
      reasonCodes: ["NUMERIC_EXCEPTION_APPLIED"],
      reasons: [
        `Numeric limits waived for this session only by ${override.coachEmail.trim()}: ${override.reason.trim()}. Named exclusions and scheduling rules still apply.`,
      ],
      overrideId: override.overrideId,
    };
  }

  return { eligible: false, reasonCodes, reasons };
}
