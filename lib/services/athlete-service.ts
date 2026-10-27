import { randomUUID } from "node:crypto";
import { can } from "@/lib/permissions";
import type { Athlete } from "@/lib/repository/types";
import { type Actor, fail, nowIso, openStore, type ServiceResult, ServiceStop, withWrite } from "./support";

export async function listAthletes(actor: Actor, requestId = "read"): Promise<ServiceResult<{ athletes: Athlete[]; corrupt: string[] }>> {
  if (!can(actor.role, "read")) return fail(403, "FORBIDDEN", "Your account cannot do that.", requestId);
  const opened = await openStore(requestId);
  if ("ok" in opened) return opened;
  const result = await opened.repo.readAthletes();
  return { ok: true, data: { athletes: result.rows, corrupt: result.corrupt }, requestId };
}

export async function createAthlete(
  actor: Actor,
  input: { displayName: string; weightLbs: number; skill: number; aggression?: number | null; roleEligibility: Athlete["roleEligibility"]; coachNotes?: string; requestId: string },
): Promise<ServiceResult<{ athlete: Athlete }>> {
  const now = nowIso();
  const athlete: Athlete = {
    athleteId: randomUUID(),
    displayName: input.displayName.trim(),
    weightLbs: input.weightLbs,
    skill: input.skill,
    aggression: input.aggression ?? null,
    roleEligibility: input.roleEligibility,
    active: true,
    coachNotes: input.coachNotes?.trim() ?? "",
    createdAt: now,
    updatedAt: now,
  };
  return withWrite({
    actor,
    action: "editRoster",
    sessionId: "",
    expectedRevision: null,
    requestId: input.requestId,
    eventType: "athlete.create",
    run: async () => ({
      data: { athlete },
      batch: { athletes: [athlete] },
      auditSessionId: "roster",
    }),
  });
}

export async function updateAthlete(
  actor: Actor,
  athleteId: string,
  patch: Partial<Pick<Athlete, "displayName" | "weightLbs" | "skill" | "aggression" | "roleEligibility" | "coachNotes" | "active">> & {
    requestId: string;
  },
): Promise<ServiceResult<{ athlete: Athlete }>> {
  if (patch.active === false && !can(actor.role, "deactivateAthlete")) {
    return fail(403, "FORBIDDEN", "Only an admin can deactivate an athlete.", patch.requestId);
  }
  return withWrite({
    actor,
    action: "editRoster",
    sessionId: "",
    expectedRevision: null,
    requestId: patch.requestId,
    eventType: "athlete.update",
    run: async ({ repo, now }) => {
      const existing = (await repo.readAthletes()).rows.find((row) => row.athleteId === athleteId);
      if (!existing) throw new ServiceStop(fail(404, "NOT_FOUND", "That athlete does not exist.", patch.requestId));
      const athlete: Athlete = {
        ...existing,
        displayName: patch.displayName?.trim() || existing.displayName,
        weightLbs: patch.weightLbs ?? existing.weightLbs,
        skill: patch.skill ?? existing.skill,
        aggression: patch.aggression ?? existing.aggression,
        roleEligibility: patch.roleEligibility ?? existing.roleEligibility,
        coachNotes: patch.coachNotes !== undefined ? patch.coachNotes : existing.coachNotes,
        active: patch.active ?? existing.active,
        updatedAt: now,
      };
      return { data: { athlete }, batch: { athletes: [athlete] }, auditSessionId: "roster" };
    },
  });
}
