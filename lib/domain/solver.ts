import { diagnostic } from "./diagnostics";
import { evaluatePair } from "./matchmaking";
import { pairCompatibility, scoreSchedule } from "./scoring";
import { validateSchedule } from "./validator";
import {
  LOCATIONS,
  countsAsHardSession,
  type Assignment,
  type ConflictDiagnostic,
  type Location,
  type ScheduleInput,
  type SessionAthlete,
  type SolveOptions,
  type SolveResult,
} from "./types";

const LOCATION_BIT: Record<Location, number> = { MAIN_RING: 1, FLOOR_1: 2, FLOOR_2: 4 };
const MAX_BUDGET_MS = 25_000;

type Slot = {
  fighterId: string;
  blockIndex: number;
  location: Location;
  fixedVolunteerId?: string;
  fixedAssignment?: Assignment;
};

/**
 * Bounded most-constrained-first search.
 * Block patterns are chosen first, then locations, then volunteers.
 * Returns UNSAT only after the horizon range is fully searched.
 */
export function solveSchedule(input: ScheduleInput, options: SolveOptions): SolveResult {
  const budget = Math.min(options.maxComputeMs, MAX_BUDGET_MS);
  const deadline = Date.now() + Math.max(budget, 0);
  const prep = prepare(input);
  if (prep.diagnostics.length > 0) {
    return { status: "UNSAT", diagnostics: prep.diagnostics };
  }

  if (budget <= 0) {
    return {
      status: "TIME_BUDGET_EXHAUSTED",
      diagnostics: [
        diagnostic(
          "SEARCH_BUDGET_EXHAUSTED",
          "The solver stopped because the time budget was already used. This is not proof that a schedule is impossible.",
        ),
      ],
    };
  }

  if (prep.demand === 0) {
    const assignments = sortAssignments(input.fixedAssignments.map((a) => ({ ...a })));
    const validation = validateSchedule(input, assignments);
    if (!validation.ok) return { status: "UNSAT", diagnostics: validation.errors };
    return feasible(input, assignments, "PROVEN", validation.warnings.map((w) => w.message));
  }

  const lower = lowerBound(input, prep);
  const maxH = Math.max(lower, input.maxBlockHorizon);
  let smallerExhausted = true;

  for (let horizon = lower; horizon <= maxH; horizon += 1) {
    if (Date.now() >= deadline) {
      return timeoutResult(smallerExhausted ? undefined : undefined);
    }
    const found = searchHorizon(input, prep, horizon, deadline);
    if (found.timedOut) {
      return timeoutResult(found.assignments);
    }
    if (found.assignments) {
      const validation = validateSchedule(input, found.assignments);
      if (!validation.ok) {
        return {
          status: "UNSAT",
          diagnostics: [
            diagnostic(
              "SOLVER_REJECTED_CANDIDATE",
              "The search built a lineup that failed the independent validator, so nothing was published. This is not proof the session is impossible.",
            ),
            ...validation.errors,
          ],
        };
      }
      const optimality = smallerExhausted ? "PROVEN" : "NOT_PROVEN";
      const notes = validation.warnings.map((w) => w.message);
      if (optimality === "PROVEN") {
        notes.unshift("Minimum block count for this attendance was proven. The matchup score is the first deterministic valid lineup, not a clinical ranking.");
      } else {
        notes.unshift("Valid schedule — not proven shortest.");
      }
      return feasible(input, found.assignments, optimality, notes);
    }
    smallerExhausted = true;
  }

  return {
    status: "UNSAT",
    diagnostics: [
      diagnostic(
        "SCHEDULE_INFEASIBLE",
        `No complete schedule exists within ${maxH} blocks under the Saturday rules: 3 hard sessions, one resting block between hard sessions, three locations, and at most 2 volunteer sessions. Limits were not relaxed and nobody was dropped.`,
        { details: { maxBlockHorizon: maxH, lowerBound: lower } },
      ),
    ],
  };
}

