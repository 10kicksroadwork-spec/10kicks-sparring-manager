import { randomUUID } from "node:crypto";
import { coachNextSteps } from "@/lib/domain/diagnostics";
import { rundownStarted } from "@/lib/domain/rundown";
import { solveSchedule } from "@/lib/domain/solver";
import type { Assignment, Location, SolveResult } from "@/lib/domain/types";
import { validateSchedule } from "@/lib/domain/validator";
import type { StoredAssignment } from "@/lib/repository/types";
import { activeAssignments, loadSession, toScheduleInput, viewSignature } from "./snapshot";
import { type Actor, fail, type ServiceResult, ServiceStop, withWrite } from "./support";

function publicSolve(result: SolveResult) {
  if (result.status === "FEASIBLE") {
    return {
      status: result.status,
      blockCount: result.blockCount,
      score: result.score,
      optimality: result.optimality,
      diagnostics: result.diagnostics,
      assignmentCount: result.assignments.length,
      label: result.optimality === "PROVEN" ? "Valid schedule" : "Valid schedule — not proven shortest",
    };
  }
  if (result.status === "UNSAT") {
    return {
      status: result.status,
      diagnostics: result.diagnostics,
      nextSteps: coachNextSteps(result.diagnostics.map((item) => item.code)),
    };
  }
  return {
    status: result.status,
    diagnostics: result.diagnostics,
    nextSteps: coachNextSteps(["SEARCH_BUDGET_EXHAUSTED"]),
  };
}

