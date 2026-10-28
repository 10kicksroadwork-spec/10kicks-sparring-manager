import { solveSchedule } from "./solver";
import type { ConflictCode, MatchingLimits, ScheduleInput, SolveResult } from "./types";

const MAX_LIMITS: MatchingLimits = {
  maxWeightDifferenceLbs: 100,
  maxWeightDifferencePctOfLighterAthlete: 100,
  maxSkillDifference: 6,
  maxAggressionDifference: 4,
};

/** Failures that relaxing weight/skill limits cannot fix. */
const STRUCTURAL_CODES: ReadonlySet<ConflictCode> = new Set([
  "INSUFFICIENT_TOTAL_VOLUNTEER_CAPACITY",
  "EMPTY_FIGHTER_ATTENDANCE",
  "EMPTY_VOLUNTEER_ATTENDANCE",
  "ROLE_CONFLICT",
  "FIXED_ASSIGNMENT_CONFLICT",
  "INPUT_INVALID",
  "INCOMPLETE_PROFILE",
]);

export type LimitSuggestion = {
  maxWeightDifferenceLbs: number;
  maxWeightDifferencePctOfLighterAthlete: number;
  maxSkillDifference: number;
};

export type MatchupFeasibility =
  | {
      status: "ok";
      message: "Current settings support a complete schedule.";
    }
  | {
      status: "impossible";
      message: string;
      codes: ConflictCode[];
    }
  | {
      status: "needs_looser_limits";
      message: string;
      suggestion: LimitSuggestion;
      codes: ConflictCode[];
    }
  | {
      status: "inconclusive";
      message: string;
    };

export type FeasibilityOptions = {
  /** Budget for the primary solve at current limits. */
  maxComputeMs?: number;
  /** Budget for each probe while searching suggestions. */
  probeComputeMs?: number;
  deterministicSeed?: number;
};

function withLimits(input: ScheduleInput, limits: MatchingLimits): ScheduleInput {
  return {
    ...input,
    limits: {
      ...input.limits,
      ...limits,
      maxAggressionDifference: input.limits.maxAggressionDifference,
    },
  };
}

function codesOf(result: SolveResult): ConflictCode[] {
  if (result.status === "FEASIBLE") return [];
  return result.diagnostics.map((row) => row.code);
}

function isFeasible(result: SolveResult): boolean {
  return result.status === "FEASIBLE";
}

function isTimeout(result: SolveResult): boolean {
  return result.status === "TIME_BUDGET_EXHAUSTED";
}

function hasStructuralFailure(codes: ConflictCode[]): boolean {
  return codes.some((code) => STRUCTURAL_CODES.has(code));
}

function clampLimits(limits: MatchingLimits): MatchingLimits {
  return {
    maxWeightDifferenceLbs: Math.min(100, Math.max(1, Math.round(limits.maxWeightDifferenceLbs * 2) / 2)),
    maxWeightDifferencePctOfLighterAthlete: Math.min(
      100,
      Math.max(1, Math.round(limits.maxWeightDifferencePctOfLighterAthlete * 2) / 2),
    ),
    maxSkillDifference: Math.min(6, Math.max(0, Math.round(limits.maxSkillDifference))),
    maxAggressionDifference: limits.maxAggressionDifference,
  };
}

function bumpScore(from: MatchingLimits, to: MatchingLimits): number {
  const lbs = Math.max(0, to.maxWeightDifferenceLbs - from.maxWeightDifferenceLbs);
  const pct = Math.max(0, to.maxWeightDifferencePctOfLighterAthlete - from.maxWeightDifferencePctOfLighterAthlete);
  const skill = Math.max(0, to.maxSkillDifference - from.maxSkillDifference);
  // Prefer smaller total movement; skill steps cost more than a half-pound tick.
  return lbs * 2 + pct * 2 + skill * 20;
}

function formatSuggestion(suggestion: LimitSuggestion): string {
  return (
    `Try about ${suggestion.maxWeightDifferenceLbs} lb, ` +
    `${suggestion.maxWeightDifferencePctOfLighterAthlete}% of lighter, ` +
    `and skill difference ${suggestion.maxSkillDifference}. ` +
    `This is a practical increase from the current settings — not a proven mathematical minimum. Save Session Settings to apply.`
  );
}

