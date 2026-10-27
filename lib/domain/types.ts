/** Domain types for the Saturday hard-sparring scheduler. Pure data — no I/O. */

export const LOCATIONS = ["MAIN_RING", "FLOOR_1", "FLOOR_2"] as const;
export type Location = (typeof LOCATIONS)[number];

/** Coach-facing labels. Internal IDs stay MAIN_RING / FLOOR_1 / FLOOR_2. */
export function locationLabel(location: string): string {
  if (location === "MAIN_RING") return "Main ring";
  if (location === "FLOOR_1") return "Back Mat";
  if (location === "FLOOR_2") return "Front Mat";
  return location;
}

/** Five or more fighters use the main ring plus Back Mat and Front Mat. Fewer than five use the main ring and Back Mat only. */
export function locationsForFighterCount(fighterCount: number): Location[] {
  return fighterCount < 5 ? ["MAIN_RING", "FLOOR_1"] : [...LOCATIONS];
}

export function scheduledFighterCount(input: { fighters: { athleteId: string }[]; unavailableIds?: string[] }): number {
  const unavailable = new Set(input.unavailableIds ?? []);
  return input.fighters.filter((fighter) => !unavailable.has(fighter.athleteId)).length;
}

export const ASSIGNMENT_STATUSES = ["PLANNED", "IN_PROGRESS", "COMPLETED", "INTERRUPTED"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** One assignment is one two-round hard session. An interruption is not a completed session. */
export const HARD_ROUNDS_PER_ASSIGNMENT = 2;

export type Assignment = {
  assignmentId: string;
  sessionId: string;
  generationId: string;
  blockIndex: number;
  location: Location;
  fighterId: string;
  volunteerId: string;
  status: AssignmentStatus;
  locked: boolean;
  approvedNumericExceptionId?: string;
};

export type SessionAthlete = {
  athleteId: string;
  displayName: string;
  weightLbs: number;
  skill: number;
  /** Stored when a row has it. Matching and check-in ignore it. */
  aggression: number | null;
};

/**
 * Proposed coach-review defaults. Absolute weight, relative weight, and skill apply together.
 * maxAggressionDifference remains so older session settings still load. It is not applied.
 */
export const PROPOSED_MATCH_LIMITS = {
  maxWeightDifferenceLbs: 60,
  maxWeightDifferencePctOfLighterAthlete: 50,
  maxSkillDifference: 3,
  maxAggressionDifference: 1,
} as const;

export type MatchingLimits = {
  maxWeightDifferenceLbs: number;
  maxWeightDifferencePctOfLighterAthlete: number;
  maxSkillDifference: number;
  maxAggressionDifference: number;
};

export type ScoringWeights = {
  weight: number;
  skill: number;
  aggression: number;
};

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  weight: 0.4,
  skill: 0.6,
  aggression: 0,
};

export type Restriction = {
  restrictionId: string;
  athleteAId: string;
  athleteBId: string;
  reason: string;
  active: boolean;
};

/** One-session waiver of numeric limits only. Never waives an explicit exclusion or a scheduling rule. */
export type NumericOverride = {
  overrideId: string;
  sessionId: string;
  fighterId: string;
  volunteerId: string;
  coachEmail: string;
  reason: string;
  acknowledgedAt: string;
  active: boolean;
};

export type ScheduleInput = {
  sessionId: string;
  generationId: string;
  fighters: SessionAthlete[];
  volunteers: SessionAthlete[];
  limits: MatchingLimits;
  restrictions: Restriction[];
  overrides: NumericOverride[];
  fixedAssignments: Assignment[];
  requiredHardSessions: number;
  maxVolunteerSessions: number;
  restGapBlocks: number;
  scoringWeights: ScoringWeights;
  maxBlockHorizon: number;
  /** Checked-in people who must not receive new assignments. Locked and completed work may still name them. */
  unavailableIds?: string[];
};

export type SolveOptions = {
  maxComputeMs: number;
  deterministicSeed: number;
};

export type ConflictCode =
  | "INSUFFICIENT_ELIGIBLE_PARTNERS"
  | "INSUFFICIENT_TOTAL_VOLUNTEER_CAPACITY"
  | "FIXED_ASSIGNMENT_CONFLICT"
  | "BLOCK_CAPACITY_EXCEEDED"
  | "ATHLETE_DOUBLE_BOOKED"
  | "LOCATION_COVERAGE_CONFLICT"
  | "REST_SPACING_CONFLICT"
  | "VOLUNTEER_MAX_EXCEEDED"
  | "VOLUNTEER_SAME_FIGHTER"
  | "VOLUNTEER_REUSE_WHEN_AVOIDABLE"
  | "DUPLICATE_PAIRING"
  | "EXPLICIT_EXCLUSION"
  | "NUMERIC_LIMIT"
  | "INVALID_OVERRIDE"
  | "EMPTY_FIGHTER_ATTENDANCE"
  | "EMPTY_VOLUNTEER_ATTENDANCE"
  | "INCOMPLETE_PROFILE"
  | "ROLE_CONFLICT"
  | "SEARCH_BUDGET_EXHAUSTED"
  | "SCHEDULE_INFEASIBLE"
  | "INTERRUPTED_NEEDS_COACH_RESOLUTION"
  | "UNKNOWN_ATHLETE"
  | "SESSION_COUNT"
  | "INPUT_INVALID"
  | "SOLVER_REJECTED_CANDIDATE";

export type ConflictDiagnostic = {
  code: ConflictCode;
  message: string;
  fighterId?: string;
  volunteerId?: string;
  assignmentId?: string;
  blockIndex?: number;
  location?: Location;
  details?: Record<string, string | number | boolean | null>;
};

export type ValidationResult = {
  ok: boolean;
  errors: ConflictDiagnostic[];
  warnings: ConflictDiagnostic[];
};

export type SolveResult =
  | {
      status: "FEASIBLE";
      assignments: Assignment[];
      blockCount: number;
      score: number;
      optimality: "PROVEN" | "NOT_PROVEN";
      diagnostics: string[];
    }
  | { status: "UNSAT"; diagnostics: ConflictDiagnostic[] }
  | {
      status: "TIME_BUDGET_EXHAUSTED";
      diagnostics: ConflictDiagnostic[];
      bestValidCandidate?: Assignment[];
    };

export function countsAsHardSession(status: AssignmentStatus): boolean {
  return status === "PLANNED" || status === "IN_PROGRESS" || status === "COMPLETED";
}

export function countsAsCompletedTwoRoundSession(status: AssignmentStatus): boolean {
  return status === "COMPLETED";
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function saturdayPresetSettings(limits: MatchingLimits = PROPOSED_MATCH_LIMITS) {
  return {
    algorithmVersion: "1.0.0",
    preset: "SATURDAY_THREE_HARD",
    limits: { ...limits },
    // Each block has two sequential rounds; separate sparring areas run in parallel.
    timing: { roundMinutes: 3, restSeconds: 60 },
    requiredHardSessionsPerFighter: 3,
    hardRoundsPerSession: HARD_ROUNDS_PER_ASSIGNMENT,
    maxVolunteerHardSessions: 2,
    restGapBlocks: 1,
    locations: [...LOCATIONS],
    scoringWeights: { ...DEFAULT_SCORING_WEIGHTS },
    maxBlockHorizon: 20,
    solverBudgetMs: 15_000,
    timezone: "America/New_York",
  };
}

export type SaturdaySettings = ReturnType<typeof saturdayPresetSettings>;
