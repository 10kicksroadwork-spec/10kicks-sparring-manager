import { AGGRESSION_MAX, AGGRESSION_MIN, SKILL_MAX, SKILL_MIN } from "@/lib/domain/profile";
import { parseSettings } from "@/lib/sheets/rows";
import type {
  Athlete,
  Attendance,
  AuditEvent,
  CommitBatch,
  ReadResult,
  SessionRecord,
  SparringRepository,
  StoredAssignment,
  StoredOverride,
  StoredRestriction,
} from "@/lib/repository/types";
import { getSupabaseAdmin } from "./admin";

type Row = Record<string, unknown>;

function storeFailed(): Error {
  const error = new Error("The database did not confirm the request");
  error.name = "STORE_FAILED";
  return error;
}

function text(row: Row, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value);
}

function numberValue(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function flag(row: Row, key: string): boolean | null {
  const value = row[key];
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "t" || value === "1") return true;
  if (value === "false" || value === "f" || value === "0") return false;
  return null;
}

function athleteFrom(row: Row): { athlete: Athlete } | { error: string } {
  const weight = numberValue(row, "weight_lbs");
  const skill = numberValue(row, "skill");
  const aggression = numberValue(row, "aggression");
  const active = flag(row, "active");
  const role = text(row, "role_eligibility");
  const athleteId = text(row, "athlete_id");
  const displayName = text(row, "display_name");
  if (!athleteId || !displayName || active === null) {
    return { error: `Athletes row ${athleteId || "(missing id)"} is incomplete or corrupt` };
  }
  if (weight !== null && (!(weight > 0) || weight > 500)) {
    return { error: `Athletes row ${athleteId} has an invalid weight` };
  }
  if (skill !== null && (!Number.isInteger(skill) || skill < SKILL_MIN || skill > SKILL_MAX)) {
    return { error: `Athletes row ${athleteId} has an invalid skill` };
  }
  if (aggression !== null && (!Number.isInteger(aggression) || aggression < AGGRESSION_MIN || aggression > AGGRESSION_MAX)) {
    return { error: `Athletes row ${athleteId} has an invalid aggression` };
  }
  if (role !== "FIGHTER" && role !== "VOLUNTEER" && role !== "BOTH") {
    return { error: `Athletes row ${athleteId} has an invalid role` };
  }
  return {
    athlete: {
      athleteId,
      displayName,
      weightLbs: weight,
      skill,
      aggression,
      roleEligibility: role,
      active,
      coachNotes: text(row, "coach_notes"),
      createdAt: text(row, "created_at"),
      updatedAt: text(row, "updated_at"),
    },
  };
}