function feasible(
  input: ScheduleInput,
  assignments: Assignment[],
  optimality: "PROVEN" | "NOT_PROVEN",
  diagnostics: string[],
): SolveResult {
  const blockCount = assignments.reduce((max, a) => Math.max(max, a.blockIndex), 0);
  return {
    status: "FEASIBLE",
    assignments,
    blockCount,
    score: scoreSchedule(input, assignments),
    optimality,
    diagnostics,
  };
}

function timeoutResult(best?: Assignment[]): SolveResult {
  return {
    status: "TIME_BUDGET_EXHAUSTED",
    diagnostics: [
      diagnostic(
        "SEARCH_BUDGET_EXHAUSTED",
        "Time ran out before the search finished. This is not proof that a schedule is impossible.",
      ),
    ],
    bestValidCandidate: best,
  };
}

type Prep = {
  diagnostics: ConflictDiagnostic[];
  demand: number;
  needed: Map<string, number>;
  eligibleIds: Map<string, string[]>;
  fixedByFighter: Map<string, Assignment[]>;
};

function prepare(input: ScheduleInput): Prep {
  const diagnostics: ConflictDiagnostic[] = [];
  if (input.fighters.length === 0) {
    diagnostics.push(
      diagnostic("EMPTY_FIGHTER_ATTENDANCE", "No fighters are checked in. Check fighters in before generating a rundown."),
    );
    return { diagnostics, demand: 0, needed: new Map(), eligibleIds: new Map(), fixedByFighter: new Map() };
  }
  if (input.requiredHardSessions !== 3 || input.maxVolunteerSessions !== 2 || input.restGapBlocks !== 1) {
    diagnostics.push(
      diagnostic(
        "INPUT_INVALID",
        "Version 1 only schedules the Saturday preset: 3 hard sessions, volunteer cap 2, and one resting block.",
      ),
    );
  }

  const partial = validateSchedule(input, input.fixedAssignments, { mode: "partial" });
  if (!partial.ok) {
    const schedulingCodes = new Set([
      "REST_SPACING_CONFLICT",
      "ATHLETE_DOUBLE_BOOKED",
      "BLOCK_CAPACITY_EXCEEDED",
      "NUMERIC_LIMIT",
      "EXPLICIT_EXCLUSION",
      "VOLUNTEER_MAX_EXCEEDED",
      "LOCATION_COVERAGE_CONFLICT",
      "DUPLICATE_PAIRING",
      "VOLUNTEER_SAME_FIGHTER",
      "SESSION_COUNT",
    ]);
    diagnostics.push(
      ...partial.errors.map((error) => {
        if (input.fixedAssignments.length > 0 && (error.assignmentId || schedulingCodes.has(error.code))) {
          return diagnostic("FIXED_ASSIGNMENT_CONFLICT", `Locked or completed work already conflicts: ${error.message}`, {
            fighterId: error.fighterId,
            volunteerId: error.volunteerId,
            assignmentId: error.assignmentId,
            blockIndex: error.blockIndex,
            location: error.location,
          });
        }
        return error;
      }),
    );
    return { diagnostics, demand: 0, needed: new Map(), eligibleIds: new Map(), fixedByFighter: new Map() };
  }

  const fixedByFighter = new Map<string, Assignment[]>();
  for (const fighter of input.fighters) fixedByFighter.set(fighter.athleteId, []);
  for (const assignment of input.fixedAssignments) {
    const list = fixedByFighter.get(assignment.fighterId);
    if (list) list.push(assignment);
  }

  const needed = new Map<string, number>();
  const eligibleIds = new Map<string, string[]>();
  let demand = 0;
  for (const fighter of input.fighters) {
    const fixed = fixedByFighter.get(fighter.athleteId) ?? [];
    const counting = fixed.filter((a) => countsAsHardSession(a.status));
    const need = input.requiredHardSessions - counting.length;
    needed.set(fighter.athleteId, need);
    demand += Math.max(need, 0);
    const unavailable = new Set(input.unavailableIds ?? []);
    const blockedVolunteers = new Set(fixed.map((a) => a.volunteerId));
    const eligible = input.volunteers.filter((volunteer) => {
      if (unavailable.has(volunteer.athleteId)) return false;
      if (blockedVolunteers.has(volunteer.athleteId)) return false;
      const used = volunteerLoad(input, volunteer.athleteId);
      if (used >= input.maxVolunteerSessions) return false;
      return evaluatePair({
        sessionId: input.sessionId,
        fighter,
        volunteer,
        limits: input.limits,
        restrictions: input.restrictions,
        overrides: input.overrides,
      }).eligible;
    });
    eligibleIds.set(fighter.athleteId, eligible.map((v) => v.athleteId).sort());
    if (need > 0 && eligible.length < need) {
      diagnostics.push(
        diagnostic(
          "INSUFFICIENT_ELIGIBLE_PARTNERS",
          `${fighter.displayName} has ${eligible.length} eligible volunteers and needs ${need} more distinct partners.`,
          { fighterId: fighter.athleteId, details: { eligible: eligible.length, needed: need } },
        ),
      );
    }
  }

  const unavailableForCapacity = new Set(input.unavailableIds ?? []);
  let capacity = 0;
  for (const volunteer of input.volunteers) {
    if (unavailableForCapacity.has(volunteer.athleteId)) continue;
    capacity += Math.max(0, input.maxVolunteerSessions - volunteerLoad(input, volunteer.athleteId));
  }
  if (capacity < demand) {
    diagnostics.push(
      diagnostic(
        "INSUFFICIENT_TOTAL_VOLUNTEER_CAPACITY",
        `This Saturday needs ${demand} open hard sessions, and the checked-in volunteers have ${capacity} sessions left under the cap of ${input.maxVolunteerSessions}.`,
        { details: { demand, capacity, cap: input.maxVolunteerSessions } },
      ),
    );
  }

  return { diagnostics, demand, needed, eligibleIds, fixedByFighter };
}