function structuralMessage(codes: ConflictCode[], diagnostics: { code: ConflictCode; message: string }[]): string {
  if (codes.includes("INSUFFICIENT_TOTAL_VOLUNTEER_CAPACITY")) {
    const row = diagnostics.find((item) => item.code === "INSUFFICIENT_TOTAL_VOLUNTEER_CAPACITY");
    return (
      row?.message ??
      "Not enough volunteer capacity for a complete schedule. Raising weight or skill limits will not fix that — check in more volunteers."
    );
  }
  if (codes.includes("EMPTY_VOLUNTEER_ATTENDANCE")) {
    return "No volunteers are checked in. Raising match limits cannot create a schedule until volunteers are present.";
  }
  if (codes.includes("EMPTY_FIGHTER_ATTENDANCE")) {
    return "No fighters are checked in. Check fighters in before adjusting match limits.";
  }
  if (codes.includes("ROLE_CONFLICT")) {
    return "Someone is checked in as both fighter and volunteer. Fix roles before match limits can help.";
  }
  const first = diagnostics.find((item) => STRUCTURAL_CODES.has(item.code));
  return first?.message ?? "A complete schedule is not possible with this check-in, even if match limits are widened.";
}

/**
 * Candidate limit sets ordered by practical bump size from `current`.
 * Coarse steps keep probe count bounded; not an exhaustive minimum search.
 */
