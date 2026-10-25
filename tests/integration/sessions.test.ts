import { beforeEach, describe, expect, it } from "vitest";
import { GET as getAthletes, POST as postAthletes } from "@/app/api/athletes/route";
import { POST as postRestrictions } from "@/app/api/restrictions/route";
import { createAthlete } from "@/lib/services/athlete-service";
import { putAttendance, createSession } from "@/lib/services/session-service";
import { completeBlock, generate, regenerate } from "@/lib/services/schedule-service";
import { resetMemoryStore } from "@/lib/repository/memory";
import { createMemoryLock, createUnavailableLock, getLockManager, resetMemoryLocks, setLockManagerForTests } from "@/lib/redis/lock";
import { parseAthleteRow } from "@/lib/sheets/rows";
import { testAuthEnabled } from "@/lib/api/guard";

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

  it("does not enable the test sign-in bypass in production", () => {
    const env = process.env as { NODE_ENV?: string };
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    expect(testAuthEnabled()).toBe(false);
    env.NODE_ENV = previous;
  });
});

describe("session writes", () => {
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
});