function volunteerLoad(input: ScheduleInput, volunteerId: string): number {
  return input.fixedAssignments.filter((a) => a.volunteerId === volunteerId).length;
}

function lowerBound(input: ScheduleInput, prep: Prep): number {
  const totalSessions = input.fighters.length * input.requiredHardSessions;
  const capacityBound = Math.ceil(totalSessions / LOCATIONS.length);
  const spacingBound = 1 + (input.requiredHardSessions - 1) * (input.restGapBlocks + 1);
  const fixedMax = input.fixedAssignments.reduce((max, a) => Math.max(max, a.blockIndex), 0);
  const basic = Math.max(capacityBound, input.requiredHardSessions === 3 ? 5 : spacingBound);
  return Math.max(basic, spacingBound, fixedMax, prep.demand > 0 ? 1 : 0);
}

function blockPatterns(horizon: number, count: number, restGap: number): number[][] {
  const out: number[][] = [];
  const step = restGap + 1;
  const current: number[] = [];
  const walk = (start: number) => {
    if (current.length === count) {
      out.push(current.slice());
      return;
    }
    const remaining = count - current.length;
    const lastStart = horizon - (remaining - 1) * step;
    for (let block = start; block <= lastStart; block += 1) {
      current.push(block);
      walk(block + step);
      current.pop();
    }
  };
  walk(1);
  return out;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const perm of permutations(rest)) out.push([items[i], ...perm]);
  }
  return out;
}

