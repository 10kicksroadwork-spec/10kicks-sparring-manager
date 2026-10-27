import { evaluatePair } from "@/lib/domain/matchmaking";
import { saturdayPresetSettings, type NumericOverride, type ScheduleInput, type SessionAthlete } from "@/lib/domain/types";
import type { Attendance, SessionRecord, SparringRepository, StoredAssignment } from "@/lib/repository/types";

export type SessionView = {
  session: SessionRecord;
  attendance: Attendance[];
  assignments: StoredAssignment[];
  corrupt: string[];
};

export async function loadSession(repo: SparringRepository, sessionId: string): Promise<SessionView | null> {
  const [sessions, attendance, assignments, athletes, restrictions, overrides] = await Promise.all([
    repo.readSessions(),
    repo.readAttendance(sessionId),
    repo.readAssignments(sessionId),
    repo.readAthletes(),
    repo.readRestrictions(),
    repo.readOverrides(sessionId),
  ]);
  const session = sessions.rows.find((row) => row.sessionId === sessionId);
  if (!session) return null;
  return {
    session,
    attendance: attendance.rows,
    assignments: assignments.rows,
    corrupt: [...sessions.corrupt, ...attendance.corrupt, ...assignments.corrupt, ...athletes.corrupt, ...restrictions.corrupt, ...overrides.corrupt],
  };
}

export function activeAssignments(view: SessionView): StoredAssignment[] {
  if (!view.session.activeGenerationId) return [];
  return view.assignments.filter((row) => row.generationId === view.session.activeGenerationId);
}

export function fixedAssignments(rows: StoredAssignment[]): StoredAssignment[] {
  return rows.filter((row) => row.locked || row.status === "COMPLETED" || row.status === "IN_PROGRESS" || row.status === "INTERRUPTED");
}

function snapshotAthlete(row: Attendance, name: string): SessionAthlete {
  return {
    athleteId: row.athleteId,
    displayName: name,
    weightLbs: row.weightLbsSnapshot,
    skill: row.skillSnapshot,
    aggression: row.aggressionSnapshot,
  };
}

export async function toScheduleInput(
  repo: SparringRepository,
  view: SessionView,
  generationId: string,
  rows: StoredAssignment[],
): Promise<ScheduleInput> {
  const [athletes, restrictions, overrides] = await Promise.all([
    repo.readAthletes(),
    repo.readRestrictions(),
    repo.readOverrides(view.session.sessionId),
  ]);
  const names = new Map(athletes.rows.map((athlete) => [athlete.athleteId, athlete.displayName]));
  const present = view.attendance.filter((row) => row.present);
  const unavailable = new Set(present.filter((row) => row.availabilityStatus !== "AVAILABLE").map((row) => row.athleteId));
  const fighters = present.filter((row) => row.assignedRole === "FIGHTER").map((row) => snapshotAthlete(row, names.get(row.athleteId) || "Fighter"));
  const fighterIds = new Set(fighters.map((fighter) => fighter.athleteId));
  const volunteers = present
    .filter((row) => row.assignedRole === "VOLUNTEER" && !fighterIds.has(row.athleteId))
    .map((row) => snapshotAthlete(row, names.get(row.athleteId) || "Volunteer"));
  const numericOverrides: NumericOverride[] = overrides.rows.map((row) => ({
    overrideId: row.overrideId,
    sessionId: row.sessionId,
    fighterId: row.fighterId,
    volunteerId: row.volunteerId,
    coachEmail: row.coachEmail,
    reason: row.reason,
    acknowledgedAt: row.acknowledgedAt,
    active: row.active,
  }));
  const settings = view.session.settings ?? saturdayPresetSettings();
  return {
    sessionId: view.session.sessionId,
    generationId,
    fighters,
    volunteers,
    limits: settings.limits,
    restrictions: restrictions.rows.map((row) => ({
      restrictionId: row.restrictionId,
      athleteAId: row.athleteAId,
      athleteBId: row.athleteBId,
      reason: row.reason,
      active: row.active,
    })),
    overrides: numericOverrides,
    fixedAssignments: fixedAssignments(rows).map((row) => ({
      assignmentId: row.assignmentId,
      sessionId: row.sessionId,
      generationId: row.generationId,
      blockIndex: row.blockIndex,
      location: row.location,
      fighterId: row.fighterId,
      volunteerId: row.volunteerId,
      status: row.status,
      locked: row.locked,
      approvedNumericExceptionId: row.approvedNumericExceptionId,
    })),
    requiredHardSessions: 3,
    maxVolunteerSessions: 2,
    restGapBlocks: 1,
    scoringWeights: settings.scoringWeights,
    maxBlockHorizon: settings.maxBlockHorizon,
    unavailableIds: [...unavailable],
  };
}

export function viewSignature(view: SessionView): string {
  const attendance = view.attendance
    .map((row) => [row.athleteId, row.assignedRole, row.present, row.availabilityStatus, row.weightLbsSnapshot, row.skillSnapshot, row.aggressionSnapshot].join(":"))
    .sort();
  return JSON.stringify({ attendance, limits: view.session.settings.limits, generation: view.session.activeGenerationId });
}

export async function eligibilityReport(repo: SparringRepository, view: SessionView) {
  const input = await toScheduleInput(repo, view, view.session.activeGenerationId || "preview", activeAssignments(view));
  return input.fighters.map((fighter) => ({
    fighterId: fighter.athleteId,
    displayName: fighter.displayName,
    partners: input.volunteers.map((volunteer) => {
      const decision = evaluatePair({
        sessionId: view.session.sessionId,
        fighter,
        volunteer,
        limits: input.limits,
        restrictions: input.restrictions,
        overrides: input.overrides,
      });
      return {
        volunteerId: volunteer.athleteId,
        displayName: volunteer.displayName,
        eligible: decision.eligible,
        reasons: decision.reasons,
      };
    }),
  }));
}
