import type { Assignment, AssignmentStatus, Location, MatchingLimits, SaturdaySettings } from "@/lib/domain/types";

export type { SaturdaySettings };

export type RoleEligibility = "FIGHTER" | "VOLUNTEER" | "BOTH";
export type SessionRole = "FIGHTER" | "VOLUNTEER";
export type Availability = "AVAILABLE" | "DEPARTED" | "REMOVED";
export type SessionStatus = "DRAFT" | "READY" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export type Athlete = {
  athleteId: string;
  displayName: string;
  weightLbs: number | null;
  skill: number | null;
  aggression: number | null;
  roleEligibility: RoleEligibility;
  active: boolean;
  coachNotes: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionRecord = {
  sessionId: string;
  dateLocal: string;
  timezone: string;
  status: SessionStatus;
  revision: number;
  activeGenerationId: string;
  currentBlockIndex: number;
  settings: SaturdaySettings;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
};

export type Attendance = {
  attendanceId: string;
  sessionId: string;
  athleteId: string;
  assignedRole: SessionRole;
  present: boolean;
  availabilityStatus: Availability;
  weightLbsSnapshot: number;
  skillSnapshot: number;
  aggressionSnapshot: number | null;
  checkedInAt: string;
  updatedAt: string;
};

export type StoredAssignment = Assignment & {
  updatedAt: string;
  updatedBy: string;
};

export type StoredRestriction = {
  restrictionId: string;
  athleteAId: string;
  athleteBId: string;
  reason: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredOverride = {
  overrideId: string;
  sessionId: string;
  fighterId: string;
  volunteerId: string;
  allowedNumericLimitsJson: string;
  coachEmail: string;
  reason: string;
  acknowledgedAt: string;
  active: boolean;
};

export type AuditEvent = {
  auditId: string;
  sessionId: string;
  actorEmail: string;
  eventType: string;
  requestId: string;
  priorRevision: number;
  newRevision: number;
  timestamp: string;
  payload: Record<string, unknown>;
};

export type CommitBatch = {
  session?: SessionRecord;
  athletes?: Athlete[];
  attendance?: Attendance[];
  assignmentInserts?: StoredAssignment[];
  assignmentUpdates?: StoredAssignment[];
  restriction?: StoredRestriction;
  override?: StoredOverride;
  audit: AuditEvent;
};

export type ReadResult<T> = { rows: T[]; corrupt: string[] };

export interface SparringRepository {
  kind: "memory" | "sheets" | "supabase";
  readAthletes(): Promise<ReadResult<Athlete>>;
  readSessions(): Promise<ReadResult<SessionRecord>>;
  readAttendance(sessionId?: string): Promise<ReadResult<Attendance>>;
  readAssignments(sessionId?: string): Promise<ReadResult<StoredAssignment>>;
  readRestrictions(): Promise<ReadResult<StoredRestriction>>;
  readOverrides(sessionId?: string): Promise<ReadResult<StoredOverride>>;
  readAudit(sessionId?: string): Promise<ReadResult<AuditEvent>>;
  commit(batch: CommitBatch): Promise<void>;
}

export type Limits = MatchingLimits;
export type { AssignmentStatus, Location };