function searchHorizon(
  input: ScheduleInput,
  prep: Prep,
  horizon: number,
  deadline: number,
): { assignments?: Assignment[]; timedOut: boolean } {
  const patterns = blockPatterns(horizon, input.requiredHardSessions, input.restGapBlocks);
  const patternOptions = new Map<string, number[][]>();
  for (const fighter of input.fighters) {
    const fixed = prep.fixedByFighter.get(fighter.athleteId) ?? [];
    const countingBlocks = fixed.filter((a) => countsAsHardSession(a.status)).map((a) => a.blockIndex);
    const occupied = new Set(fixed.map((a) => a.blockIndex));
    const forbidden = new Set<number>();
    for (const block of occupied) {
      for (let delta = 0; delta <= input.restGapBlocks; delta += 1) {
        forbidden.add(block - delta);
        forbidden.add(block + delta);
      }
    }
    const countingSet = new Set(countingBlocks);
    const options = patterns.filter((pattern) => {
      if (!countingBlocks.every((block) => pattern.includes(block))) return false;
      return pattern.every((block) => countingSet.has(block) || !forbidden.has(block));
    });
    if ((prep.needed.get(fighter.athleteId) ?? 0) >= 0 && options.length === 0 && countingBlocks.length < input.requiredHardSessions) {
      return { timedOut: false };
    }
    patternOptions.set(fighter.athleteId, options);
  }

  const order = input.fighters
    .map((fighter) => fighter.athleteId)
    .sort((a, b) => {
      const optionGap = (patternOptions.get(a)?.length ?? 0) - (patternOptions.get(b)?.length ?? 0);
      if (optionGap !== 0) return optionGap;
      const eligibleGap = (prep.eligibleIds.get(a)?.length ?? 0) - (prep.eligibleIds.get(b)?.length ?? 0);
      if (eligibleGap !== 0) return eligibleGap;
      return a.localeCompare(b);
    });

  const load = new Array<number>(horizon + 1).fill(0);
  const blockPeople = new Map<number, Set<string>>();
  const blockLocMask = new Array<number>(horizon + 1).fill(0);
  for (let block = 1; block <= horizon; block += 1) blockPeople.set(block, new Set());
  for (const assignment of input.fixedAssignments) {
    if (assignment.blockIndex <= horizon) {
      load[assignment.blockIndex] += 1;
      blockPeople.get(assignment.blockIndex)?.add(assignment.fighterId);
      blockPeople.get(assignment.blockIndex)?.add(assignment.volunteerId);
      blockLocMask[assignment.blockIndex] |= LOCATION_BIT[assignment.location];
    }
  }

  const chosen = new Map<string, number[]>();
  let timedOut = false;

  const placePattern = (fighterId: string, pattern: number[]): boolean => {
    const fixedBlocks = new Set(
      (prep.fixedByFighter.get(fighterId) ?? []).map((a) => a.blockIndex),
    );
    for (const block of pattern) {
      if (!fixedBlocks.has(block) && load[block] >= LOCATIONS.length) return false;
    }
    for (const block of pattern) {
      if (!fixedBlocks.has(block)) {
        load[block] += 1;
        blockPeople.get(block)?.add(fighterId);
      }
    }
    chosen.set(fighterId, pattern);
    return true;
  };

  const unplacePattern = (fighterId: string, pattern: number[]) => {
    const fixedBlocks = new Set(
      (prep.fixedByFighter.get(fighterId) ?? []).map((a) => a.blockIndex),
    );
    for (const block of pattern) {
      if (!fixedBlocks.has(block)) {
        load[block] -= 1;
        blockPeople.get(block)?.delete(fighterId);
      }
    }
    chosen.delete(fighterId);
  };

  const assignFighters = (index: number): Assignment[] | undefined => {
    if (Date.now() >= deadline) {
      timedOut = true;
      return undefined;
    }
    if (index === order.length) {
      return assignLocations(input, prep, chosen, order, blockLocMask, blockPeople, deadline, () => {
        timedOut = true;
      });
    }
    const fighterId = order[index];
    const options = patternOptions.get(fighterId) ?? [];
    if ((prep.needed.get(fighterId) ?? 0) === 0) {
      const fixedBlocks = (prep.fixedByFighter.get(fighterId) ?? [])
        .filter((a) => countsAsHardSession(a.status))
        .map((a) => a.blockIndex)
        .sort((a, b) => a - b);
      chosen.set(fighterId, fixedBlocks);
      const done = assignFighters(index + 1);
      chosen.delete(fighterId);
      return done;
    }
    for (const pattern of options) {
      if (!placePattern(fighterId, pattern)) continue;
      const done = assignFighters(index + 1);
      unplacePattern(fighterId, pattern);
      if (done) return done;
      if (timedOut) return undefined;
    }
    return undefined;
  };

  const assignments = assignFighters(0);
  if (timedOut && !assignments) return { timedOut: true };
  if (!assignments) return { timedOut: false };
  return { assignments, timedOut: false };
}

