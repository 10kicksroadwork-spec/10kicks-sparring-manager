import { randomUUID } from "node:crypto";
import { isReadyForHardMatch } from "@/lib/domain/profile";
import { saturdayPresetSettings, type MatchingLimits } from "@/lib/domain/types";
import { can } from "@/lib/permissions";
import { appTimezone } from "@/lib/env";
import type { Athlete, Attendance, SessionRecord } from "@/lib/repository/types";
import { activeAssignments, eligibilityReport, loadSession } from "./snapshot";
import { type Actor, fail, localToday, nowIso, openStore, type ServiceResult, ServiceStop, withWrite } from "./support";

function roleAllowed(athlete: Athlete, role: Attendance["assignedRole"]): boolean {
  if (athlete.roleEligibility === "BOTH") return true;
  return athlete.roleEligibility === role;
}

export async function listSessions(actor: Actor, requestId = "read"): Promise<ServiceResult<{ sessions: SessionRecord[]; corrupt: string[] }>> {
  if (!can(actor.role, "read")) return fail(403, "FORBIDDEN", "Your account cannot do that.", requestId);
  const opened = await openStore(requestId);
  if ("ok" in opened) return opened;
  const result = await opened.repo.readSessions();
  const sessions = result.rows
    .filter((session) => session.dateLocal)
    .sort((a, b) => b.dateLocal.localeCompare(a.dateLocal));
  return { ok: true, data: { sessions, corrupt: result.corrupt }, requestId };
}

export async function createSession(actor: Actor, input: { dateLocal?: string; requestId: string }): Promise<ServiceResult<{ session: SessionRecord }>> {
  const now = nowIso();
  const session: SessionRecord = {
    sessionId: randomUUID(),
    dateLocal: input.dateLocal || localToday(),
    timezone: appTimezone(),
    status: "DRAFT",
    revision: 0,
    activeGenerationId: "",
    currentBlockIndex: 1,
    settings: { ...saturdayPresetSettings(), timezone: appTimezone() },
    createdBy: actor.email,
    createdAt: now,
    updatedBy: actor.email,
    updatedAt: now,
  };
  return withWrite({
    actor,
    action: "runSession",
    sessionId: "",
    expectedRevision: null,
    requestId: input.requestId,
    eventType: "session.create",
    run: async ({ repo, now }) => {
      const roster = await repo.readAthletes();
      const attendance = campAttendance(roster.rows, session.sessionId, now, []);
      const next = attendance.length > 0 ? { ...session, status: "READY" as const } : session;
      return {
        data: { session: { ...next, revision: 1 } },
        session: next,
        batch: { attendance },
        auditSessionId: session.sessionId,
      };
    },
  });
}

function campAttendance(athletes: Athlete[], sessionId: string, now: string, existing: Attendance[]): Attendance[] {
  const seen = new Set(existing.map((row) => row.athleteId));
  const writes: Attendance[] = [];
  for (const athlete of athletes) {
    if (seen.has(athlete.athleteId)) continue;
    if (!athlete.active || athlete.roleEligibility === "VOLUNTEER" || !isReadyForHardMatch(athlete)) continue;
    if (athlete.weightLbs === null || athlete.skill === null) continue;
    writes.push({
      attendanceId: randomUUID(),
      sessionId,
      athleteId: athlete.athleteId,
      assignedRole: "FIGHTER",
      present: true,
      availabilityStatus: "AVAILABLE",
      weightLbsSnapshot: athlete.weightLbs,
      skillSnapshot: athlete.skill,
      aggressionSnapshot: athlete.aggression,
      checkedInAt: now,
      updatedAt: now,
    });
  }
  return writes;
}

export async function ensureCampFighters(
  actor: Actor,
  sessionId: string,
  body: { requestId: string; expectedRevision: number },
): Promise<ServiceResult<{ seeded: number }>> {
  if (!can(actor.role, "runSession")) return fail(403, "FORBIDDEN", "Your account cannot do that.", body.requestId);
  const opened = await openStore(body.requestId);
  if ("ok" in opened) return opened;
  const view = await loadSession(opened.repo, sessionId);
  if (!view) return fail(404, "NOT_FOUND", "That session does not exist.", body.requestId);
  if (view.session.revision !== body.expectedRevision) {
    return fail(409, "STALE_REVISION", "Another coach updated this session. Refresh the rundown.", body.requestId);
  }
  const athletes = await opened.repo.readAthletes();
  const preview = campAttendance(athletes.rows, sessionId, nowIso(), view.attendance);
  if (preview.length === 0) return { ok: true, data: { seeded: 0 }, revision: view.session.revision, requestId: body.requestId };
  return withWrite({
    actor,
    action: "runSession",
    sessionId,
    expectedRevision: body.expectedRevision,
    requestId: body.requestId,
    eventType: "attendance.camp",
    run: async ({ repo, session, now }) => {
      if (!session) throw new ServiceStop(fail(404, "NOT_FOUND", "That session does not exist.", body.requestId));
      const fresh = await loadSession(repo, sessionId);
      const roster = await repo.readAthletes();
      const rows = campAttendance(roster.rows, sessionId, now, fresh?.attendance ?? []);
      if (rows.length === 0) {
        throw new ServiceStop(fail(409, "STALE_REVISION", "Check-in was already updated. Refresh.", body.requestId));
      }
      return {
        data: { seeded: rows.length },
        session: { ...session, status: session.status === "DRAFT" ? "READY" : session.status },
        batch: { attendance: rows },
      };
    },
  });
}

