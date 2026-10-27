import type { ConflictCode, ConflictDiagnostic } from "./types";

/** Build one actionable diagnostic. Messages are for coaches, not stack traces. */
export function diagnostic(
  code: ConflictCode,
  message: string,
  extra: Omit<ConflictDiagnostic, "code" | "message"> = {},
): ConflictDiagnostic {
  return { code, message, ...extra };
}

export function coachNextSteps(codes: ConflictCode[]): string[] {
  const steps = new Set<string>();
  for (const code of codes) {
    if (code === "INSUFFICIENT_ELIGIBLE_PARTNERS" || code === "EXPLICIT_EXCLUSION" || code === "NUMERIC_LIMIT") {
      steps.add("Add a compatible volunteer, or review the proposed numeric limits and any named exclusions.");
    }
    if (code === "INSUFFICIENT_TOTAL_VOLUNTEER_CAPACITY" || code === "VOLUNTEER_MAX_EXCEEDED") {
      steps.add("Check in more volunteers. Each volunteer can take at most 2 hard sessions.");
    }
    if (code === "EMPTY_FIGHTER_ATTENDANCE") {
      steps.add("Check in the fighters who are actually here before generating.");
    }
    if (code === "EMPTY_VOLUNTEER_ATTENDANCE" || code === "ROLE_CONFLICT") {
      steps.add("Check people in on the volunteer list. One person takes one role this Saturday and is not paired with themselves.");
    }
    if (
      code === "FIXED_ASSIGNMENT_CONFLICT" ||
      code === "REST_SPACING_CONFLICT" ||
      code === "LOCATION_COVERAGE_CONFLICT"
    ) {
      steps.add("Unlock or resolve the completed match that conflicts, then generate again. Completed work stays put.");
    }
    if (code === "VOLUNTEER_REUSE_WHEN_AVOIDABLE") {
      steps.add("Enough volunteers were available for one block each. Prefer single-block use unless you intentionally swapped someone into a second block.");
    }
    if (code === "SEARCH_BUDGET_EXHAUSTED") {
      steps.add("This is not proof that a schedule is impossible. Retry generation, or remove a constraint and try again.");
    }
    if (code === "INTERRUPTED_NEEDS_COACH_RESOLUTION") {
      steps.add("An interrupted bout does not count as a finished two-round session. Decide whether and how to make it up.");
    }
    if (code === "SCHEDULE_INFEASIBLE") {
      steps.add("Add an eligible volunteer, change who is present, or unlock a conflicting match. The app will not silently drop a required hard session or relax limits.");
    }
  }
  if (steps.size === 0) {
    steps.add("Adjust attendance or unlock a conflicting match, then generate again.");
  }
  return [...steps];
}
