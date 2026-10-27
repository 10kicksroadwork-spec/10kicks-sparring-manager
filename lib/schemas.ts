import { z } from "zod";

const roleEligibility = z.enum(["FIGHTER", "VOLUNTEER", "BOTH"]);
const sessionRole = z.enum(["FIGHTER", "VOLUNTEER"]);
const location = z.enum(["MAIN_RING", "FLOOR_1", "FLOOR_2"]);
const assignmentStatus = z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "INTERRUPTED"]);

export const mutationMeta = {
  expectedRevision: z.number().int().nonnegative(),
  requestId: z.string().trim().min(8).max(80),
};

export const athleteCreateSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  weightLbs: z.number().positive().max(500),
  skill: z.number().int().min(1).max(7),
  aggression: z.number().int().min(1).max(5).nullish(),
  roleEligibility,
  coachNotes: z.string().trim().max(280).optional(),
});

export const athletePatchSchema = athleteCreateSchema.partial().extend({
  active: z.boolean().optional(),
  ...mutationMeta,
});

export const sessionCreateSchema = z.object({
  dateLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  requestId: mutationMeta.requestId,
});

export const limitsSchema = z.object({
  maxWeightDifferenceLbs: z.number().positive().max(100),
  maxWeightDifferencePctOfLighterAthlete: z.number().positive().max(100),
  maxSkillDifference: z.number().int().min(0).max(6),
  maxAggressionDifference: z.number().int().min(0).max(4),
});

export const timingSchema = z.object({
  roundMinutes: z.number().int().min(1).max(15),
  restSeconds: z.number().int().min(0).max(300),
});

export const settingsSchema = z.object({
  ...mutationMeta,
  limits: limitsSchema,
  timing: timingSchema,
});

export const attendancePutSchema = z.object({
  ...mutationMeta,
  athleteId: z.string().trim().min(1).optional(),
  assignedRole: sessionRole.optional(),
  present: z.boolean().optional(),
  availabilityStatus: z.enum(["AVAILABLE", "DEPARTED", "REMOVED"]).optional(),
  weightLbs: z.number().positive().max(500).optional(),
  skill: z.number().int().min(1).max(7).optional(),
  aggression: z.number().int().min(1).max(5).nullish(),
  createVolunteer: athleteCreateSchema.optional(),
});

export const generateSchema = z.object({
  ...mutationMeta,
});

export const assignmentPatchSchema = z.object({
  ...mutationMeta,
  action: z.enum(["lock", "unlock", "set-volunteer", "set-location", "set-status"]),
  volunteerId: z.string().trim().min(1).optional(),
  location: location.optional(),
  status: assignmentStatus.optional(),
  confirmBothRounds: z.boolean().optional(),
});

export const blockCompleteSchema = z.object({
  ...mutationMeta,
  confirmBothRounds: z.literal(true),
});

export const confirmSchema = z.object({
  ...mutationMeta,
  confirm: z.literal(true),
});

export const restrictionSchema = z.object({
  ...mutationMeta,
  athleteAId: z.string().trim().min(1),
  athleteBId: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(200),
  active: z.boolean().optional(),
});

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}
