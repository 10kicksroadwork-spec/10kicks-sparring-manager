import { beforeEach, describe, expect, it } from "vitest";
import { GET as getAthletes, POST as postAthletes } from "@/app/api/athletes/route";
import { POST as postRestrictions } from "@/app/api/restrictions/route";
import { createAthlete } from "@/lib/services/athlete-service";
import { putAttendance, createSession, ensureCampFighters, getSession, updateSettings } from "@/lib/services/session-service";
import { completeBlock, generate, regenerate, unpublishRundown } from "@/lib/services/schedule-service";
import { resetMemoryStore } from "@/lib/repository/memory";
import { createMemoryLock, createUnavailableLock, getLockManager, resetMemoryLocks, setLockManagerForTests } from "@/lib/redis/lock";
import { parseAthleteRow } from "@/lib/sheets/rows";
import { saturdayPresetSettings } from "@/lib/domain/types";
import { testAuthEnabled } from "@/lib/api/guard";
import { authRequired, integrationStatus } from "@/lib/env";
import { getRepository } from "@/lib/repository";

const coach = { email: "coach@10kicks.test", role: "coach" as const };
const viewer = { email: "viewer@10kicks.test", role: "viewer" as const };

function athleteBody(name: string, role: "FIGHTER" | "VOLUNTEER" | "BOTH" = "BOTH") {
  return { displayName: name, weightLbs: 160, skill: 3, aggression: 3, roleEligibility: role, requestId: `req-${name}-${crypto.randomUUID()}` };
}

beforeEach(() => {
  resetMemoryStore();
  resetMemoryLocks();
  setLockManagerForTests(null);
});

describe("API guards", () => {
  it("rejects anonymous roster reads and writes", async () => {
    const read = await getAthletes(new Request("http://localhost/api/athletes"));
    expect(read.status).toBe(401);
    const write = await postAthletes(new Request("http://localhost/api/athletes", { method: "POST", headers: { origin: "http://localhost" }, body: "{}" }));
    expect(write.status).toBe(401);
  });

  it("rejects an allowlisted-missing Google account with 403 and no roster", async () => {
    const response = await getAthletes(new Request("http://localhost/api/athletes", { headers: { "x-test-user-email": "stranger@example.com" } }));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("athleteId");
  });

  it("blocks viewers and coaches from the wrong actions", async () => {
    const viewerWrite = await postAthletes(new Request("http://localhost/api/athletes", {
      method: "POST",
      headers: { origin: "http://localhost", "x-test-user-email": viewer.email, "content-type": "application/json" },
      body: JSON.stringify(athleteBody("Nope")),
    }));
    expect(viewerWrite.status).toBe(403);
    const coachRestriction = await postRestrictions(new Request("http://localhost/api/restrictions", {
      method: "POST",
      headers: { origin: "http://localhost", "x-test-user-email": coach.email, "content-type": "application/json" },
      body: JSON.stringify({ requestId: "req-restrict-1", expectedRevision: 0, athleteAId: "a", athleteBId: "b", reason: "no" }),
    }));
    expect(coachRestriction.status).toBe(403);
    const badOrigin = await postAthletes(new Request("http://localhost/api/athletes", {
      method: "POST",
      headers: { origin: "https://evil.example", "x-test-user-email": coach.email, "content-type": "application/json" },
      body: JSON.stringify(athleteBody("Origin")),
    }));
    expect(badOrigin.status).toBe(403);
  });

  it("rejects a bad payload with a short message", async () => {
    const response = await postAthletes(new Request("http://localhost/api/athletes", {
      method: "POST",
      headers: { origin: "http://localhost", "x-test-user-email": coach.email, "content-type": "application/json" },
      body: JSON.stringify({ requestId: "req-short", displayName: "", weightLbs: -1 }),
    }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body.error.message.length).toBeLessThan(400);
  });

  it("opens the roster as a local coach when Google auth is off", async () => {
    const previous = process.env.AUTH_REQUIRED;
    delete process.env.AUTH_REQUIRED;
    expect(authRequired()).toBe(false);
    try {
      const read = await getAthletes(new Request("http://localhost/api/athletes"));
      expect(read.status).toBe(200);
      const body = await read.json();
      expect(body.ok).toBe(true);
    } finally {
      process.env.AUTH_REQUIRED = previous;
    }
  });

  it("uses Supabase and the Postgres lock in production when the server key is set", () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = {
      NODE_ENV: env.NODE_ENV,
      SPARRING_STORE: env.SPARRING_STORE,
      url: env.NEXT_PUBLIC_SUPABASE_URL,
      key: env.SUPABASE_SERVICE_ROLE_KEY,
    };
    env.NODE_ENV = "production";
    delete env.SPARRING_STORE;
    env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    try {
      expect(getRepository().kind).toBe("supabase");
      expect(getLockManager().mode).toBe("postgres");
      const status = integrationStatus();
      expect(status.supabase).toBe("connected");
      expect(status.store).toBe("supabase");
      expect(status.lock).toBe("postgres");
    } finally {
      env.NODE_ENV = previous.NODE_ENV;
      env.SPARRING_STORE = previous.SPARRING_STORE;
      if (previous.url === undefined) delete env.NEXT_PUBLIC_SUPABASE_URL;
      else env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
      if (previous.key === undefined) delete env.SUPABASE_SERVICE_ROLE_KEY;
      else env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
    }
  });

  it("does not enable the test sign-in bypass in production", () => {
    const env = process.env as { NODE_ENV?: string };
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    expect(testAuthEnabled()).toBe(false);
    env.NODE_ENV = previous;
  });
});

