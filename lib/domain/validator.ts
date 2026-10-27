import { isContiguousLeftPack } from "./location-packing";
import { evaluatePair } from "./matchmaking";
import {
  LOCATIONS,
  countsAsHardSession,
  locationLabel,
  locationsForFighterCount,
  scheduledFighterCount,
  type Assignment,
  type ConflictDiagnostic,
  type Location,
  type ScheduleInput,
  type ValidationResult,
} from "./types";
import { diagnostic } from "./diagnostics";
import { isReadyForHardMatch, SKILL_MAX, SKILL_MIN } from "./profile";
import { reuseWasAvoidable, volunteersInMultipleHardBlocks } from "./volunteer-load";

const LOCATION_SET = new Set<string>(LOCATIONS);

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function profileIssues(
  person: { athleteId: string; displayName: string; weightLbs: number; skill: number },
  role: string,
): ConflictDiagnostic[] {
  const issues: ConflictDiagnostic[] = [];
  if (!person.athleteId || !person.displayName.trim()) {
    issues.push(diagnostic("INCOMPLETE_PROFILE", `${role} is missing an id or name.`, { fighterId: person.athleteId }));
  }
  if (!isReadyForHardMatch(person)) {
    if (!(person.weightLbs > 0) || person.weightLbs > 500 || !Number.isFinite(person.weightLbs)) {
      issues.push(
        diagnostic("INCOMPLETE_PROFILE", `${person.displayName || role} needs a positive weight in pounds.`, {
          fighterId: person.athleteId,
        }),
      );
    }
    if (!Number.isInteger(person.skill) || person.skill < SKILL_MIN || person.skill > SKILL_MAX) {
      issues.push(
        diagnostic("INCOMPLETE_PROFILE", `${person.displayName || role} needs a skill rating from ${SKILL_MIN} to ${SKILL_MAX}.`, {
          fighterId: person.athleteId,
        }),
      );
    }
  }
  return issues;
}

/**
 * Authoritative schedule check. Independent of solver search order.
 * `full` requires the Saturday quota. `partial` checks whatever assignments exist
 * (used for locked/completed rows before a regeneration search).
 */
