import type { AuditEvent, CommitBatch, SparringRepository } from "./types";

type MemoryState = {
  athletes: CommitBatch["athletes"];
  sessions: NonNullable<CommitBatch["session"]>[];
  attendance: NonNullable<CommitBatch["attendance"]>;
  assignments: NonNullable<CommitBatch["assignmentInserts"]>;
  restrictions: NonNullable<CommitBatch["restriction"]>[];
  overrides: NonNullable<CommitBatch["override"]>[];
  audit: AuditEvent[];
};

function empty(): MemoryState {
  return {
    athletes: [],
    sessions: [],
    attendance: [],
    assignments: [],
    restrictions: [],
    overrides: [],
    audit: [],
  };
}

const globalStore = globalThis as { __sparringMemory?: MemoryState };
function state(): MemoryState {
  if (!globalStore.__sparringMemory) globalStore.__sparringMemory = empty();
  return globalStore.__sparringMemory;
}

export function resetMemoryStore(): void {
  globalStore.__sparringMemory = empty();
}

function upsert<T>(rows: T[], item: T, key: (row: T) => string): T[] {
  const id = key(item);
  const index = rows.findIndex((row) => key(row) === id);
  if (index === -1) return [...rows, item];
  const next = rows.slice();
  next[index] = item;
  return next;
}

/** Single-process store for tests and local UI only. Not multi-instance safe. */
export function createMemoryRepository(): SparringRepository {
  return {
    kind: "memory",
    async readAthletes() {
      return { rows: state().athletes ?? [], corrupt: [] };
    },
    async readSessions() {
      return { rows: state().sessions, corrupt: [] };
    },
    async readAttendance(sessionId) {
      const rows = state().attendance ?? [];
      return { rows: sessionId ? rows.filter((row) => row.sessionId === sessionId) : rows, corrupt: [] };
    },
    async readAssignments(sessionId) {
      const rows = state().assignments ?? [];
      return { rows: sessionId ? rows.filter((row) => row.sessionId === sessionId) : rows, corrupt: [] };
    },
    async readRestrictions() {
      return { rows: state().restrictions, corrupt: [] };
    },
    async readOverrides(sessionId) {
      const rows = state().overrides;
      return { rows: sessionId ? rows.filter((row) => row.sessionId === sessionId) : rows, corrupt: [] };
    },
    async readAudit(sessionId) {
      const rows = state().audit;
      return { rows: sessionId ? rows.filter((row) => row.sessionId === sessionId) : rows, corrupt: [] };
    },
    async commit(batch) {
      const current = state();
      if (batch.athletes) {
        let athletes = current.athletes ?? [];
        for (const athlete of batch.athletes) athletes = upsert(athletes, athlete, (row) => row.athleteId);
        current.athletes = athletes;
      }
      if (batch.session) current.sessions = upsert(current.sessions, batch.session, (row) => row.sessionId);
      if (batch.attendance) {
        let attendance = current.attendance ?? [];
        for (const row of batch.attendance) attendance = upsert(attendance, row, (item) => item.attendanceId);
        current.attendance = attendance;
      }
      if (batch.assignmentInserts?.length) {
        current.assignments = [...(current.assignments ?? []), ...batch.assignmentInserts];
      }
      if (batch.assignmentUpdates?.length) {
        let assignments = current.assignments ?? [];
        for (const row of batch.assignmentUpdates) {
          assignments = upsert(assignments, row, (item) => `${item.assignmentId}:${item.generationId}`);
        }
        current.assignments = assignments;
      }
      if (batch.restriction) current.restrictions = upsert(current.restrictions, batch.restriction, (row) => row.restrictionId);
      if (batch.override) current.overrides = upsert(current.overrides, batch.override, (row) => row.overrideId);
      current.audit = [...current.audit, batch.audit];
    },
    async deleteSessionCascade(sessionId) {
      const current = state();
      current.sessions = current.sessions.filter((row) => row.sessionId !== sessionId);
      current.attendance = (current.attendance ?? []).filter((row) => row.sessionId !== sessionId);
      current.assignments = (current.assignments ?? []).filter((row) => row.sessionId !== sessionId);
      current.overrides = current.overrides.filter((row) => row.sessionId !== sessionId);
      current.audit = current.audit.filter((row) => row.sessionId !== sessionId);
    },
  };
}
