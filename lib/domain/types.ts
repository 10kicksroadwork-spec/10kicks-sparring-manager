/** Domain types for the Saturday hard-sparring scheduler. Pure data — no I/O. */

export const LOCATIONS = ["MAIN_RING", "FLOOR_1", "FLOOR_2"] as const;
export type Location = (typeof LOCATIONS)[number];

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
  aggression: number;
};

/**
 * Proposed coach-review defaults. All four numeric limits apply together (logical AND).
 * They are not a safety certification.
 */
export const PROPOSED_MATCH_LIMITS = {
  maxWeightDifferenceLbs: 15,
  maxWeightDifferencePctOfLighterAthlete: 10,
  maxSkillDifference: 1,
  maxAggressionDifference: 1,
} as const;

export const PROPOSED_LIMITS_NOTICE =
  "Proposed defaults pending coach safety review: 15 lb AND 10% of the lighter athlete, skill gap 1, and aggression gap 1. These limits are not safety-certified. The coach decides suitability, injury readiness, conduct, and intensity.";

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
  skill: 0.3,
  aggression: 0.3,
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
  | "DUPLICATE_PAIRING"
  | "EXPLICIT_EXCLUSION"
  | "NUMERIC_LIMIT"
  | "INVALID_OVERRIDE"
  | "EMPTY_FIGHTER_ATTENDANCE"
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
    limitsPendingCoachReview: true,
    limitsNotice: PROPOSED_LIMITS_NOTICE,
    limits: { ...limits },
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
