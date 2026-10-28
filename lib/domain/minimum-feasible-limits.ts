import { solveSchedule } from "./solver";
import type { ConflictCode, MatchingLimits, ScheduleInput, SolveResult } from "./types";

/** Stored for schema / older sessions; matchmaking and scoring ignore percent-of-lighter. */
export const IGNORED_WEIGHT_PCT = 100;

const MAX_LBS = 100;
const MIN_LBS = 1;
const MAX_SKILL = 6;

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

/**
 * Selection method (documented for coaches/tests):
 * Lexicographic joint search — skill difference 0→6 outer, then binary-search the
 * smallest maxWeightDifferenceLbs (half-pound steps 1–100) that yields a FEASIBLE
 * complete schedule from the real solver. First skill level with any feasible lbs
 * wins; within that skill, minimize lbs. Axes are never minimized independently:
 * partner uniqueness, volunteer caps, rest gaps, locations, and exclusions apply
 * on every probe. Percent-of-lighter is fixed at 100 and not enforced.
 */
export const MINIMUM_LIMITS_SELECTION_METHOD =
  "joint skill-then-lbs: for skill 0→6, binary-search minimal lbs via solveSchedule; first feasible pair wins";

export type RecommendedLimits = {
  maxWeightDifferenceLbs: number;
  maxSkillDifference: number;
  /** Always 100; retained for API/schema compatibility and ignored by matching. */
  maxWeightDifferencePctOfLighterAthlete: number;
};

export type MinimumFeasibleLimitsResult =
  | {
      status: "ok";
      limits: RecommendedLimits;
      message: string;
      method: string;
    }
  | {
      status: "impossible";
      message: string;
      codes: ConflictCode[];
      method: string;
    }
  | {
      status: "inconclusive";
      message: string;
      method: string;
    };

export type MinimumSearchOptions = {
  maxComputeMs?: number;
  probeComputeMs?: number;
  deterministicSeed?: number;
};

function withLimits(input: ScheduleInput, lbs: number, skill: number): ScheduleInput {
  return {
    ...input,
    limits: {
      ...input.limits,
      maxWeightDifferenceLbs: lbs,
      maxWeightDifferencePctOfLighterAthlete: IGNORED_WEIGHT_PCT,
      maxSkillDifference: skill,
    },
  };
}

function codesOf(result: SolveResult): ConflictCode[] {
  if (result.status === "FEASIBLE") return [];
  return result.diagnostics.map((row) => row.code);
}

function hasStructuralFailure(codes: ConflictCode[]): boolean {
  return codes.some((code) => STRUCTURAL_CODES.has(code));
}

