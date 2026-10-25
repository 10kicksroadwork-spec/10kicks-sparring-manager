import { randomUUID } from "node:crypto";
import { saturdayPresetSettings, PROPOSED_LIMITS_NOTICE, type MatchingLimits } from "@/lib/domain/types";
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
  const saved = { ...session, revision: 1 };
  return withWrite({
    actor,
    action: "runSession",
    sessionId: "",
    expectedRevision: null,
    requestId: input.requestId,
    eventType: "session.create",
    run: async () => ({
      data: { session: saved },
      session,
      auditSessionId: session.sessionId,
    }),
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
      limitsNotice: PROPOSED_LIMITS_NOTICE,
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
    aggression?: number;
    createVolunteer?: { displayName: string; weightLbs: number; skill: number; aggression: number; roleEligibility: Athlete["roleEligibility"]; coachNotes?: string };
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
          aggression: body.createVolunteer.aggression,
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
      if (!athlete || !athlete.active) {
        throw new ServiceStop(fail(400, "INACTIVE_ATHLETE", "That person is not an active athlete. Add them before check-in.", body.requestId));
      }
      const assignedRole = body.assignedRole ?? (created ? "VOLUNTEER" : athlete.roleEligibility === "VOLUNTEER" ? "VOLUNTEER" : "FIGHTER");
      if (!roleAllowed(athlete, assignedRole)) {
        throw new ServiceStop(fail(400, "ROLE_NOT_ALLOWED", `${athlete.displayName} is not eligible for the ${assignedRole.toLowerCase()} role.`, body.requestId));
      }
      const existing = (await repo.readAttendance(sessionId)).rows.find((row) => row.athleteId === athleteId);
      const attendance: Attendance = {
        attendanceId: existing?.attendanceId ?? randomUUID(),
        sessionId,
        athleteId,
        assignedRole,
        present: body.present ?? true,
        availabilityStatus: body.availabilityStatus ?? existing?.availabilityStatus ?? "AVAILABLE",
        weightLbsSnapshot: body.weightLbs ?? existing?.weightLbsSnapshot ?? athlete.weightLbs,
        skillSnapshot: body.skill ?? existing?.skillSnapshot ?? athlete.skill,
        aggressionSnapshot: body.aggression ?? existing?.aggressionSnapshot ?? athlete.aggression,
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
  body: { requestId: string; expectedRevision: number; confirmLimitsChange: boolean; limits: MatchingLimits },
): Promise<ServiceResult<{ limits: MatchingLimits; notice: string }>> {
  return withWrite({
    actor,
    action: "runSession",
    sessionId,
    expectedRevision: body.expectedRevision,
    requestId: body.requestId,
    eventType: "session.settings",
    run: async ({ session }) => {
      if (!session) throw new ServiceStop(fail(404, "NOT_FOUND", "That session does not exist.", body.requestId));
      const changed = JSON.stringify(session.settings.limits) !== JSON.stringify(body.limits);
      if (changed && !body.confirmLimitsChange) {
        throw new ServiceStop(fail(400, "CONFIRM_LIMITS", "Confirm the numeric limit change before saving. These limits are not safety-certified.", body.requestId));
      }
      const notice = changed
        ? "Coach-edited numeric limits for this Saturday only. Still not a safety certification. The coach decides suitability."
        : PROPOSED_LIMITS_NOTICE;
      return {
        data: { limits: body.limits, notice },
        session: {
          ...session,
          settings: { ...session.settings, limits: body.limits, limitsPendingCoachReview: true, limitsNotice: notice },
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
