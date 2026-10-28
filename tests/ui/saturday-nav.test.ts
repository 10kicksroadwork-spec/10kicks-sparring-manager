import { describe, expect, it } from "vitest";
import {
  isHistoricalRundownView,
  previousCompletedSessions,
  rundownBackHref,
  saturdaySessionCta,
} from "@/lib/ui/saturday-nav";

describe("saturdaySessionCta", () => {
  it("shows only Start when there is no active session", () => {
    expect(saturdaySessionCta(null)).toEqual({
      kind: "start",
      label: "Start Saturday Session",
    });
  });

  it("shows only Resume when an unfinished session exists", () => {
    expect(saturdaySessionCta("active-1")).toEqual({
      kind: "resume",
      label: "Resume Saturday",
      sessionId: "active-1",
    });
  });
});

describe("previousCompletedSessions", () => {
  const rows = [
    { sessionId: "a", dateLocal: "2026-10-18", status: "COMPLETED", revision: 4 },
    { sessionId: "b", dateLocal: "2026-10-25", status: "READY", revision: 2 },
    { sessionId: "c", dateLocal: "2026-10-11", status: "COMPLETED", revision: 3 },
    { sessionId: "d", dateLocal: "2026-10-04", status: "CANCELLED", revision: 1 },
  ];

  it("lists completed sessions other than the current attendance session", () => {
    expect(previousCompletedSessions(rows, "b").map((row) => row.sessionId)).toEqual(["a", "c"]);
  });

  it("excludes the current session even if completed", () => {
    expect(previousCompletedSessions(rows, "a").map((row) => row.sessionId)).toEqual(["c"]);
  });
});

describe("historical rundown navigation", () => {
  it("treats from= attendance and completed/cancelled as read-only", () => {
    expect(isHistoricalRundownView({ sessionStatus: "READY", fromAttendanceSessionId: "live" })).toBe(true);
    expect(isHistoricalRundownView({ sessionStatus: "COMPLETED", fromAttendanceSessionId: null })).toBe(true);
    expect(isHistoricalRundownView({ sessionStatus: "CANCELLED", fromAttendanceSessionId: null })).toBe(true);
    expect(isHistoricalRundownView({ sessionStatus: "IN_PROGRESS", fromAttendanceSessionId: null })).toBe(false);
  });

  it("returns to the live attendance page when from is set", () => {
    expect(rundownBackHref("old", "live")).toBe("/sessions/live/attendance");
    expect(rundownBackHref("live", null)).toBe("/sessions/live/attendance");
  });
});
