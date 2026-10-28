import { HARD_ROUNDS_PER_ASSIGNMENT, countsAsCompletedTwoRoundSession } from "@/lib/domain/types";
import type { Athlete, SessionRecord, StoredAssignment } from "@/lib/repository/types";
import { type Actor, fail, openStore, type ServiceResult } from "./support";
import { can } from "@/lib/permissions";

export type VolunteerAttendanceRow = {
  athleteId: string;
  displayName: string;
  /** Distinct Saturdays where this person finished at least one COMPLETED volunteer match. */
  sessionsHelped: number;
  /** COMPLETED assignments where they were the volunteer (one hard session each). */
  hardSessionsCompleted: number;
  /** hardSessionsCompleted × hard rounds per assignment (usually 2). */
  roundsCompleted: number;
};

/**
 * Reward ranking from history: only COMPLETED assignments on each session's active
 * generation, and only where the person was the volunteer (not the fighter).
 */
export function summarizeVolunteerAttendance(
  sessions: SessionRecord[],
  assignments: StoredAssignment[],
  athletes: Athlete[],
): VolunteerAttendanceRow[] {
  const names = new Map(athletes.map((row) => [row.athleteId, row.displayName]));
  const activeBySession = new Map(sessions.map((row) => [row.sessionId, row.activeGenerationId]));
  const roundsBySession = new Map(
    sessions.map((row) => [row.sessionId, row.settings.hardRoundsPerSession || HARD_ROUNDS_PER_ASSIGNMENT]),
  );

  const byVolunteer = new Map<
    string,
    { sessions: Set<string>; hardSessions: number; rounds: number }
  >();

  for (const row of assignments) {
    if (!countsAsCompletedTwoRoundSession(row.status)) continue;
    const generationId = activeBySession.get(row.sessionId);
    if (!generationId || row.generationId !== generationId) continue;

    const entry = byVolunteer.get(row.volunteerId) ?? { sessions: new Set<string>(), hardSessions: 0, rounds: 0 };
    entry.sessions.add(row.sessionId);
    entry.hardSessions += 1;
    entry.rounds += roundsBySession.get(row.sessionId) ?? HARD_ROUNDS_PER_ASSIGNMENT;
    byVolunteer.set(row.volunteerId, entry);
  }

  return [...byVolunteer.entries()]
    .map(([athleteId, stats]) => ({
      athleteId,
      displayName: names.get(athleteId) ?? "Unknown",
      sessionsHelped: stats.sessions.size,
      hardSessionsCompleted: stats.hardSessions,
      roundsCompleted: stats.rounds,
    }))
    .sort((a, b) => {
      if (b.hardSessionsCompleted !== a.hardSessionsCompleted) return b.hardSessionsCompleted - a.hardSessionsCompleted;
      if (b.roundsCompleted !== a.roundsCompleted) return b.roundsCompleted - a.roundsCompleted;
      if (b.sessionsHelped !== a.sessionsHelped) return b.sessionsHelped - a.sessionsHelped;
      return a.displayName.localeCompare(b.displayName);
    });
}

export async function listVolunteerAttendance(
  actor: Actor,
  requestId = "read",
): Promise<ServiceResult<{ volunteers: VolunteerAttendanceRow[]; corrupt: string[] }>> {
  if (!can(actor.role, "read")) return fail(403, "FORBIDDEN", "Your account cannot do that.", requestId);
  const opened = await openStore(requestId);
  if ("ok" in opened) return opened;
  const [sessions, assignments, athletes] = await Promise.all([
    opened.repo.readSessions(),
    opened.repo.readAssignments(),
    opened.repo.readAthletes(),
  ]);
  return {
    ok: true,
    requestId,
    data: {
      volunteers: summarizeVolunteerAttendance(sessions.rows, assignments.rows, athletes.rows),
      corrupt: [...sessions.corrupt, ...assignments.corrupt, ...athletes.corrupt],
    },
  };
}