function sessionFrom(row: Row): { session: SessionRecord } | { error: string } {
  const sessionId = text(row, "session_id");
  const revision = numberValue(row, "revision");
  const block = numberValue(row, "current_block_index");
  const settingsRaw = row.settings_json;
  const settings = parseSettings(typeof settingsRaw === "string" ? settingsRaw : JSON.stringify(settingsRaw ?? {}));
  const status = text(row, "status");
  if (!sessionId || revision === null || block === null || "error" in settings) {
    return { error: `Sessions row ${sessionId || "(missing id)"} is corrupt` };
  }
  if (!["DRAFT", "READY", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(status)) {
    return { error: `Sessions row ${sessionId} has an invalid status` };
  }
  return {
    session: {
      sessionId,
      dateLocal: text(row, "date_local").slice(0, 10),
      timezone: text(row, "timezone") || "America/New_York",
      status: status as SessionRecord["status"],
      revision,
      activeGenerationId: text(row, "active_generation_id"),
      currentBlockIndex: block,
      settings: settings.settings,
      createdBy: text(row, "created_by"),
      createdAt: text(row, "created_at"),
      updatedBy: text(row, "updated_by"),
      updatedAt: text(row, "updated_at"),
    },
  };
}

function attendanceFrom(row: Row): { attendance: Attendance } | { error: string } {
  const attendanceId = text(row, "attendance_id");
  const present = flag(row, "present");
  const weight = numberValue(row, "weight_lbs_snapshot");
  const skill = numberValue(row, "skill_snapshot");
  const aggressionRaw = row.aggression_snapshot;
  const aggression = numberValue(row, "aggression_snapshot");
  const role = text(row, "assigned_role");
  const availability = text(row, "availability_status");
  if (!attendanceId || !text(row, "session_id") || !text(row, "athlete_id") || present === null || weight === null || skill === null) {
    return { error: `Attendance row ${attendanceId || "(missing id)"} is corrupt` };
  }
  if (aggressionRaw !== null && aggressionRaw !== undefined && aggressionRaw !== "" && aggression === null) {
    return { error: `Attendance row ${attendanceId} has an invalid aggression` };
  }
  if (role !== "FIGHTER" && role !== "VOLUNTEER") return { error: `Attendance row ${attendanceId} has an invalid role` };
  if (!["AVAILABLE", "DEPARTED", "REMOVED"].includes(availability)) {
    return { error: `Attendance row ${attendanceId} has an invalid availability` };
  }
  return {
    attendance: {
      attendanceId,
      sessionId: text(row, "session_id"),
      athleteId: text(row, "athlete_id"),
      assignedRole: role,
      present,
      availabilityStatus: availability as Attendance["availabilityStatus"],
      weightLbsSnapshot: weight,
      skillSnapshot: skill,
      aggressionSnapshot: aggression,
      checkedInAt: text(row, "checked_in_at"),
      updatedAt: text(row, "updated_at"),
    },
  };
}

function assignmentFrom(row: Row): { assignment: StoredAssignment } | { error: string } {
  const assignmentId = text(row, "assignment_id");
  const block = numberValue(row, "block_index");
  const locked = flag(row, "locked");
  const location = text(row, "location");
  const status = text(row, "status");
  if (!assignmentId || !text(row, "session_id") || block === null || locked === null) {
    return { error: `Assignments row ${assignmentId || "(missing id)"} is corrupt` };
  }
  if (!["MAIN_RING", "FLOOR_1", "FLOOR_2"].includes(location)) {
    return { error: `Assignments row ${assignmentId} has an invalid location` };
  }
  if (!["PLANNED", "IN_PROGRESS", "COMPLETED", "INTERRUPTED"].includes(status)) {
    return { error: `Assignments row ${assignmentId} has an invalid status` };
  }
  const exceptionId = text(row, "numeric_exception_id");
  return {
    assignment: {
      assignmentId,
      sessionId: text(row, "session_id"),
      generationId: text(row, "generation_id"),
      blockIndex: block,
      location: location as StoredAssignment["location"],
      fighterId: text(row, "fighter_id"),
      volunteerId: text(row, "volunteer_id"),
      status: status as StoredAssignment["status"],
      locked,
      approvedNumericExceptionId: exceptionId || undefined,
      updatedAt: text(row, "updated_at"),
      updatedBy: text(row, "updated_by"),
    },
  };
}

function restrictionFrom(row: Row): { restriction: StoredRestriction } | { error: string } {
  const restrictionId = text(row, "restriction_id");
  const active = flag(row, "active");
  if (!restrictionId || !text(row, "athlete_a_id") || !text(row, "athlete_b_id") || active === null) {
    return { error: `Restrictions row ${restrictionId || "(missing id)"} is corrupt` };
  }
  return {
    restriction: {
      restrictionId,
      athleteAId: text(row, "athlete_a_id"),
      athleteBId: text(row, "athlete_b_id"),
      reason: text(row, "reason"),
      active,
      createdBy: text(row, "created_by"),
      createdAt: text(row, "created_at"),
      updatedAt: text(row, "updated_at"),
    },
  };
}

function overrideFrom(row: Row): { override: StoredOverride } | { error: string } {
  const overrideId = text(row, "override_id");
  const active = flag(row, "active");
  if (!overrideId || !text(row, "session_id") || active === null) {
    return { error: `Overrides row ${overrideId || "(missing id)"} is corrupt` };
  }
  const limits = row.allowed_numeric_limits_json;
  return {
    override: {
      overrideId,
      sessionId: text(row, "session_id"),
      fighterId: text(row, "fighter_id"),
      volunteerId: text(row, "volunteer_id"),
      allowedNumericLimitsJson: typeof limits === "string" ? limits : JSON.stringify(limits ?? {}),
      coachEmail: text(row, "coach_email"),
      reason: text(row, "reason"),
      acknowledgedAt: text(row, "acknowledged_at"),
      active,
    },
  };
}

function auditFrom(row: Row): { audit: AuditEvent } | { error: string } {
  const auditId = text(row, "audit_id");
  const prior = numberValue(row, "prior_revision");
  const next = numberValue(row, "new_revision");
  if (!auditId || prior === null || next === null) return { error: `Audit row ${auditId || "(missing id)"} is corrupt` };
  const raw = row.payload_json;
  const payload = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    audit: {
      auditId,
      sessionId: text(row, "session_id"),
      actorEmail: text(row, "actor_email"),
      eventType: text(row, "event_type"),
      requestId: text(row, "request_id"),
      priorRevision: prior,
      newRevision: next,
      timestamp: text(row, "timestamp"),
      payload,
    },
  };
}

