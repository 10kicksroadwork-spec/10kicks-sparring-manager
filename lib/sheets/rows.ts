import { AGGRESSION_MAX, AGGRESSION_MIN, SKILL_MAX, SKILL_MIN } from "@/lib/domain/profile";
import { saturdayPresetSettings, type SaturdaySettings } from "@/lib/domain/types";
import type {
  Athlete,
  Attendance,
  AuditEvent,
  SessionRecord,
  StoredAssignment,
  StoredOverride,
  StoredRestriction,
} from "@/lib/repository/types";

export const TAB_HEADERS = {
  Athletes: ["athlete_id", "display_name", "weight_lbs", "skill", "aggression", "role_eligibility", "active", "coach_notes", "created_at", "updated_at"],
  Sessions: ["session_id", "date_local", "timezone", "status", "revision", "active_generation_id", "current_block_index", "settings_json", "created_by", "created_at", "updated_by", "updated_at"],
  Attendance: ["attendance_id", "session_id", "athlete_id", "assigned_role", "present", "availability_status", "weight_lbs_snapshot", "skill_snapshot", "aggression_snapshot", "checked_in_at", "updated_at"],
  Assignments: ["assignment_id", "session_id", "generation_id", "block_index", "location", "fighter_id", "volunteer_id", "status", "locked", "numeric_exception_id", "updated_at", "updated_by"],
  Restrictions: ["restriction_id", "athlete_a_id", "athlete_b_id", "reason", "active", "created_by", "created_at", "updated_at"],
  Overrides: ["override_id", "session_id", "fighter_id", "volunteer_id", "allowed_numeric_limits_json", "coach_email", "reason", "acknowledged_at", "active"],
  AuditLog: ["audit_id", "session_id", "actor_email", "event_type", "request_id", "prior_revision", "new_revision", "timestamp", "payload_json"],
} as const;

export type TabName = keyof typeof TAB_HEADERS;

export const TAB_NAMES = Object.keys(TAB_HEADERS) as TabName[];

function record(headers: readonly string[], row: unknown[]): Record<string, string> | null {
  const values = headers.map((_, index) => {
    const value = row[index];
    return value === undefined || value === null ? "" : String(value).trim();
  });
  if (values.every((value) => value === "")) return null;
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
}

function bool(value: string): boolean | null {
  const normalized = value.toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}