function assignLocations(
  input: ScheduleInput,
  prep: Prep,
  patterns: Map<string, number[]>,
  fighterOrder: string[],
  blockLocMask: number[],
  blockPeople: Map<number, Set<string>>,
  deadline: number,
  markTimeout: () => void,
): Assignment[] | undefined {
  const placed = new Map<string, Map<number, Location>>();
  const byId = new Map(input.fighters.map((fighter) => [fighter.athleteId, fighter]));

  const walk = (index: number): Assignment[] | undefined => {
    if (Date.now() >= deadline) {
      markTimeout();
      return undefined;
    }
    if (index === fighterOrder.length) {
      return assignVolunteers(input, prep, placed, blockPeople, deadline, markTimeout);
    }
    const fighter = byId.get(fighterOrder[index]);
    if (!fighter) return undefined;
    const pattern = patterns.get(fighter.athleteId) ?? [];
    const fixed = (prep.fixedByFighter.get(fighter.athleteId) ?? []).filter((a) => countsAsHardSession(a.status));
    const fixedLoc = new Map<number, Location>(fixed.map((a) => [a.blockIndex, a.location]));
    const openBlocks = pattern.filter((block) => !fixedLoc.has(block));
    const used = new Set(fixedLoc.values());
    const openLocs = LOCATIONS.filter((location) => !used.has(location));
    if (openBlocks.length !== openLocs.length) return undefined;

    const applyFresh = (fresh: Array<[number, Location]>, mapping: Map<number, Location>): boolean => {
      for (const [block, location] of fresh) {
        if (blockLocMask[block] & LOCATION_BIT[location]) return false;
      }
      for (const [block, location] of fresh) blockLocMask[block] |= LOCATION_BIT[location];
      placed.set(fighter.athleteId, mapping);
      return true;
    };
    const undoFresh = (fresh: Array<[number, Location]>) => {
      for (const [block, location] of fresh) blockLocMask[block] &= ~LOCATION_BIT[location];
      placed.delete(fighter.athleteId);
    };

    if (openBlocks.length === 0) {
      placed.set(fighter.athleteId, new Map(fixedLoc));
      const done = walk(index + 1);
      placed.delete(fighter.athleteId);
      return done;
    }

    for (const perm of permutations(openLocs)) {
      const mapping = new Map(fixedLoc);
      const fresh: Array<[number, Location]> = [];
      openBlocks.forEach((block, i) => {
        const location = perm[i];
        mapping.set(block, location);
        fresh.push([block, location]);
      });
      if (!applyFresh(fresh, mapping)) continue;
      const done = walk(index + 1);
      undoFresh(fresh);
      if (done) return done;
    }
    return undefined;
  };

  return walk(0);
}