function isCorrupt(result: object): result is { error: string } {
  return "error" in result && typeof result.error === "string" && Object.keys(result).length === 1;
}

function collect<T extends object>(rows: Row[], parse: (row: Row) => { error: string } | T): ReadResult<T[keyof T]> {
  const parsed: Array<T[keyof T]> = [];
  const corrupt: string[] = [];
  for (const row of rows) {
    const result = parse(row);
    if (isCorrupt(result)) {
      corrupt.push(result.error);
      continue;
    }
    const value = Object.values(result)[0] as T[keyof T] | undefined;
    if (value === undefined) {
      corrupt.push("A row could not be read");
      continue;
    }
    parsed.push(value);
  }
  return { rows: parsed, corrupt };
}

async function readTable(table: string, sessionId?: string): Promise<Row[]> {
  let query = getSupabaseAdmin().from(table).select("*");
  if (sessionId) query = query.eq("session_id", sessionId);
  const { data, error } = await query;
  if (error) throw storeFailed();
  return (data ?? []) as Row[];
}

export function createSupabaseRepository(): SparringRepository {
  return {
    kind: "supabase",
    async readAthletes() {
      return collect(await readTable("athletes"), athleteFrom);
    },
    async readSessions() {
      return collect(await readTable("sessions"), sessionFrom);
    },
    async readAttendance(sessionId) {
      return collect(await readTable("attendance", sessionId), attendanceFrom);
    },
    async readAssignments(sessionId) {
      return collect(await readTable("assignments", sessionId), assignmentFrom);
    },
    async readRestrictions() {
      return collect(await readTable("restrictions"), restrictionFrom);
    },
    async readOverrides(sessionId) {
      return collect(await readTable("overrides", sessionId), overrideFrom);
    },
    async readAudit(sessionId) {
      return collect(await readTable("audit_log", sessionId), auditFrom);
    },
    async commit(batch: CommitBatch) {
      const { error } = await getSupabaseAdmin().rpc("commit_sparring_batch", { batch });
      if (error) throw storeFailed();
    },
    async deleteSessionCascade(sessionId: string) {
      const db = getSupabaseAdmin();
      // Child tables reference sessions without ON DELETE CASCADE — delete explicitly.
      for (const table of ["assignments", "attendance", "overrides", "audit_log", "sessions"] as const) {
        const { error } = await db.from(table).delete().eq("session_id", sessionId);
        if (error) throw storeFailed();
      }
    },
  };
}