function seedFor(sessionId: string): number {
  let hash = 0;
  for (const char of sessionId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash || 1;
}

async function solveView(repo: Parameters<typeof toScheduleInput>[0], view: NonNullable<Awaited<ReturnType<typeof loadSession>>>, rows: StoredAssignment[]) {
  const generationId = randomUUID();
  const scheduleInput = await toScheduleInput(repo, view, generationId, rows);
  const budget = Math.min(Math.max(view.session.settings.solverBudgetMs ?? 15_000, 1), 25_000);
  let solved = solveSchedule(scheduleInput, { maxComputeMs: budget, deterministicSeed: seedFor(view.session.sessionId) });
  if (solved.status === "TIME_BUDGET_EXHAUSTED" && solved.bestValidCandidate) {
    const validation = validateSchedule(scheduleInput, solved.bestValidCandidate);
    if (validation.ok) {
      const blockCount = solved.bestValidCandidate.reduce((max, row) => Math.max(max, row.blockIndex), 0);
      solved = {
        status: "FEASIBLE",
        assignments: solved.bestValidCandidate,
        blockCount,
        score: 0,
        optimality: "NOT_PROVEN",
        diagnostics: ["Valid schedule — not proven shortest."],
      };
    }
  }
  return { solved, scheduleInput };
}

function rowsFrom(assignments: Assignment[], actorEmail: string, now: string, generationId: string): StoredAssignment[] {
  return assignments.map((assignment) => ({
    ...assignment,
    generationId,
    updatedAt: now,
    updatedBy: actorEmail,
  }));
}

export async function generate(actor: Actor, sessionId: string, body: { requestId: string; expectedRevision: number }): Promise<ServiceResult<Record<string, unknown>>> {
  return persistSolve(actor, sessionId, body, "generate", false);
}

async function persistSolve(
  actor: Actor,
  sessionId: string,
  body: { requestId: string; expectedRevision: number },
  eventType: "generate" | "regenerate",
  preserveFixed: boolean,
): Promise<ServiceResult<Record<string, unknown>>> {
  const { openStore } = await import("./support");
  const opened = await openStore(body.requestId);
  if ("ok" in opened) return opened;
  const earlier = (await opened.repo.readAudit(sessionId)).rows.find((row) => row.requestId === body.requestId);
  if (earlier && "data" in earlier.payload) {
    return { ok: true, data: earlier.payload.data as Record<string, unknown>, revision: earlier.newRevision, requestId: body.requestId };
  }
  const preview = await loadSession(opened.repo, sessionId);
  if (!preview) return fail(404, "NOT_FOUND", "That session does not exist.", body.requestId);
  if (preview.session.status === "CANCELLED") return fail(409, "SESSION_CANCELLED", "This session is cancelled.", body.requestId);
  if (preview.session.revision !== body.expectedRevision) {
    return fail(409, "STALE_REVISION", "Another coach updated this session. Refresh the rundown.", body.requestId);
  }
  if (!preserveFixed && preview.session.activeGenerationId) {
    return fail(409, "ALREADY_GENERATED", "A rundown already exists. Regenerate the unfinished part instead of replacing it.", body.requestId);
  }
  if (preserveFixed && !preview.session.activeGenerationId) {
    return fail(409, "NOT_GENERATED", "Generate a rundown before regenerating.", body.requestId);
  }
  const signature = viewSignature(preview);
  const currentRows = activeAssignments(preview);
  const { solved } = await solveView(opened.repo, preview, preserveFixed ? currentRows : []);
  if (solved.status !== "FEASIBLE") {
    return { ok: true, data: { published: false, solve: publicSolve(solved) }, revision: preview.session.revision, requestId: body.requestId };
  }
  const generationId = randomUUID();
  return withWrite({
    actor,
    action: "runSession",
    sessionId,
    expectedRevision: body.expectedRevision,
    requestId: body.requestId,
    eventType,
    run: async ({ repo, session, now }) => {
      if (!session) throw new ServiceStop(fail(404, "NOT_FOUND", "That session does not exist.", body.requestId));
      const fresh = await loadSession(repo, sessionId);
      if (!fresh || viewSignature(fresh) !== signature) {
        throw new ServiceStop(fail(409, "STALE_REVISION", "Attendance changed. Refresh and generate again. Nothing was published.", body.requestId));
      }
      const scheduleInput = await toScheduleInput(repo, fresh, generationId, preserveFixed ? activeAssignments(fresh) : []);
      const validation = validateSchedule(scheduleInput, solved.assignments.map((row) => ({ ...row, generationId })));
      if (!validation.ok) {
        throw new ServiceStop(fail(409, "STALE_REVISION", "The lineup no longer fits this attendance. Refresh and generate again.", body.requestId, {
          diagnostics: validation.errors,
        }));
      }
      const inserts = rowsFrom(solved.assignments, actor.email, now, generationId);
      return {
        data: { published: true, generationId, solve: publicSolve({ ...solved, assignments: inserts }), assignments: inserts },
        session: { ...session, activeGenerationId: generationId, status: session.status === "COMPLETED" ? session.status : "READY" },
        batch: { assignmentInserts: inserts },
        payload: { previousGenerationId: session.activeGenerationId, generationId },
      };
    },
  });
}

export async function regenerate(actor: Actor, sessionId: string, body: { requestId: string; expectedRevision: number }) {
  return persistSolve(actor, sessionId, body, "regenerate", true);
}

export async function unpublishRundown(
  actor: Actor,
  sessionId: string,
  body: { requestId: string; expectedRevision: number },
): Promise<ServiceResult<{ cleared: boolean }>> {
  return withWrite({
    actor,
    action: "runSession",
    sessionId,
    expectedRevision: body.expectedRevision,
    requestId: body.requestId,
    eventType: "schedule.unpublish",
    run: async ({ repo, session }) => {
      if (!session) throw new ServiceStop(fail(404, "NOT_FOUND", "That session does not exist.", body.requestId));
      if (!session.activeGenerationId) {
        throw new ServiceStop(fail(409, "NOT_GENERATED", "There is no rundown to discard.", body.requestId));
      }
      const view = await loadSession(repo, sessionId);
      const active = view ? activeAssignments(view) : [];
      if (rundownStarted(session.status, active)) {
        throw new ServiceStop(
          fail(
            409,
            "RUNDOWN_STARTED",
            "Sparring has started. Completed and locked matches stay. Regenerate the unfinished part instead of discarding the card.",
            body.requestId,
          ),
        );
      }
      return {
        data: { cleared: true },
        session: { ...session, activeGenerationId: "", status: "READY" },
      };
    },
  });
}

export async function patchAssignment(
  actor: Actor,
  sessionId: string,
  assignmentId: string,
  body: {
    requestId: string;
    expectedRevision: number;
    action: "lock" | "unlock" | "set-volunteer" | "set-location" | "set-status";
    volunteerId?: string;
    location?: Location;
    status?: Assignment["status"];
    confirmBothRounds?: boolean;
  },
): Promise<ServiceResult<{ assignment: StoredAssignment }>> {
  return withWrite({
    actor,
    action: "runSession",
    sessionId,
    expectedRevision: body.expectedRevision,
    requestId: body.requestId,
    eventType: `assignment.${body.action}`,
    run: async ({ repo, session, now }) => {
      if (!session?.activeGenerationId) throw new ServiceStop(fail(409, "NOT_GENERATED", "Generate a rundown first.", body.requestId));
      const view = await loadSession(repo, sessionId);
      if (!view) throw new ServiceStop(fail(404, "NOT_FOUND", "That session does not exist.", body.requestId));
      const active = activeAssignments(view);
      const current = active.find((row) => row.assignmentId === assignmentId);
      if (!current) throw new ServiceStop(fail(404, "NOT_FOUND", "That match is not on the active rundown.", body.requestId));
      const next: StoredAssignment = { ...current, updatedAt: now, updatedBy: actor.email };
      if (body.action === "lock") next.locked = true;
      if (body.action === "unlock") next.locked = false;
      if (body.action === "set-location") {
        if (!body.location) throw new ServiceStop(fail(400, "BAD_REQUEST", "Choose a location.", body.requestId));
        next.location = body.location;
      }
      if (body.action === "set-status") {
        if (body.status === "COMPLETED" && !body.confirmBothRounds) {
          throw new ServiceStop(fail(400, "CONFIRM_ROUNDS", "Confirm both rounds were finished before marking the match complete.", body.requestId));
        }
        if (!body.status) throw new ServiceStop(fail(400, "BAD_REQUEST", "Choose a status.", body.requestId));
        next.status = body.status;
      }
      if (body.action === "set-volunteer") {
        if (!body.volunteerId) throw new ServiceStop(fail(400, "BAD_REQUEST", "Choose a volunteer.", body.requestId));
        const input = await toScheduleInput(repo, view, session.activeGenerationId, active);
        const fighter = input.fighters.find((row) => row.athleteId === current.fighterId);
        const volunteer = input.volunteers.find((row) => row.athleteId === body.volunteerId);
        if (!fighter || !volunteer) {
          throw new ServiceStop(fail(400, "NOT_ELIGIBLE", "That volunteer is not checked in for this session.", body.requestId));
        }
        const { evaluatePair } = await import("@/lib/domain/matchmaking");
        const decision = evaluatePair({
          sessionId,
          fighter,
          volunteer,
          limits: input.limits,
          restrictions: input.restrictions,
          overrides: input.overrides,
        });
        if (!decision.eligible) {
          throw new ServiceStop(fail(400, "NOT_ELIGIBLE", decision.reasons.join(" "), body.requestId));
        }
        next.volunteerId = body.volunteerId;
        next.approvedNumericExceptionId = decision.overrideId;
      }
      const input = await toScheduleInput(repo, view, session.activeGenerationId, active.map((row) => (row.assignmentId === assignmentId ? next : row)));
      const validation = validateSchedule(input, active.map((row) => (row.assignmentId === assignmentId ? next : row)));
      if (!validation.ok) {
        throw new ServiceStop(fail(400, "INVALID_SCHEDULE", validation.errors[0]?.message ?? "That change breaks the Saturday rules.", body.requestId, {
          diagnostics: validation.errors,
        }));
      }
      const progressed = next.status === "COMPLETED" || next.status === "IN_PROGRESS" ? "IN_PROGRESS" : session.status;
      return {
        data: { assignment: next },
        session: { ...session, status: session.status === "CANCELLED" ? session.status : progressed },
        batch: { assignmentUpdates: [next] },
        payload: { before: { volunteerId: current.volunteerId, location: current.location, status: current.status, locked: current.locked } },
      };
    },
  });
}

export async function completeBlock(
  actor: Actor,
  sessionId: string,
  blockIndex: number,
  body: { requestId: string; expectedRevision: number; confirmBothRounds: true },
): Promise<ServiceResult<{ blockIndex: number; updated: number }>> {
  return withWrite({
    actor,
    action: "runSession",
    sessionId,
    expectedRevision: body.expectedRevision,
    requestId: body.requestId,
    eventType: "block.complete",
    run: async ({ repo, session, now }) => {
      if (!session?.activeGenerationId) throw new ServiceStop(fail(409, "NOT_GENERATED", "Generate a rundown first.", body.requestId));
      if (!body.confirmBothRounds) {
        throw new ServiceStop(fail(400, "CONFIRM_ROUNDS", "Confirm every match in the block finished both rounds.", body.requestId));
      }
      const view = await loadSession(repo, sessionId);
      if (!view) throw new ServiceStop(fail(404, "NOT_FOUND", "That session does not exist.", body.requestId));
      const active = activeAssignments(view).filter((row) => row.blockIndex === blockIndex && row.status !== "INTERRUPTED");
      if (active.length === 0) throw new ServiceStop(fail(404, "NOT_FOUND", "That block has no hard matches to complete.", body.requestId));
      const updates = active.map((row) => ({ ...row, status: "COMPLETED" as const, updatedAt: now, updatedBy: actor.email }));
      return {
        data: { blockIndex, updated: updates.length },
        session: { ...session, status: "IN_PROGRESS", currentBlockIndex: Math.max(session.currentBlockIndex, blockIndex + 1) },
        batch: { assignmentUpdates: updates },
      };
    },
  });
}

export async function undoGeneration(
  actor: Actor,
  sessionId: string,
  body: { requestId: string; expectedRevision: number },
): Promise<ServiceResult<{ activeGenerationId: string }>> {
  return withWrite({
    actor,
    action: "runSession",
    sessionId,
    expectedRevision: body.expectedRevision,
    requestId: body.requestId,
    eventType: "schedule.undo",
    run: async ({ repo, session }) => {
      if (!session) throw new ServiceStop(fail(404, "NOT_FOUND", "That session does not exist.", body.requestId));
      const audit = await repo.readAudit(sessionId);
      const previous = [...audit.rows].reverse().find((row) => row.eventType === "generate" || row.eventType === "regenerate");
      const previousGenerationId = String(previous?.payload.previousGenerationId ?? "");
      if (!previous || !previousGenerationId) {
        throw new ServiceStop(fail(409, "NOTHING_TO_UNDO", "There is no earlier rundown to restore.", body.requestId));
      }
      const view = await loadSession(repo, sessionId);
      if (!view) throw new ServiceStop(fail(404, "NOT_FOUND", "That session does not exist.", body.requestId));
      const current = activeAssignments(view);
      const priorRows = view.assignments.filter((row) => row.generationId === previousGenerationId);
      for (const row of current) {
        if (!(row.locked || row.status === "COMPLETED" || row.status === "IN_PROGRESS")) continue;
        const match = priorRows.find((old) => old.assignmentId === row.assignmentId);
        const same = match && match.fighterId === row.fighterId && match.volunteerId === row.volunteerId && match.location === row.location && match.blockIndex === row.blockIndex && match.status === row.status && match.locked === row.locked;
        if (!same) {
          throw new ServiceStop(fail(409, "UNDO_BLOCKED", "Completed or locked work changed after that rundown, so it was not restored.", body.requestId));
        }
      }
      const input = await toScheduleInput(repo, { ...view, session: { ...view.session, activeGenerationId: previousGenerationId } }, previousGenerationId, priorRows);
      const validation = validateSchedule(input, priorRows);
      if (!validation.ok) {
        throw new ServiceStop(fail(409, "UNDO_BLOCKED", validation.errors[0]?.message ?? "The earlier rundown is no longer valid.", body.requestId));
      }
      return {
        data: { activeGenerationId: previousGenerationId },
        session: { ...session, activeGenerationId: previousGenerationId },
      };
    },
  });
}

export async function createRestriction(
  actor: Actor,
  body: { requestId: string; athleteAId: string; athleteBId: string; reason: string; active?: boolean },
) {
  const { can } = await import("@/lib/permissions");
  if (!can(actor.role, "manageRestrictions")) return fail(403, "FORBIDDEN", "Only an admin can edit named exclusions.", body.requestId);
  return withWrite({
    actor,
    action: "manageRestrictions",
    sessionId: "",
    expectedRevision: null,
    requestId: body.requestId,
    eventType: "restriction.save",
    run: async ({ now }) => {
      const restriction = {
        restrictionId: randomUUID(),
        athleteAId: body.athleteAId,
        athleteBId: body.athleteBId,
        reason: body.reason,
        active: body.active ?? true,
        createdBy: actor.email,
        createdAt: now,
        updatedAt: now,
      };
      return { data: { restriction }, batch: { restriction }, auditSessionId: "restrictions" };
    },
  });
}