export async function getSession(actor: Actor, sessionId: string, requestId = "read") {
  if (!can(actor.role, "read")) return fail(403, "FORBIDDEN", "Your account cannot do that.", requestId);
  const opened = await openStore(requestId);
  if ("ok" in opened) return opened;
  const view = await loadSession(opened.repo, sessionId);
  if (!view) return fail(404, "NOT_FOUND", "That session does not exist.", requestId);
  const athletes = await opened.repo.readAthletes();
  const names = new Map(athletes.rows.map((athlete) => [athlete.athleteId, athlete]));
  const active = activeAssignments(view);
  const eligibility = await eligibilityReport(opened.repo, view);
  const swaps: Record<string, { volunteerId: string; displayName: string; current: boolean; reasons: string[] }[]> = {};
  if (view.session.activeGenerationId) {
    const { toScheduleInput } = await import("./snapshot");
    const { eligibleVolunteersForAssignment } = await import("@/lib/domain/eligible-volunteers");
    const input = await toScheduleInput(opened.repo, view, view.session.activeGenerationId, active);
    for (const row of active) {
      if (row.locked || row.status !== "PLANNED") continue;
      swaps[row.assignmentId] = eligibleVolunteersForAssignment(input, active, row.assignmentId);
    }
  }
  return {
    ok: true as const,
    requestId,
    revision: view.session.revision,
    data: {
      session: view.session,
      attendance: view.attendance.map((row) => ({ ...row, displayName: names.get(row.athleteId)?.displayName ?? "Unknown" })),
      assignments: active,
      corrupt: view.corrupt,
      eligibility,
      swaps,
    },
  };
}

export async function putAttendance(
  actor: Actor,
  sessionId: string,
  body: {
    requestId: string;
    expectedRevision: number;
    athleteId?: string;
    assignedRole?: Attendance["assignedRole"];
    present?: boolean;
    availabilityStatus?: Attendance["availabilityStatus"];
    weightLbs?: number;
    skill?: number;
    aggression?: number | null;
    createVolunteer?: { displayName: string; weightLbs: number; skill: number; aggression?: number | null; roleEligibility: Athlete["roleEligibility"]; coachNotes?: string };
  },
): Promise<ServiceResult<{ attendance: Attendance; athlete?: Athlete }>> {
  return withWrite({
    actor,
    action: "runSession",
    sessionId,
    expectedRevision: body.expectedRevision,
    requestId: body.requestId,
    eventType: "attendance.update",
    run: async ({ repo, session, now }) => {
      if (!session) throw new ServiceStop(fail(404, "NOT_FOUND", "That session does not exist.", body.requestId));
      if (session.status === "CANCELLED") {
        throw new ServiceStop(fail(409, "SESSION_CANCELLED", "This session is cancelled.", body.requestId));
      }
      let created: Athlete | undefined;
      let athleteId = body.athleteId;
      if (body.createVolunteer) {
        created = {
          athleteId: randomUUID(),
          displayName: body.createVolunteer.displayName.trim(),
          weightLbs: body.createVolunteer.weightLbs,
          skill: body.createVolunteer.skill,
          aggression: body.createVolunteer.aggression ?? null,
          roleEligibility: "VOLUNTEER",
          active: true,
          coachNotes: body.createVolunteer.coachNotes?.trim() ?? "",
          createdAt: now,
          updatedAt: now,
        };
        athleteId = created.athleteId;
      }
      if (!athleteId) throw new ServiceStop(fail(400, "BAD_REQUEST", "Choose an athlete or add a volunteer.", body.requestId));
      const athlete = created ?? (await repo.readAthletes()).rows.find((row) => row.athleteId === athleteId);
      if (!athlete) {
        throw new ServiceStop(fail(400, "INACTIVE_ATHLETE", "That person is not on the roster.", body.requestId));
      }
      const assignedRole = body.assignedRole ?? (created ? "VOLUNTEER" : athlete.roleEligibility === "VOLUNTEER" ? "VOLUNTEER" : "FIGHTER");
      if (!roleAllowed(athlete, assignedRole)) {
        throw new ServiceStop(fail(400, "ROLE_NOT_ALLOWED", `${athlete.displayName} is not eligible for the ${assignedRole.toLowerCase()} role.`, body.requestId));
      }
      const existing = (await repo.readAttendance(sessionId)).rows.find((row) => row.athleteId === athleteId);
      const weightLbsSnapshot = body.weightLbs ?? existing?.weightLbsSnapshot ?? athlete.weightLbs;
      const skillSnapshot = body.skill ?? existing?.skillSnapshot ?? athlete.skill;
      const aggressionSnapshot = body.aggression !== undefined ? body.aggression : (existing?.aggressionSnapshot ?? athlete.aggression);
      const present = body.present ?? true;
      const availabilityStatus = body.availabilityStatus ?? existing?.availabilityStatus ?? "AVAILABLE";
      const checkingIn = present && availabilityStatus === "AVAILABLE";
      if (checkingIn && !isReadyForHardMatch({ weightLbs: weightLbsSnapshot, skill: skillSnapshot })) {
        throw new ServiceStop(
          fail(
            400,
            "INCOMPLETE_PROFILE",
            `${athlete.displayName} needs weight and skill (1–7) before a hard session.`,
            body.requestId,
          ),
        );
      }
      if (weightLbsSnapshot === null || skillSnapshot === null) {
        throw new ServiceStop(
          fail(
            400,
            "INCOMPLETE_PROFILE",
            `${athlete.displayName} needs weight and skill (1–7) before a hard session.`,
            body.requestId,
          ),
        );
      }
      const attendance: Attendance = {
        attendanceId: existing?.attendanceId ?? randomUUID(),
        sessionId,
        athleteId,
        assignedRole,
        present,
        availabilityStatus,
        weightLbsSnapshot,
        skillSnapshot,
        aggressionSnapshot,
        checkedInAt: existing?.checkedInAt ?? now,
        updatedAt: now,
      };
      const nextStatus = session.status === "DRAFT" ? "READY" : session.status;
      return {
        data: { attendance, athlete: created },
        session: { ...session, status: nextStatus },
        batch: { attendance: [attendance], ...(created ? { athletes: [created] } : {}) },
      };
    },
  });
}

