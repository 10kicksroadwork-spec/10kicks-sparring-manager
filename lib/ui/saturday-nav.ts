export type SessionSummary = {
  sessionId: string;
  dateLocal: string;
  status: string;
  revision: number;
};

export type SaturdayCta =
  | { kind: "start"; label: "Start Saturday Session" }
  | { kind: "resume"; label: "Resume Saturday"; sessionId: string };

/** Homepage shows exactly one primary session action. */
export function saturdaySessionCta(activeSessionId: string | null): SaturdayCta {
  if (activeSessionId) {
    return { kind: "resume", label: "Resume Saturday", sessionId: activeSessionId };
  }
  return { kind: "start", label: "Start Saturday Session" };
}

/** Completed past Saturdays for the check-in Previous Sessions list. */
export function previousCompletedSessions(
  sessions: SessionSummary[],
  currentSessionId: string,
): SessionSummary[] {
  return sessions.filter(
    (session) => session.status === "COMPLETED" && session.sessionId !== currentSessionId,
  );
}

export function isHistoricalRundownView(options: {
  sessionStatus: string | undefined;
  fromAttendanceSessionId: string | null;
}): boolean {
  if (options.fromAttendanceSessionId) return true;
  return options.sessionStatus === "COMPLETED" || options.sessionStatus === "CANCELLED";
}

export function rundownBackHref(sessionId: string, fromAttendanceSessionId: string | null): string {
  const target = fromAttendanceSessionId || sessionId;
  return `/sessions/${target}/attendance`;
}