export function validateSchedule(
  input: ScheduleInput,
  assignments: Assignment[],
  options: { mode?: "full" | "partial" } = {},
): ValidationResult {
  const mode = options.mode ?? "full";
  const errors: ConflictDiagnostic[] = [];
  const warnings: ConflictDiagnostic[] = [];

  if (input.fighters.length === 0) {
    errors.push(
      diagnostic(
        "EMPTY_FIGHTER_ATTENDANCE",
        "No fighters are checked in, so this cannot be published as a Saturday rundown.",
      ),
    );
  }

  const fighterIds = new Set<string>();
  for (const fighter of input.fighters) {
    if (fighterIds.has(fighter.athleteId)) {
      errors.push(diagnostic("INPUT_INVALID", `Fighter ${fighter.displayName} is listed twice.`, { fighterId: fighter.athleteId }));
    }
    fighterIds.add(fighter.athleteId);
    errors.push(...profileIssues(fighter, "Fighter"));
  }
  const volunteerIds = new Set<string>();
  for (const volunteer of input.volunteers) {
    if (volunteerIds.has(volunteer.athleteId)) {
      errors.push(diagnostic("INPUT_INVALID", `Volunteer ${volunteer.displayName} is listed twice.`, { volunteerId: volunteer.athleteId }));
    }
    volunteerIds.add(volunteer.athleteId);
    errors.push(...profileIssues(volunteer, "Volunteer"));
    if (fighterIds.has(volunteer.athleteId)) {
      errors.push(
        diagnostic(
          "ROLE_CONFLICT",
          `${volunteer.displayName} is checked in as both a fighter and a volunteer. Pick one role for this Saturday.`,
          { fighterId: volunteer.athleteId, volunteerId: volunteer.athleteId },
        ),
      );
    }
  }

  const unavailable = new Set(input.unavailableIds ?? []);
  const fightersById = new Map(input.fighters.map((f) => [f.athleteId, f]));
  const volunteersById = new Map(input.volunteers.map((v) => [v.athleteId, v]));
  const seenIds = new Set<string>();
  const byBlock = new Map<number, Assignment[]>();

  for (const assignment of assignments) {
    if (seenIds.has(assignment.assignmentId)) {
      errors.push(diagnostic("INPUT_INVALID", `Assignment ${assignment.assignmentId} is duplicated.`, { assignmentId: assignment.assignmentId }));
    }
    seenIds.add(assignment.assignmentId);
    if (assignment.sessionId !== input.sessionId) {
      errors.push(diagnostic("INPUT_INVALID", "An assignment belongs to a different session.", { assignmentId: assignment.assignmentId }));
    }
    if (!isPositiveInt(assignment.blockIndex)) {
      errors.push(diagnostic("INPUT_INVALID", "Block numbers must be positive whole numbers.", { assignmentId: assignment.assignmentId }));
    }
    if (!LOCATION_SET.has(assignment.location)) {
      errors.push(diagnostic("INPUT_INVALID", "A match uses an unknown location.", { assignmentId: assignment.assignmentId }));
    }
    if (!fightersById.has(assignment.fighterId)) {
      errors.push(
        diagnostic("UNKNOWN_ATHLETE", "A match references a fighter who is not checked in.", {
          assignmentId: assignment.assignmentId,
          fighterId: assignment.fighterId,
        }),
      );
    }
    if (!volunteersById.has(assignment.volunteerId)) {
      errors.push(
        diagnostic("UNKNOWN_ATHLETE", "A match references a volunteer who is not checked in.", {
          assignmentId: assignment.assignmentId,
          volunteerId: assignment.volunteerId,
        }),
      );
    }
    if (assignment.fighterId === assignment.volunteerId) {
      errors.push(diagnostic("ROLE_CONFLICT", "A person cannot spar against themselves.", { assignmentId: assignment.assignmentId }));
    }
    const preserved =
      assignment.locked || assignment.status === "COMPLETED" || assignment.status === "IN_PROGRESS" || assignment.status === "INTERRUPTED";
    if (!preserved && (unavailable.has(assignment.fighterId) || unavailable.has(assignment.volunteerId))) {
      errors.push(
        diagnostic("UNKNOWN_ATHLETE", "A new match still uses someone who is no longer available.", {
          assignmentId: assignment.assignmentId,
          fighterId: assignment.fighterId,
          volunteerId: assignment.volunteerId,
        }),
      );
    }
    const list = byBlock.get(assignment.blockIndex) ?? [];
    list.push(assignment);
    byBlock.set(assignment.blockIndex, list);
    if (assignment.status === "INTERRUPTED") {
      warnings.push(
        diagnostic(
          "INTERRUPTED_NEEDS_COACH_RESOLUTION",
          "An interrupted bout does not count as a completed two-round hard session. The coach needs to decide whether to make it up.",
          { assignmentId: assignment.assignmentId, fighterId: assignment.fighterId, blockIndex: assignment.blockIndex },
        ),
      );
    }
  }

  const mats = locationsForFighterCount(scheduledFighterCount(input));
  const fixedIds = new Set(input.fixedAssignments.map((row) => row.assignmentId));
  for (const [blockIndex, group] of byBlock) {
    const fixedCount = group.filter((row) => fixedIds.has(row.assignmentId)).length;
    if (group.length > Math.max(mats.length, fixedCount)) {
      errors.push(
        diagnostic("BLOCK_CAPACITY_EXCEEDED", `Block ${blockIndex} has ${group.length} hard matches. This Saturday is using ${mats.length} locations.`, {
          blockIndex,
          details: { count: group.length, locations: mats.length },
        }),
      );
    }
    const locations = new Set<Location>();
    const people = new Set<string>();
    for (const assignment of group) {
      if (locations.has(assignment.location)) {
        errors.push(
          diagnostic("BLOCK_CAPACITY_EXCEEDED", `Block ${blockIndex} uses ${locationLabel(assignment.location)} more than once.`, {
            blockIndex,
            location: assignment.location,
          }),
        );
      }
      locations.add(assignment.location);
      for (const personId of [assignment.fighterId, assignment.volunteerId]) {
        if (people.has(personId)) {
          errors.push(
            diagnostic("ATHLETE_DOUBLE_BOOKED", `Someone is booked twice in block ${blockIndex}.`, {
              blockIndex,
              fighterId: assignment.fighterId,
              volunteerId: assignment.volunteerId,
            }),
          );
        }
        people.add(personId);
      }
    }
    // Full cards must pack left: Main → Back Mat → Front Mat (no open higher-priority slot).
    if (mode === "full" && group.length > 0 && !isContiguousLeftPack(locations, mats)) {
      errors.push(
        diagnostic(
          "LOCATION_PACKING_HOLE",
          `Block ${blockIndex} leaves a higher-priority mat open. Pack matches left: ${mats.map(locationLabel).join(" → ")}.`,
          { blockIndex, details: { locations: [...locations].join(",") } },
        ),
      );
    }
  }

  const minGap = input.restGapBlocks + 1;
  const athleteIds = new Set<string>([...fighterIds, ...volunteerIds]);
  for (const athleteId of athleteIds) {
    const blocks = assignments
      .filter((a) => a.fighterId === athleteId || a.volunteerId === athleteId)
      .map((a) => a.blockIndex)
      .sort((a, b) => a - b);
    const unique = new Set(blocks);
    if (unique.size !== blocks.length) continue;
    for (let i = 1; i < blocks.length; i += 1) {
      if (blocks[i] - blocks[i - 1] < minGap) {
        errors.push(
          diagnostic(
            "REST_SPACING_CONFLICT",
            `Hard sessions must have at least ${input.restGapBlocks} full block between them. Blocks ${blocks[i - 1]} and ${blocks[i]} are too close.`,
            { blockIndex: blocks[i], fighterId: fighterIds.has(athleteId) ? athleteId : undefined, volunteerId: volunteerIds.has(athleteId) ? athleteId : undefined },
          ),
        );
      }
    }
  }

  for (const fighter of input.fighters) {
    const counting = assignments.filter((a) => a.fighterId === fighter.athleteId && countsAsHardSession(a.status));
    const volunteers = counting.map((a) => a.volunteerId);
    if (new Set(volunteers).size !== volunteers.length) {
      errors.push(
        diagnostic("DUPLICATE_PAIRING", `${fighter.displayName} is paired with the same volunteer more than once.`, {
          fighterId: fighter.athleteId,
        }),
      );
    }
    // Location variety is soft: packing + short cards may repeat Main / mats.
    // Still reject mats outside this Saturday's venue pool (e.g. Front Mat under 5).
    for (const assignment of counting) {
      if (!mats.includes(assignment.location) && !fixedIds.has(assignment.assignmentId)) {
        errors.push(
          diagnostic("LOCATION_COVERAGE_CONFLICT", `${fighter.displayName} is on ${locationLabel(assignment.location)}, which is not used with ${scheduledFighterCount(input)} fighters.`, {
            fighterId: fighter.athleteId,
            location: assignment.location,
          }),
        );
      }
    }
    if (counting.length > input.requiredHardSessions) {
      errors.push(
        diagnostic("SESSION_COUNT", `${fighter.displayName} has more than ${input.requiredHardSessions} hard sessions.`, {
          fighterId: fighter.athleteId,
          details: { count: counting.length },
        }),
      );
    }
    if (mode === "full" && counting.length !== input.requiredHardSessions) {
      errors.push(
        diagnostic(
          "SESSION_COUNT",
          `${fighter.displayName} has ${counting.length} hard sessions. A full Saturday rundown needs exactly ${input.requiredHardSessions}.`,
          { fighterId: fighter.athleteId, details: { count: counting.length, required: input.requiredHardSessions } },
        ),
      );
    }

    for (const assignment of counting) {
      const volunteer = volunteersById.get(assignment.volunteerId);
      if (!volunteer) continue;
      const decision = evaluatePair({
        sessionId: input.sessionId,
        fighter,
        volunteer,
        limits: input.limits,
        restrictions: input.restrictions,
        overrides: input.overrides,
      });
      if (!decision.eligible) {
        const code = decision.reasonCodes.includes("EXPLICIT_EXCLUSION")
          ? "EXPLICIT_EXCLUSION"
          : decision.reasonCodes.includes("INVALID_OVERRIDE")
            ? "INVALID_OVERRIDE"
            : "NUMERIC_LIMIT";
        errors.push(
          diagnostic(code, decision.reasons.join(" "), {
            fighterId: fighter.athleteId,
            volunteerId: volunteer.athleteId,
            assignmentId: assignment.assignmentId,
          }),
        );
      } else if (decision.overrideId && assignment.approvedNumericExceptionId !== decision.overrideId) {
        errors.push(
          diagnostic(
            "INVALID_OVERRIDE",
            "This pair only fits because of a numeric exception, but the match is not tied to that exception.",
            { assignmentId: assignment.assignmentId, fighterId: fighter.athleteId, volunteerId: volunteer.athleteId },
          ),
        );
      }
    }
  }

  for (const volunteer of input.volunteers) {
    const counting = assignments.filter((a) => a.volunteerId === volunteer.athleteId && countsAsHardSession(a.status));
    const interrupted = assignments.filter((a) => a.volunteerId === volunteer.athleteId && a.status === "INTERRUPTED");
    const load = counting.length + interrupted.length;
    if (load > input.maxVolunteerSessions) {
      errors.push(
        diagnostic(
          "VOLUNTEER_MAX_EXCEEDED",
          `${volunteer.displayName} is in ${load} hard sessions. The cap is ${input.maxVolunteerSessions}.`,
          { volunteerId: volunteer.athleteId, details: { count: load, max: input.maxVolunteerSessions } },
        ),
      );
    }
    const opponents = [...counting, ...interrupted].map((a) => a.fighterId);
    if (new Set(opponents).size !== opponents.length) {
      errors.push(
        diagnostic("VOLUNTEER_SAME_FIGHTER", `${volunteer.displayName} is paired with the same fighter more than once.`, {
          volunteerId: volunteer.athleteId,
        }),
      );
    }
  }

  // Coach swaps may still place someone in a second block; warn only when the pool was large enough to avoid it.
  if (mode === "full" && reuseWasAvoidable(input, assignments)) {
    const multi = volunteersInMultipleHardBlocks(assignments, (id) => {
      return input.volunteers.find((volunteer) => volunteer.athleteId === id)?.displayName ?? id;
    });
    for (const row of multi) {
      warnings.push(
        diagnostic(
          "VOLUNTEER_REUSE_WHEN_AVOIDABLE",
          `${row.displayName} is in more than one block even though enough volunteers were available for single-block use.`,
          { volunteerId: row.volunteerId, details: { blocks: row.blocks.join(",") } },
        ),
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