function assignVolunteers(
  input: ScheduleInput,
  prep: Prep,
  placed: Map<string, Map<number, Location>>,
  blockPeople: Map<number, Set<string>>,
  deadline: number,
  markTimeout: () => void,
): Assignment[] | undefined {
  const athletes = new Map<string, SessionAthlete>();
  for (const fighter of input.fighters) athletes.set(fighter.athleteId, fighter);
  for (const volunteer of input.volunteers) athletes.set(volunteer.athleteId, volunteer);

  const slots: Slot[] = [];
  for (const fighter of input.fighters) {
    const mapping = placed.get(fighter.athleteId);
    if (!mapping) return undefined;
    const fixed = prep.fixedByFighter.get(fighter.athleteId) ?? [];
    const fixedByBlock = new Map(fixed.filter((a) => countsAsHardSession(a.status)).map((a) => [a.blockIndex, a]));
    for (const [blockIndex, location] of mapping) {
      const fixedAssignment = fixedByBlock.get(blockIndex);
      slots.push({
        fighterId: fighter.athleteId,
        blockIndex,
        location,
        fixedVolunteerId: fixedAssignment?.volunteerId,
        fixedAssignment,
      });
    }
  }

  const volCount = new Map<string, number>();
  const volBlocks = new Map<string, number[]>();
  const volFighters = new Map<string, Set<string>>();
  for (const volunteer of input.volunteers) {
    volCount.set(volunteer.athleteId, 0);
    volBlocks.set(volunteer.athleteId, []);
    volFighters.set(volunteer.athleteId, new Set());
  }
  for (const assignment of input.fixedAssignments) {
    const count = volCount.get(assignment.volunteerId);
    if (count === undefined) continue;
    volCount.set(assignment.volunteerId, count + 1);
    volBlocks.get(assignment.volunteerId)?.push(assignment.blockIndex);
    volFighters.get(assignment.volunteerId)?.add(assignment.fighterId);
  }

  const chosen = new Map<string, string>();
  const open = slots.filter((slot) => !slot.fixedVolunteerId);

  const unavailable = new Set(input.unavailableIds ?? []);
  const candidatesFor = (slot: Slot): string[] => {
    const fighter = athletes.get(slot.fighterId);
    if (!fighter) return [];
    const ids: { id: string; score: number }[] = [];
    for (const volunteer of input.volunteers) {
      if (unavailable.has(volunteer.athleteId)) continue;
      if ((volCount.get(volunteer.athleteId) ?? 0) >= input.maxVolunteerSessions) continue;
      if (volFighters.get(volunteer.athleteId)?.has(slot.fighterId)) continue;
      if (blockPeople.get(slot.blockIndex)?.has(volunteer.athleteId)) continue;
      const blocks = volBlocks.get(volunteer.athleteId) ?? [];
      if (blocks.some((block) => Math.abs(block - slot.blockIndex) < input.restGapBlocks + 1)) continue;
      const decision = evaluatePair({
        sessionId: input.sessionId,
        fighter,
        volunteer,
        limits: input.limits,
        restrictions: input.restrictions,
        overrides: input.overrides,
      });
      if (!decision.eligible) continue;
      ids.push({
        id: volunteer.athleteId,
        score: pairCompatibility(fighter, volunteer, input.limits, input.scoringWeights),
      });
    }
    ids.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return ids.map((item) => item.id);
  };

  const apply = (slot: Slot, volunteerId: string) => {
    volCount.set(volunteerId, (volCount.get(volunteerId) ?? 0) + 1);
    volBlocks.get(volunteerId)?.push(slot.blockIndex);
    volFighters.get(volunteerId)?.add(slot.fighterId);
    blockPeople.get(slot.blockIndex)?.add(volunteerId);
    chosen.set(`${slot.fighterId}:${slot.blockIndex}`, volunteerId);
  };
  const undo = (slot: Slot, volunteerId: string) => {
    volCount.set(volunteerId, (volCount.get(volunteerId) ?? 1) - 1);
    volBlocks.get(volunteerId)?.pop();
    volFighters.get(volunteerId)?.delete(slot.fighterId);
    blockPeople.get(slot.blockIndex)?.delete(volunteerId);
    chosen.delete(`${slot.fighterId}:${slot.blockIndex}`);
  };

  const forwardOk = (remaining: Slot[]): boolean => {
    let capacity = 0;
    for (const volunteer of input.volunteers) {
      if (unavailable.has(volunteer.athleteId)) continue;
      capacity += Math.max(0, input.maxVolunteerSessions - (volCount.get(volunteer.athleteId) ?? 0));
    }
    if (capacity < remaining.length) return false;
    const byFighter = new Map<string, number>();
    for (const slot of remaining) byFighter.set(slot.fighterId, (byFighter.get(slot.fighterId) ?? 0) + 1);
    for (const [fighterId, count] of byFighter) {
      const fighter = athletes.get(fighterId);
      if (!fighter) return false;
      let available = 0;
      for (const volunteer of input.volunteers) {
        if (unavailable.has(volunteer.athleteId)) continue;
        if (volFighters.get(volunteer.athleteId)?.has(fighterId)) continue;
        if ((volCount.get(volunteer.athleteId) ?? 0) >= input.maxVolunteerSessions) continue;
        const decision = evaluatePair({
          sessionId: input.sessionId,
          fighter,
          volunteer,
          limits: input.limits,
          restrictions: input.restrictions,
          overrides: input.overrides,
        });
        if (decision.eligible) available += 1;
      }
      if (available < count) return false;
    }
    return true;
  };

  const walk = (remaining: Slot[]): boolean => {
    if (Date.now() >= deadline) {
      markTimeout();
      return false;
    }
    if (remaining.length === 0) return true;
    let bestIndex = 0;
    let best: string[] = [];
    let bestCount = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const options = candidatesFor(remaining[i]);
      if (options.length < bestCount) {
        bestCount = options.length;
        bestIndex = i;
        best = options;
        if (bestCount === 0) break;
      }
    }
    if (bestCount === 0) return false;
    const slot = remaining[bestIndex];
    const rest = remaining.slice(0, bestIndex).concat(remaining.slice(bestIndex + 1));
    for (const volunteerId of best) {
      apply(slot, volunteerId);
      if (forwardOk(rest) && walk(rest)) return true;
      undo(slot, volunteerId);
      if (Date.now() >= deadline) {
        markTimeout();
        return false;
      }
    }
    return false;
  };

  if (!forwardOk(open) || !walk(open)) return undefined;

  const assignments: Assignment[] = input.fixedAssignments.map((assignment) => ({ ...assignment }));
  for (const slot of open) {
    const volunteerId = chosen.get(`${slot.fighterId}:${slot.blockIndex}`);
    if (!volunteerId) return undefined;
    const fighter = athletes.get(slot.fighterId);
    const volunteer = athletes.get(volunteerId);
    let overrideId: string | undefined;
    if (fighter && volunteer) {
      const decision = evaluatePair({
        sessionId: input.sessionId,
        fighter,
        volunteer,
        limits: input.limits,
        restrictions: input.restrictions,
        overrides: input.overrides,
      });
      overrideId = decision.overrideId;
    }
    assignments.push({
      assignmentId: `asg_${slot.blockIndex}_${slot.location}_${slot.fighterId}_${volunteerId}`,
      sessionId: input.sessionId,
      generationId: input.generationId,
      blockIndex: slot.blockIndex,
      location: slot.location,
      fighterId: slot.fighterId,
      volunteerId,
      status: "PLANNED",
      locked: false,
      approvedNumericExceptionId: overrideId,
    });
  }
  return sortAssignments(assignments);
}

function sortAssignments(assignments: Assignment[]): Assignment[] {
  const order: Record<Location, number> = { MAIN_RING: 0, FLOOR_1: 1, FLOOR_2: 2 };
  return assignments.slice().sort((a, b) => {
    return (
      a.blockIndex - b.blockIndex ||
      order[a.location] - order[b.location] ||
      a.fighterId.localeCompare(b.fighterId)
    );
  });
}