function num(value: string): number | null {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalStat(raw: string): { value: number | null } | { invalid: true } {
  if (raw === "") return { value: null };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return { invalid: true };
  return { value: parsed };
}

export function parseSettings(raw: string): { settings: SaturdaySettings } | { error: string } {
  try {
    const value = JSON.parse(raw) as Partial<SaturdaySettings>;
    const defaults = saturdayPresetSettings();
    const limits = { ...defaults.limits, ...(value.limits ?? {}) };
    return {
      settings: {
        ...defaults,
        ...value,
        limits,
        timing: { ...defaults.timing, ...(value.timing ?? {}) },
        requiredHardSessionsPerFighter: 3,
        hardRoundsPerSession: 2,
        maxVolunteerHardSessions: 3,
        restGapBlocks: 1,
        locations: defaults.locations,
      },
    };
  } catch {
    return { error: "settings_json is not valid JSON" };
  }
}

export function parseAthleteRow(row: unknown[]): { athlete: Athlete } | { error: string } | { skip: true } {
  const cells = record(TAB_HEADERS.Athletes, row);
  if (!cells) return { skip: true };
  const weight = optionalStat(cells.weight_lbs);
  const skill = optionalStat(cells.skill);
  const aggression = optionalStat(cells.aggression);
  const active = bool(cells.active);
  const role = cells.role_eligibility;
  if (!cells.athlete_id || !cells.display_name || active === null || "invalid" in weight || "invalid" in skill || "invalid" in aggression) {
    return { error: `Athletes row ${cells.athlete_id || "(missing id)"} is incomplete or corrupt` };
  }
  if (weight.value !== null && (!(weight.value > 0) || weight.value > 500)) {
    return { error: `Athletes row ${cells.athlete_id} has an invalid weight` };
  }
  if (skill.value !== null && (!Number.isInteger(skill.value) || skill.value < SKILL_MIN || skill.value > SKILL_MAX)) {
    return { error: `Athletes row ${cells.athlete_id} has an invalid skill` };
  }
  if (aggression.value !== null && (!Number.isInteger(aggression.value) || aggression.value < AGGRESSION_MIN || aggression.value > AGGRESSION_MAX)) {
    return { error: `Athletes row ${cells.athlete_id} has an invalid aggression` };
  }
  if (role !== "FIGHTER" && role !== "VOLUNTEER" && role !== "BOTH") {
    return { error: `Athletes row ${cells.athlete_id} has an invalid role` };
  }
  return {
    athlete: {
      athleteId: cells.athlete_id,
      displayName: cells.display_name,
      weightLbs: weight.value,
      skill: skill.value,
      aggression: aggression.value,
      roleEligibility: role,
      active,
      coachNotes: cells.coach_notes,
      createdAt: cells.created_at,
      updatedAt: cells.updated_at,
    },
  };
}

export function athleteToRow(athlete: Athlete): (string | number | boolean)[] {
  return [
    athlete.athleteId,
    athlete.displayName,
    athlete.weightLbs ?? "",
    athlete.skill ?? "",
    athlete.aggression ?? "",
    athlete.roleEligibility,
    athlete.active,
    athlete.coachNotes,
    athlete.createdAt,
    athlete.updatedAt,
  ];
}

export function parseSessionRow(row: unknown[]): { session: SessionRecord } | { error: string } | { skip: true } {
  const cells = record(TAB_HEADERS.Sessions, row);
  if (!cells) return { skip: true };
  const revision = num(cells.revision);
  const block = num(cells.current_block_index);
  const settings = parseSettings(cells.settings_json);
  const status = cells.status;
  if (!cells.session_id || revision === null || block === null || "error" in settings) {
    return { error: `Sessions row ${cells.session_id || "(missing id)"} is corrupt` };
  }
  if (!["DRAFT", "READY", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(status)) {
    return { error: `Sessions row ${cells.session_id} has an invalid status` };
  }
  return {
    session: {
      sessionId: cells.session_id,
      dateLocal: cells.date_local,
      timezone: cells.timezone || "America/New_York",
      status: status as SessionRecord["status"],
      revision,
      activeGenerationId: cells.active_generation_id,
      currentBlockIndex: block,
      settings: settings.settings,
      createdBy: cells.created_by,
      createdAt: cells.created_at,
      updatedBy: cells.updated_by,
      updatedAt: cells.updated_at,
    },
  };
}

export function sessionToRow(session: SessionRecord): (string | number | boolean)[] {
  return [
    session.sessionId,
    session.dateLocal,
    session.timezone,
    session.status,
    session.revision,
    session.activeGenerationId,
    session.currentBlockIndex,
    JSON.stringify(session.settings),
    session.createdBy,
    session.createdAt,
    session.updatedBy,
    session.updatedAt,
  ];
}

export function parseAttendanceRow(row: unknown[]): { attendance: Attendance } | { error: string } | { skip: true } {
  const cells = record(TAB_HEADERS.Attendance, row);
  if (!cells) return { skip: true };
  const present = bool(cells.present);
  const weight = num(cells.weight_lbs_snapshot);
  const skill = num(cells.skill_snapshot);
  const aggression = optionalStat(cells.aggression_snapshot);
  if (!cells.attendance_id || !cells.session_id || !cells.athlete_id || present === null || weight === null || skill === null || "invalid" in aggression) {
    return { error: `Attendance row ${cells.attendance_id || "(missing id)"} is corrupt` };
  }
  if (cells.assigned_role !== "FIGHTER" && cells.assigned_role !== "VOLUNTEER") {
    return { error: `Attendance row ${cells.attendance_id} has an invalid role` };
  }
  if (!["AVAILABLE", "DEPARTED", "REMOVED"].includes(cells.availability_status)) {
    return { error: `Attendance row ${cells.attendance_id} has an invalid availability` };
  }
  return {
    attendance: {
      attendanceId: cells.attendance_id,
      sessionId: cells.session_id,
      athleteId: cells.athlete_id,
      assignedRole: cells.assigned_role,
      present,
      availabilityStatus: cells.availability_status as Attendance["availabilityStatus"],
      weightLbsSnapshot: weight,
      skillSnapshot: skill,
      aggressionSnapshot: aggression.value,
      checkedInAt: cells.checked_in_at,
      updatedAt: cells.updated_at,
    },
  };
}

export function attendanceToRow(row: Attendance): (string | number | boolean)[] {
  return [
    row.attendanceId,
    row.sessionId,
    row.athleteId,
    row.assignedRole,
    row.present,
    row.availabilityStatus,
    row.weightLbsSnapshot,
    row.skillSnapshot,
    row.aggressionSnapshot ?? "",
    row.checkedInAt,
    row.updatedAt,
  ];
}

export function parseAssignmentRow(row: unknown[]): { assignment: StoredAssignment } | { error: string } | { skip: true } {
  const cells = record(TAB_HEADERS.Assignments, row);
  if (!cells) return { skip: true };
  const block = num(cells.block_index);
  const locked = bool(cells.locked);
  if (!cells.assignment_id || !cells.session_id || block === null || locked === null) {
    return { error: `Assignments row ${cells.assignment_id || "(missing id)"} is corrupt` };
  }
  if (!["MAIN_RING", "FLOOR_1", "FLOOR_2"].includes(cells.location)) {
    return { error: `Assignments row ${cells.assignment_id} has an invalid location` };
  }
  if (!["PLANNED", "IN_PROGRESS", "COMPLETED", "INTERRUPTED"].includes(cells.status)) {
    return { error: `Assignments row ${cells.assignment_id} has an invalid status` };
  }
  return {
    assignment: {
      assignmentId: cells.assignment_id,
      sessionId: cells.session_id,
      generationId: cells.generation_id,
      blockIndex: block,
      location: cells.location as StoredAssignment["location"],
      fighterId: cells.fighter_id,
      volunteerId: cells.volunteer_id,
      status: cells.status as StoredAssignment["status"],
      locked,
      approvedNumericExceptionId: cells.numeric_exception_id || undefined,
      updatedAt: cells.updated_at,
      updatedBy: cells.updated_by,
    },
  };
}

export function assignmentToRow(row: StoredAssignment): (string | number | boolean)[] {
  return [
    row.assignmentId,
    row.sessionId,
    row.generationId,
    row.blockIndex,
    row.location,
    row.fighterId,
    row.volunteerId,
    row.status,
    row.locked,
    row.approvedNumericExceptionId ?? "",
    row.updatedAt,
    row.updatedBy,
  ];
}

export function parseRestrictionRow(row: unknown[]): { restriction: StoredRestriction } | { error: string } | { skip: true } {
  const cells = record(TAB_HEADERS.Restrictions, row);
  if (!cells) return { skip: true };
  const active = bool(cells.active);
  if (!cells.restriction_id || !cells.athlete_a_id || !cells.athlete_b_id || active === null) {
    return { error: `Restrictions row ${cells.restriction_id || "(missing id)"} is corrupt` };
  }
  return {
    restriction: {
      restrictionId: cells.restriction_id,
      athleteAId: cells.athlete_a_id,
      athleteBId: cells.athlete_b_id,
      reason: cells.reason,
      active,
      createdBy: cells.created_by,
      createdAt: cells.created_at,
      updatedAt: cells.updated_at,
    },
  };
}

export function restrictionToRow(row: StoredRestriction): (string | number | boolean)[] {
  return [row.restrictionId, row.athleteAId, row.athleteBId, row.reason, row.active, row.createdBy, row.createdAt, row.updatedAt];
}

export function parseOverrideRow(row: unknown[]): { override: StoredOverride } | { error: string } | { skip: true } {
  const cells = record(TAB_HEADERS.Overrides, row);
  if (!cells) return { skip: true };
  const active = bool(cells.active);
  if (!cells.override_id || !cells.session_id || active === null) {
    return { error: `Overrides row ${cells.override_id || "(missing id)"} is corrupt` };
  }
  return {
    override: {
      overrideId: cells.override_id,
      sessionId: cells.session_id,
      fighterId: cells.fighter_id,
      volunteerId: cells.volunteer_id,
      allowedNumericLimitsJson: cells.allowed_numeric_limits_json,
      coachEmail: cells.coach_email,
      reason: cells.reason,
      acknowledgedAt: cells.acknowledged_at,
      active,
    },
  };
}

export function overrideToRow(row: StoredOverride): (string | number | boolean)[] {
  return [
    row.overrideId,
    row.sessionId,
    row.fighterId,
    row.volunteerId,
    row.allowedNumericLimitsJson,
    row.coachEmail,
    row.reason,
    row.acknowledgedAt,
    row.active,
  ];
}

export function parseAuditRow(row: unknown[]): { audit: AuditEvent } | { error: string } | { skip: true } {
  const cells = record(TAB_HEADERS.AuditLog, row);
  if (!cells) return { skip: true };
  const prior = num(cells.prior_revision);
  const next = num(cells.new_revision);
  if (!cells.audit_id || prior === null || next === null) {
    return { error: `Audit row ${cells.audit_id || "(missing id)"} is corrupt` };
  }
  let payload: Record<string, unknown> = {};
  if (cells.payload_json) {
    try {
      const parsed = JSON.parse(cells.payload_json) as unknown;
      payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return { error: `Audit row ${cells.audit_id} has corrupt payload JSON` };
    }
  }
  return {
    audit: {
      auditId: cells.audit_id,
      sessionId: cells.session_id,
      actorEmail: cells.actor_email,
      eventType: cells.event_type,
      requestId: cells.request_id,
      priorRevision: prior,
      newRevision: next,
      timestamp: cells.timestamp,
      payload,
    },
  };
}

export function auditToRow(row: AuditEvent): (string | number | boolean)[] {
  let payload = JSON.stringify(row.payload);
  if (payload.length > 8000) payload = JSON.stringify({ truncated: true, eventType: row.eventType });
  return [row.auditId, row.sessionId, row.actorEmail, row.eventType, row.requestId, row.priorRevision, row.newRevision, row.timestamp, payload];
}

export function escapeExportCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