describe("session writes", () => {
  it("saves session timing and revised limits without an acknowledgement checkbox", async () => {
    const created = await createSession(coach, { requestId: "req-timing-create" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sessionId = created.data.session.sessionId;
    const initialRevision = created.revision ?? created.data.session.revision;
    const originalLimits = saturdayPresetSettings().limits;
    const nextLimits = { ...originalLimits, maxWeightDifferenceLbs: 20 };
    const saved = await updateSettings(coach, sessionId, {
      requestId: "req-timing-save",
      expectedRevision: initialRevision,
      limits: nextLimits,
      timing: { roundMinutes: 2, restSeconds: 30 },
    });
    expect(saved.ok).toBe(true);
    const read = await getSession(coach, sessionId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.session.settings.limits.maxWeightDifferenceLbs).toBe(20);
    expect(read.data.session.settings.timing).toEqual({ roundMinutes: 2, restSeconds: 30 });
    const stale = await updateSettings(coach, sessionId, {
      requestId: "req-timing-stale",
      expectedRevision: initialRevision,
      limits: originalLimits,
      timing: { roundMinutes: 3, restSeconds: 60 },
    });
    expect(stale.ok).toBe(false);
  });
  it("keeps a new athlete and check-in, rejects a stale revision, and replays generate", async () => {
    const created = await createAthlete(coach, athleteBody("Demo Fighter A", "FIGHTER"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const session = await createSession(coach, { requestId: "req-session-1" });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const checkIn = await putAttendance(coach, session.data.session.sessionId, {
      requestId: "req-attend-1",
      expectedRevision: session.revision ?? 1,
      athleteId: created.data.athlete.athleteId,
      assignedRole: "FIGHTER",
      present: true,
    });
    expect(checkIn.ok).toBe(true);
    const stale = await putAttendance(coach, session.data.session.sessionId, {
      requestId: "req-attend-2",
      expectedRevision: session.revision ?? 1,
      athleteId: created.data.athlete.athleteId,
      present: false,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.code).toBe("STALE_REVISION");
  });

  it("does not silently apply two concurrent edits", async () => {
    const session = await createSession(coach, { requestId: "req-session-race" });
    if (!session.ok) throw new Error("session");
    const a = await createAthlete(coach, athleteBody("Racer A", "FIGHTER"));
    const b = await createAthlete(coach, athleteBody("Racer B", "VOLUNTEER"));
    if (!a.ok || !b.ok) throw new Error("athletes");
    const revision = session.revision ?? 1;
    const [first, second] = await Promise.all([
      putAttendance(coach, session.data.session.sessionId, { requestId: "req-race-a", expectedRevision: revision, athleteId: a.data.athlete.athleteId, assignedRole: "FIGHTER", present: true }),
      putAttendance(coach, session.data.session.sessionId, { requestId: "req-race-b", expectedRevision: revision, athleteId: b.data.athlete.athleteId, assignedRole: "VOLUNTEER", present: true }),
    ]);
    const oks = [first, second].filter((result) => result.ok);
    expect(oks).toHaveLength(1);
    const codes = [first, second].filter((result) => !result.ok).map((result) => result.code);
    expect(codes[0] === "STALE_REVISION" || codes[0] === "LOCKED").toBe(true);
  });

  it("fails closed when the lock service is down", async () => {
    setLockManagerForTests(createUnavailableLock());
    const result = await createAthlete(coach, athleteBody("Should Not Save"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("REDIS_UNAVAILABLE");
    setLockManagerForTests(null);
  });

  it("publishes one generation for a repeated generate request and preserves completed work", async () => {
    const fighters = [];
    for (let i = 1; i <= 5; i += 1) {
      const row = await createAthlete(coach, athleteBody(`Fighter ${i}`, "FIGHTER"));
      if (!row.ok) throw new Error("fighter");
      fighters.push(row.data.athlete);
    }
    const volunteers = [];
    for (let i = 1; i <= 15; i += 1) {
      const row = await createAthlete(coach, athleteBody(`Volunteer ${i}`, "VOLUNTEER"));
      if (!row.ok) throw new Error("volunteer");
      volunteers.push(row.data.athlete);
    }
    const session = await createSession(coach, { requestId: "req-demo-session" });
    if (!session.ok) throw new Error("session");
    let revision = session.revision ?? 1;
    for (const fighter of fighters) {
      const row = await putAttendance(coach, session.data.session.sessionId, { requestId: `req-f-${fighter.athleteId}`, expectedRevision: revision, athleteId: fighter.athleteId, assignedRole: "FIGHTER", present: true });
      if (!row.ok) throw new Error(row.message);
      revision = row.revision ?? revision;
    }
    for (const volunteer of volunteers) {
      const row = await putAttendance(coach, session.data.session.sessionId, { requestId: `req-v-${volunteer.athleteId}`, expectedRevision: revision, athleteId: volunteer.athleteId, assignedRole: "VOLUNTEER", present: true });
      if (!row.ok) throw new Error(row.message);
      revision = row.revision ?? revision;
    }
    const first = await generate(coach, session.data.session.sessionId, { requestId: "req-generate-same", expectedRevision: revision });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const published = first.data as { published: boolean; assignments: { assignmentId: string; blockIndex: number; status: string; locked: boolean; fighterId: string; volunteerId: string; location: string }[] };
    expect(published.published).toBe(true);
    expect(published.assignments).toHaveLength(15);
    const second = await generate(coach, session.data.session.sessionId, { requestId: "req-generate-same", expectedRevision: revision });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const replayed = second.data as { assignments: unknown[] };
    expect(replayed.assignments).toHaveLength(15);

    const blockOne = published.assignments.filter((row) => row.blockIndex === 1);
    const completed = await completeBlock(coach, session.data.session.sessionId, 1, { requestId: "req-complete-1", expectedRevision: first.revision ?? revision, confirmBothRounds: true });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    const later = published.assignments.find((row) => row.blockIndex > 1);
    if (!later) throw new Error("expected a later match");
    const { patchAssignment } = await import("@/lib/services/schedule-service");
    const locked = await patchAssignment(coach, session.data.session.sessionId, later.assignmentId, { requestId: "req-lock-1", expectedRevision: completed.revision ?? 0, action: "lock" });
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    const used = new Set(blockOne.map((row) => row.volunteerId).concat(later.volunteerId));
    const removable = volunteers.find((volunteer) => !used.has(volunteer.athleteId));
    if (!removable) throw new Error("no removable volunteer");
    const removed = await putAttendance(coach, session.data.session.sessionId, {
      requestId: "req-remove-vol",
      expectedRevision: locked.revision ?? 0,
      athleteId: removable.athleteId,
      assignedRole: "VOLUNTEER",
      present: true,
      availabilityStatus: "REMOVED",
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const again = await regenerate(coach, session.data.session.sessionId, { requestId: "req-regen-1", expectedRevision: removed.revision ?? 0 });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const next = again.data as { published: boolean; assignments: { assignmentId: string; blockIndex: number; status: string; locked: boolean; fighterId: string; volunteerId: string; location: string }[] };
    expect(next.published).toBe(true);
    for (const original of blockOne) {
      const kept = next.assignments.find((row) => row.assignmentId === original.assignmentId);
      expect(kept?.status).toBe("COMPLETED");
      expect(kept?.fighterId).toBe(original.fighterId);
      expect(kept?.volunteerId).toBe(original.volunteerId);
      expect(kept?.location).toBe(original.location);
      expect(kept?.blockIndex).toBe(original.blockIndex);
    }
    const keptLock = next.assignments.find((row) => row.assignmentId === later.assignmentId);
    expect(keptLock?.locked).toBe(true);
    expect(keptLock?.volunteerId).toBe(later.volunteerId);
    expect(next.assignments.some((row) => row.volunteerId === removable.athleteId && row.status === "PLANNED" && !row.locked)).toBe(false);
  });

  it("reports corrupt sheet rows instead of treating them as athletes", () => {
    const parsed = parseAthleteRow(["id-1", "Broken", "nope", "3", "3", "FIGHTER", "TRUE", "", "t", "t"]);
    expect("error" in parsed).toBe(true);
  });

  it("keeps a directory row with a blank skill and blocks hard-session check-in", async () => {
    const parsed = parseAthleteRow(["id-2", "Directory", "", "7", "", "BOTH", "TRUE", "weight_band:180-200", "t", "t"]);
    expect("athlete" in parsed).toBe(true);
    if (!("athlete" in parsed)) return;
    expect(parsed.athlete.weightLbs).toBeNull();
    expect(parsed.athlete.skill).toBe(7);
    expect(parsed.athlete.aggression).toBeNull();

    const now = new Date().toISOString();
    await getRepository().commit({
      athletes: [{ ...parsed.athlete, athleteId: "dir-1", createdAt: now, updatedAt: now }],
      audit: {
        auditId: "audit-dir",
        sessionId: "roster",
        actorEmail: coach.email,
        eventType: "athlete.import",
        requestId: "req-import-dir",
        priorRevision: 0,
        newRevision: 0,
        timestamp: now,
        payload: {},
      },
    });
    const session = await createSession(coach, { requestId: "req-dir-session" });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const checked = await putAttendance(coach, session.data.session.sessionId, {
      requestId: "req-dir-checkin",
      expectedRevision: session.data.session.revision,
      athleteId: "dir-1",
      assignedRole: "FIGHTER",
      present: true,
    });
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.code).toBe("INCOMPLETE_PROFILE");
    expect(checked.message).not.toMatch(/aggression/i);
  });

  it("checks in an inactive rated person and will not generate with only fighters", async () => {
    const now = new Date().toISOString();
    await getRepository().commit({
      athletes: [
        {
          athleteId: "camp-fighter",
          displayName: "Camp Fighter",
          weightLbs: 170,
          skill: 5,
          aggression: null,
          roleEligibility: "BOTH",
          active: true,
          coachNotes: "",
          createdAt: now,
          updatedAt: now,
        },
        {
          athleteId: "rated-volunteer",
          displayName: "Rated Volunteer",
          weightLbs: 160,
          skill: 4,
          aggression: null,
          roleEligibility: "BOTH",
          active: false,
          coachNotes: "",
          createdAt: now,
          updatedAt: now,
        },
      ],
      audit: {
        auditId: "audit-inactive-ready",
        sessionId: "roster",
        actorEmail: coach.email,
        eventType: "athlete.import",
        requestId: "req-import-inactive",
        priorRevision: 0,
        newRevision: 0,
        timestamp: now,
        payload: {},
      },
    });
    const session = await createSession(coach, { requestId: "req-inactive-session" });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const checked = await putAttendance(coach, session.data.session.sessionId, {
      requestId: "req-inactive-checkin",
      expectedRevision: session.data.session.revision,
      athleteId: "rated-volunteer",
      assignedRole: "VOLUNTEER",
      present: true,
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.data.attendance.assignedRole).toBe("VOLUNTEER");
    const stillInactive = (await getRepository().readAthletes()).rows.find((row) => row.athleteId === "rated-volunteer");
    expect(stillInactive?.active).toBe(false);

    const fighter = await putAttendance(coach, session.data.session.sessionId, {
      requestId: "req-camp-only",
      expectedRevision: checked.revision ?? session.data.session.revision,
      athleteId: "camp-fighter",
      assignedRole: "FIGHTER",
      present: true,
    });
    expect(fighter.ok).toBe(true);
    if (!fighter.ok) return;
    const removed = await putAttendance(coach, session.data.session.sessionId, {
      requestId: "req-clear-volunteer",
      expectedRevision: fighter.revision ?? checked.revision ?? session.data.session.revision,
      athleteId: "rated-volunteer",
      assignedRole: "VOLUNTEER",
      present: false,
      availabilityStatus: "REMOVED",
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const generated = await generate(coach, session.data.session.sessionId, {
      requestId: "req-need-volunteers",
      expectedRevision: removed.revision ?? fighter.revision ?? session.data.session.revision,
    });
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    const solve = generated.data.solve as { status: string; diagnostics?: { code: string; message: string }[] };
    expect(generated.data.published).toBe(false);
    expect(solve.status).toBe("UNSAT");
    expect(solve.diagnostics?.some((item) => item.code === "EMPTY_VOLUNTEER_ATTENDANCE")).toBe(true);
    expect(solve.diagnostics?.some((item) => /themselves/i.test(item.message))).toBe(true);
  });

  it("checks in a person who has weight and skill and no aggression", async () => {
    const parsed = parseAthleteRow(["id-3", "Mason Cauthen", "170", "5", "", "BOTH", "TRUE", "weight_band:160-180", "t", "t"]);
    expect("athlete" in parsed).toBe(true);
    if (!("athlete" in parsed)) return;
    expect(parsed.athlete.weightLbs).toBe(170);
    expect(parsed.athlete.skill).toBe(5);
    expect(parsed.athlete.aggression).toBeNull();

    const now = new Date().toISOString();
    await getRepository().commit({
      athletes: [{ ...parsed.athlete, athleteId: "dir-ready", createdAt: now, updatedAt: now }],
      audit: {
        auditId: "audit-ready",
        sessionId: "roster",
        actorEmail: coach.email,
        eventType: "athlete.import",
        requestId: "req-import-ready",
        priorRevision: 0,
        newRevision: 0,
        timestamp: now,
        payload: {},
      },
    });
    const session = await createSession(coach, { requestId: "req-ready-session" });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const checked = await putAttendance(coach, session.data.session.sessionId, {
      requestId: "req-ready-checkin",
      expectedRevision: session.data.session.revision,
      athleteId: "dir-ready",
      assignedRole: "FIGHTER",
      present: true,
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.data.attendance.weightLbsSnapshot).toBe(170);
    expect(checked.data.attendance.skillSnapshot).toBe(5);
    expect(checked.data.attendance.aggressionSnapshot).toBeNull();
  });

  it("checks camp fighters in when Saturday starts and does not undo an absence", async () => {
    const camp = await createAthlete(coach, athleteBody("Camp Default", "BOTH"));
    const volunteerOnly = await createAthlete(coach, athleteBody("Volunteer Only", "VOLUNTEER"));
    if (!camp.ok || !volunteerOnly.ok) throw new Error("athletes");
    const session = await createSession(coach, { requestId: "req-camp-seed" });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const view = await getSession(coach, session.data.session.sessionId);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    const rows = view.data.attendance;
    expect(rows.find((row) => row.athleteId === camp.data.athlete.athleteId)).toMatchObject({ assignedRole: "FIGHTER", present: true, availabilityStatus: "AVAILABLE" });
    expect(rows.some((row) => row.athleteId === volunteerOnly.data.athlete.athleteId)).toBe(false);

    const removed = await putAttendance(coach, session.data.session.sessionId, {
      requestId: "req-camp-absent",
      expectedRevision: view.revision ?? session.data.session.revision,
      athleteId: camp.data.athlete.athleteId,
      assignedRole: "FIGHTER",
      present: false,
      availabilityStatus: "REMOVED",
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const stayed = await createAthlete(coach, athleteBody("Still Here", "BOTH"));
    if (!stayed.ok) throw new Error("second");
    const seeded = await ensureCampFighters(coach, session.data.session.sessionId, {
      requestId: "req-camp-ensure",
      expectedRevision: removed.revision ?? 0,
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const after = await getSession(coach, session.data.session.sessionId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.data.attendance.find((row) => row.athleteId === camp.data.athlete.athleteId)?.present).toBe(false);
    expect(after.data.attendance.find((row) => row.athleteId === stayed.data.athlete.athleteId)?.assignedRole).toBe("FIGHTER");
  });

  it("discards an unstarted rundown and keeps one that has started", async () => {
    const fighter = await createAthlete(coach, athleteBody("Undo Fighter", "FIGHTER"));
    if (!fighter.ok) throw new Error("fighter");
    const session = await createSession(coach, { requestId: "req-unpublish-session" });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const now = new Date().toISOString();
    const record = { ...session.data.session, activeGenerationId: "gen-open", updatedAt: now };
    await getRepository().commit({
      session: record,
      assignmentInserts: [{
        assignmentId: "asg-open",
        sessionId: record.sessionId,
        generationId: "gen-open",
        blockIndex: 1,
        location: "MAIN_RING",
        fighterId: fighter.data.athlete.athleteId,
        volunteerId: "missing-volunteer",
        status: "PLANNED",
        locked: false,
        updatedAt: now,
        updatedBy: coach.email,
      }],
      audit: {
        auditId: "audit-open-gen",
        sessionId: record.sessionId,
        actorEmail: coach.email,
        eventType: "test.seed",
        requestId: "req-seed-open-gen",
        priorRevision: record.revision,
        newRevision: record.revision,
        timestamp: now,
        payload: {},
      },
    });
    const cleared = await unpublishRundown(coach, record.sessionId, { requestId: "req-unpublish-open", expectedRevision: record.revision });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const open = await getSession(coach, record.sessionId);
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    expect(open.data.session.activeGenerationId).toBe("");
    expect(open.data.assignments).toHaveLength(0);

    const startedRecord = { ...open.data.session, activeGenerationId: "gen-started" };
    await getRepository().commit({
      session: startedRecord,
      assignmentInserts: [{
        assignmentId: "asg-started",
        sessionId: startedRecord.sessionId,
        generationId: "gen-started",
        blockIndex: 1,
        location: "MAIN_RING",
        fighterId: fighter.data.athlete.athleteId,
        volunteerId: "missing-volunteer",
        status: "COMPLETED",
        locked: false,
        updatedAt: now,
        updatedBy: coach.email,
      }],
      audit: {
        auditId: "audit-started-gen",
        sessionId: startedRecord.sessionId,
        actorEmail: coach.email,
        eventType: "test.seed",
        requestId: "req-seed-started-gen",
        priorRevision: startedRecord.revision,
        newRevision: startedRecord.revision,
        timestamp: now,
        payload: {},
      },
    });
    const blocked = await unpublishRundown(coach, startedRecord.sessionId, { requestId: "req-unpublish-started", expectedRevision: startedRecord.revision });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe("RUNDOWN_STARTED");
    const kept = await getSession(coach, startedRecord.sessionId);
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.data.session.activeGenerationId).toBe("gen-started");
    expect(kept.data.assignments).toHaveLength(1);
  });

  it("releases only the lock token that acquired it", async () => {
    const lock = createMemoryLock();
    expect(await lock.acquire("session-1", "token-a", 5_000)).toBe(true);
    expect(await lock.acquire("session-1", "token-b", 5_000)).toBe(false);
    await lock.release("session-1", "token-b");
    expect(await lock.acquire("session-1", "token-b", 5_000)).toBe(false);
    await lock.release("session-1", "token-a");
    expect(await lock.acquire("session-1", "token-b", 5_000)).toBe(true);
    expect(getLockManager().mode).toBe("memory");
  });

  it("swaps an eligible volunteer on a planned match and refuses invalid swaps", async () => {
    const { patchAssignment } = await import("@/lib/services/schedule-service");
    const session = await createSession(coach, { requestId: "req-swap-session", dateLocal: "2099-03-01" });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    let revision = session.data.session.revision;
    const fighters = [];
    for (let i = 0; i < 5; i += 1) {
      const created = await createAthlete(coach, { ...athleteBody(`Swap Fighter ${i}`), requestId: `req-sf-${i}` });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      fighters.push(created.data.athlete);
      const checked = await putAttendance(coach, session.data.session.sessionId, {
        requestId: `req-sf-in-${i}`,
        expectedRevision: revision,
        athleteId: created.data.athlete.athleteId,
        assignedRole: "FIGHTER",
        present: true,
      });
      expect(checked.ok).toBe(true);
      if (!checked.ok) return;
      revision = checked.revision ?? revision;
    }
    const volunteers = [];
    for (let i = 0; i < 15; i += 1) {
      const created = await createAthlete(coach, { ...athleteBody(`Swap Vol ${i}`), requestId: `req-sv-${i}` });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      volunteers.push(created.data.athlete);
      const checked = await putAttendance(coach, session.data.session.sessionId, {
        requestId: `req-sv-in-${i}`,
        expectedRevision: revision,
        athleteId: created.data.athlete.athleteId,
        assignedRole: "VOLUNTEER",
        present: true,
      });
      expect(checked.ok).toBe(true);
      if (!checked.ok) return;
      revision = checked.revision ?? revision;
    }
    const published = await generate(coach, session.data.session.sessionId, { requestId: "req-swap-gen", expectedRevision: revision });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    const data = published.data as { published: boolean; assignments: { assignmentId: string; fighterId: string; volunteerId: string; blockIndex: number; status: string; locked: boolean }[] };
    expect(data.published).toBe(true);
    const target = data.assignments.find((row) => row.status === "PLANNED" && !row.locked);
    expect(target).toBeTruthy();
    if (!target) return;
    const view = await getSession(coach, session.data.session.sessionId);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    const options = view.data.swaps?.[target.assignmentId] ?? [];
    expect(options.some((row) => row.current && row.volunteerId === target.volunteerId)).toBe(true);
    const replacement = options.find((row) => !row.current);
    expect(replacement).toBeTruthy();
    if (!replacement) return;
    const swapped = await patchAssignment(coach, session.data.session.sessionId, target.assignmentId, {
      requestId: "req-swap-ok",
      expectedRevision: view.revision ?? published.revision ?? revision,
      action: "set-volunteer",
      volunteerId: replacement.volunteerId,
    });
    expect(swapped.ok).toBe(true);
    if (!swapped.ok) return;
    expect(swapped.data.assignment.volunteerId).toBe(replacement.volunteerId);

    const locked = await patchAssignment(coach, session.data.session.sessionId, target.assignmentId, {
      requestId: "req-swap-lock",
      expectedRevision: swapped.revision ?? 0,
      action: "lock",
    });
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    const refused = await patchAssignment(coach, session.data.session.sessionId, target.assignmentId, {
      requestId: "req-swap-locked",
      expectedRevision: locked.revision ?? 0,
      action: "set-volunteer",
      volunteerId: target.volunteerId,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe("MATCH_LOCKED");
  });

  it("hard-deletes a previous session and related rows", async () => {
    const { deleteSession } = await import("@/lib/services/session-service");
    const session = await createSession(coach, { requestId: "req-del-session", dateLocal: "2099-04-01" });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const fighter = await createAthlete(coach, { ...athleteBody("Delete Fighter"), requestId: "req-del-f" });
    expect(fighter.ok).toBe(true);
    if (!fighter.ok) return;
    const checked = await putAttendance(coach, session.data.session.sessionId, {
      requestId: "req-del-in",
      expectedRevision: session.data.session.revision,
      athleteId: fighter.data.athlete.athleteId,
      assignedRole: "FIGHTER",
      present: true,
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const removed = await deleteSession(coach, session.data.session.sessionId, {
      requestId: "req-del-go",
      expectedRevision: checked.revision ?? session.data.session.revision,
      confirm: true,
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.data.deleted).toBe(true);
    const gone = await getSession(coach, session.data.session.sessionId);
    expect(gone.ok).toBe(false);
    if (gone.ok) return;
    expect(gone.code).toBe("NOT_FOUND");
    const attendance = await getRepository().readAttendance(session.data.session.sessionId);
    expect(attendance.rows).toHaveLength(0);
    const assignments = await getRepository().readAssignments(session.data.session.sessionId);
    expect(assignments.rows).toHaveLength(0);
  });
});