function snapLbs(value: number): number {
  return Math.min(MAX_LBS, Math.max(MIN_LBS, Math.round(value * 2) / 2));
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
    return "No volunteers are checked in. Match limits cannot create a schedule until volunteers are present.";
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

function probe(
  input: ScheduleInput,
  lbs: number,
  skill: number,
  computeMs: number,
  seed: number,
): SolveResult {
  return solveSchedule(withLimits(input, lbs, skill), {
    maxComputeMs: computeMs,
    deterministicSeed: seed,
  });
}

/**
 * Binary-search the smallest half-pound lbs at a fixed skill that the solver proves FEASIBLE.
 * TIME_BUDGET_EXHAUSTED never counts as feasible or as proof of impossibility.
 */
function minimalLbsAtSkill(
  input: ScheduleInput,
  skill: number,
  probeComputeMs: number,
  seed: number,
): { lbs: number | null; timedOut: boolean } {
  const atMax = probe(input, MAX_LBS, skill, probeComputeMs, seed);
  if (atMax.status === "TIME_BUDGET_EXHAUSTED") {
    return { lbs: null, timedOut: true };
  }
  if (atMax.status !== "FEASIBLE") {
    return { lbs: null, timedOut: false };
  }

  let lo = MIN_LBS;
  let hi = MAX_LBS;
  let best = MAX_LBS;
  let timedOut = false;
  // Half-pound grid → at most ~8 probes after the max check.
  while (lo <= hi + 1e-9) {
    const mid = snapLbs((lo + hi) / 2);
    const result = probe(input, mid, skill, probeComputeMs, seed);
    if (result.status === "FEASIBLE") {
      best = mid;
      hi = snapLbs(mid - 0.5);
    } else if (result.status === "TIME_BUDGET_EXHAUSTED") {
      timedOut = true;
      // Treat timeout as inconclusive at this mid; search looser side only.
      lo = snapLbs(mid + 0.5);
    } else {
      lo = snapLbs(mid + 0.5);
    }
    if (hi < lo) break;
  }
  return { lbs: best, timedOut };
}

/**
 * Find the smallest verified (skill, lbs) pair that produces an actual complete schedule.
 */
export function findMinimumFeasibleLimits(
  input: ScheduleInput,
  options: MinimumSearchOptions = {},
): MinimumFeasibleLimitsResult {
  const method = MINIMUM_LIMITS_SELECTION_METHOD;
  const maxComputeMs = Math.min(Math.max(options.maxComputeMs ?? 8_000, 1), 25_000);
  const probeComputeMs = Math.min(Math.max(options.probeComputeMs ?? 3_000, 1), maxComputeMs);
  const seed = options.deterministicSeed ?? 1;

  const atWidest = probe(input, MAX_LBS, MAX_SKILL, maxComputeMs, seed);
  if (atWidest.status === "TIME_BUDGET_EXHAUSTED") {
    return {
      status: "inconclusive",
      message:
        "The solver ran out of time before proving a schedule at the widest supported limits. That is not proof that a schedule is impossible — try again, or generate from check-in.",
      method,
    };
  }
  if (atWidest.status !== "FEASIBLE") {
    const codes = codesOf(atWidest);
    if (hasStructuralFailure(codes) || atWidest.status === "UNSAT") {
      return {
        status: "impossible",
        message: structuralMessage(codes, atWidest.diagnostics),
        codes,
        method,
      };
    }
    return {
      status: "impossible",
      message:
        "A complete schedule was not found even at the widest match limits. Check attendance, named exclusions, or locked matches.",
      codes,
      method,
    };
  }

  let anyTimeout = false;
  for (let skill = 0; skill <= MAX_SKILL; skill += 1) {
    const { lbs, timedOut } = minimalLbsAtSkill(input, skill, probeComputeMs, seed);
    if (timedOut) anyTimeout = true;
    if (lbs != null) {
      const limits: RecommendedLimits = {
        maxWeightDifferenceLbs: lbs,
        maxSkillDifference: skill,
        maxWeightDifferencePctOfLighterAthlete: IGNORED_WEIGHT_PCT,
      };
      return {
        status: "ok",
        limits,
        message:
          `Recommended minimums: ${lbs} lb weight gap and skill difference ${skill}. ` +
          `Verified with a complete solver schedule (joint search: skill then lbs).`,
        method,
      };
    }
  }

  // Widest already proved FEASIBLE above. If finer skill/lbs probes timed out or failed oddly,
  // still return that verified pair — never claim impossible from timeout alone.
  return {
    status: "ok",
    limits: {
      maxWeightDifferenceLbs: MAX_LBS,
      maxSkillDifference: MAX_SKILL,
      maxWeightDifferencePctOfLighterAthlete: IGNORED_WEIGHT_PCT,
    },
    message: anyTimeout
      ? `Recommended minimums: ${MAX_LBS} lb and skill ${MAX_SKILL} (widest pair verified; a tighter search timed out before proving a smaller pair).`
      : `Recommended minimums: ${MAX_LBS} lb weight gap and skill difference ${MAX_SKILL} (widest verified feasible pair).`,
    method,
  };
}

/** Clamp coach-facing limits; percent is always forced to the ignored sentinel. */
export function normalizeMatchingLimits(limits: MatchingLimits): MatchingLimits {
  return {
    maxWeightDifferenceLbs: snapLbs(limits.maxWeightDifferenceLbs),
    maxWeightDifferencePctOfLighterAthlete: IGNORED_WEIGHT_PCT,
    maxSkillDifference: Math.min(MAX_SKILL, Math.max(0, Math.round(limits.maxSkillDifference))),
    maxAggressionDifference: limits.maxAggressionDifference,
  };
}