export async function updateSettings(
  actor: Actor,
  sessionId: string,
  body: { requestId: string; expectedRevision: number; limits: MatchingLimits; timing: { roundMinutes: number; restSeconds: number } },
): Promise<ServiceResult<{ limits: MatchingLimits; timing: { roundMinutes: number; restSeconds: number } }>> {
  return withWrite({
    actor,
    action: "runSession",
    sessionId,
    expectedRevision: body.expectedRevision,
    requestId: body.requestId,
    eventType: "session.settings",
    run: async ({ session }) => {
      if (!session) throw new ServiceStop(fail(404, "NOT_FOUND", "That session does not exist.", body.requestId));
      return {
        data: { limits: body.limits, timing: body.timing },
        session: {
          ...session,
          settings: { ...session.settings, limits: body.limits, timing: body.timing },
        },
      };
    },
  });
}

export async function cancelSession(
  actor: Actor,
  sessionId: string,
  body: { requestId: string; expectedRevision: number; confirm: true },
): Promise<ServiceResult<{ status: string }>> {
  if (!can(actor.role, "cancelSession")) return fail(403, "FORBIDDEN", "Your account cannot cancel a session.", body.requestId);
  return withWrite({
    actor,
    action: "cancelSession",
    sessionId,
    expectedRevision: body.expectedRevision,
    requestId: body.requestId,
    eventType: "session.cancel",
    run: async ({ session }) => {
      if (!session) throw new ServiceStop(fail(404, "NOT_FOUND", "That session does not exist.", body.requestId));
      if (!body.confirm) throw new ServiceStop(fail(400, "CONFIRM_REQUIRED", "Confirm cancellation. History is kept.", body.requestId));
      return { data: { status: "CANCELLED" }, session: { ...session, status: "CANCELLED" } };
    },
  });
}

/** Permanently delete a session and related attendance, assignments, overrides, and audit rows. */
export async function deleteSession(
  actor: Actor,
  sessionId: string,
  body: { requestId: string; expectedRevision: number; confirm: true },
): Promise<ServiceResult<{ deleted: true; sessionId: string }>> {
  if (!can(actor.role, "deleteSession")) return fail(403, "FORBIDDEN", "Your account cannot delete a session.", body.requestId);
  if (!body.confirm) return fail(400, "CONFIRM_REQUIRED", "Confirm permanent delete. This cannot be undone.", body.requestId);
  return withWrite({
    actor,
    action: "deleteSession",
    sessionId,
    expectedRevision: body.expectedRevision,
    requestId: body.requestId,
    eventType: "session.delete",
    run: async ({ repo, session }) => {
      if (!session) throw new ServiceStop(fail(404, "NOT_FOUND", "That session does not exist.", body.requestId));
      await repo.deleteSessionCascade(sessionId);
      return {
        data: { deleted: true as const, sessionId },
        auditSessionId: "sessions",
      };
    },
  });
}