export function practicalLimitCandidates(current: MatchingLimits): MatchingLimits[] {
  const base = clampLimits(current);
  const seen = new Set<string>();
  const out: MatchingLimits[] = [];

  function push(next: MatchingLimits) {
    const clamped = clampLimits(next);
    if (
      clamped.maxWeightDifferenceLbs < base.maxWeightDifferenceLbs ||
      clamped.maxWeightDifferencePctOfLighterAthlete < base.maxWeightDifferencePctOfLighterAthlete ||
      clamped.maxSkillDifference < base.maxSkillDifference
    ) {
      return;
    }
    if (
      clamped.maxWeightDifferenceLbs === base.maxWeightDifferenceLbs &&
      clamped.maxWeightDifferencePctOfLighterAthlete === base.maxWeightDifferencePctOfLighterAthlete &&
      clamped.maxSkillDifference === base.maxSkillDifference
    ) {
      return;
    }
    const key = `${clamped.maxWeightDifferenceLbs}|${clamped.maxWeightDifferencePctOfLighterAthlete}|${clamped.maxSkillDifference}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clamped);
  }

  const skillSteps = [0, 1, 2, 3, 4, 5, 6].map((d) => Math.min(6, base.maxSkillDifference + d));
  const lbsSteps = [0, 5, 10, 15, 25, 40, 60, 100].map((d) => Math.min(100, base.maxWeightDifferenceLbs + d));
  const pctSteps = [0, 5, 10, 15, 25, 40, 60, 100].map((d) =>
    Math.min(100, base.maxWeightDifferencePctOfLighterAthlete + d),
  );

  for (const skill of skillSteps) {
    for (const lbs of lbsSteps) {
      for (const pct of pctSteps) {
        push({
          maxWeightDifferenceLbs: lbs,
          maxWeightDifferencePctOfLighterAthlete: pct,
          maxSkillDifference: skill,
          maxAggressionDifference: base.maxAggressionDifference,
        });
      }
    }
  }

  push({ ...MAX_LIMITS, maxAggressionDifference: base.maxAggressionDifference });
  out.sort((a, b) => bumpScore(base, a) - bumpScore(base, b));
  return out;
}

/**
 * Run existing scheduling/solver rules against draft limits.
 * Recommendations never auto-save; callers only display them.
 */
export function assessMatchupFeasibility(
  input: ScheduleInput,
  draftLimits: MatchingLimits,
  options: FeasibilityOptions = {},
): MatchupFeasibility {
  const maxComputeMs = Math.min(Math.max(options.maxComputeMs ?? 8_000, 1), 25_000);
  const probeComputeMs = Math.min(Math.max(options.probeComputeMs ?? 3_000, 1), maxComputeMs);
  const seed = options.deterministicSeed ?? 1;
  const current = clampLimits({ ...input.limits, ...draftLimits });
  const primary = solveSchedule(withLimits(input, current), { maxComputeMs, deterministicSeed: seed });

  if (isFeasible(primary)) {
    return { status: "ok", message: "Current settings support a complete schedule." };
  }

  if (isTimeout(primary)) {
    return {
      status: "inconclusive",
      message:
        "The solver ran out of time before proving a schedule. That is not proof that these settings are impossible — try again, or generate from check-in.",
    };
  }

  const primaryCodes = codesOf(primary);
  if (hasStructuralFailure(primaryCodes)) {
    // Confirm capacity/attendance issues still fail at the widest numeric limits.
    const atMax = solveSchedule(
      withLimits(input, { ...MAX_LIMITS, maxAggressionDifference: current.maxAggressionDifference }),
      { maxComputeMs: probeComputeMs, deterministicSeed: seed },
    );
    if (isTimeout(atMax)) {
      return {
        status: "inconclusive",
        message:
          "The solver ran out of time while checking whether wider limits would help. That is not proof that a schedule is impossible.",
      };
    }
    if (!isFeasible(atMax) && hasStructuralFailure(codesOf(atMax))) {
      return {
        status: "impossible",
        message: structuralMessage(codesOf(atMax), atMax.status === "UNSAT" ? atMax.diagnostics : primary.status === "UNSAT" ? primary.diagnostics : []),
        codes: codesOf(atMax),
      };
    }
  }

  const candidates = practicalLimitCandidates(current);
  // Cap probes so the settings page stays responsive.
  const probeLimit = 24;
  for (const candidate of candidates.slice(0, probeLimit)) {
    const probed = solveSchedule(withLimits(input, candidate), {
      maxComputeMs: probeComputeMs,
      deterministicSeed: seed,
    });
    if (isFeasible(probed)) {
      const suggestion: LimitSuggestion = {
        maxWeightDifferenceLbs: candidate.maxWeightDifferenceLbs,
        maxWeightDifferencePctOfLighterAthlete: candidate.maxWeightDifferencePctOfLighterAthlete,
        maxSkillDifference: candidate.maxSkillDifference,
      };
      return {
        status: "needs_looser_limits",
        message: formatSuggestion(suggestion),
        suggestion,
        codes: primaryCodes,
      };
    }
  }

  const atMax = solveSchedule(
    withLimits(input, { ...MAX_LIMITS, maxAggressionDifference: current.maxAggressionDifference }),
    { maxComputeMs: probeComputeMs, deterministicSeed: seed },
  );
  if (isTimeout(atMax)) {
    return {
      status: "inconclusive",
      message:
        "No practical limit increase was confirmed before the time budget ran out. That is not proof that a schedule is impossible.",
    };
  }
  if (isFeasible(atMax)) {
    const suggestion: LimitSuggestion = {
      maxWeightDifferenceLbs: MAX_LIMITS.maxWeightDifferenceLbs,
      maxWeightDifferencePctOfLighterAthlete: MAX_LIMITS.maxWeightDifferencePctOfLighterAthlete,
      maxSkillDifference: MAX_LIMITS.maxSkillDifference,
    };
    return {
      status: "needs_looser_limits",
      message: formatSuggestion(suggestion),
      suggestion,
      codes: primaryCodes,
    };
  }
  if (hasStructuralFailure(codesOf(atMax))) {
    return {
      status: "impossible",
      message: structuralMessage(codesOf(atMax), atMax.status === "UNSAT" ? atMax.diagnostics : []),
      codes: codesOf(atMax),
    };
  }

  return {
    status: "impossible",
    message:
      "A complete schedule was not found even at the widest match limits. Check attendance, named exclusions, or locked matches — raising limits further is not available.",
    codes: codesOf(atMax),
  };
}
