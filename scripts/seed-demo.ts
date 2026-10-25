import { loadLocalEnv } from "./load-env";

loadLocalEnv();

const FIGHTERS = ["Demo North", "Demo East", "Demo South", "Demo West", "Demo Center"];
const VOLUNTEERS = Array.from({ length: 15 }, (_, index) => `Demo Partner ${index + 1}`);

async function main(): Promise<void> {
  const { sheetsConfigured } = await import("../lib/sheets/client");
  const redis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  const coachEmail = (process.env.COACH_EMAILS ?? "").split(",").map((part) => part.trim().toLowerCase()).find(Boolean);
  if (!sheetsConfigured() || !redis || !coachEmail) {
    console.error("seed:demo skipped. Sheets, Redis, and COACH_EMAILS must all be set. No demo rows were written.");
    process.exitCode = 1;
    return;
  }
  const { roleForEmail } = await import("../lib/permissions");
  const role = roleForEmail(coachEmail);
  if (!role || role === "viewer") {
    console.error("seed:demo skipped. The first COACH_EMAILS entry cannot edit the roster. No demo rows were written.");
    process.exitCode = 1;
    return;
  }
  const actor = { email: coachEmail, role };
  const { createAthlete, listAthletes } = await import("../lib/services/athlete-service");
  const { createSession, listSessions, putAttendance } = await import("../lib/services/session-service");
  const existing = await listAthletes(actor, "seed-read");
  if (!existing.ok) throw new Error(existing.message);
  const byName = new Map(existing.data.athletes.map((athlete) => [athlete.displayName, athlete]));

  async function ensure(name: string, roleEligibility: "FIGHTER" | "VOLUNTEER") {
    const found = byName.get(name);
    if (found) return found.athleteId;
    const created = await createAthlete(actor, {
      displayName: name,
      weightLbs: 160,
      skill: 3,
      aggression: 3,
      roleEligibility,
      coachNotes: "DEMO invented person. Not a real athlete.",
      requestId: `seed-${name.replace(/\s+/g, "-").toLowerCase()}`,
    });
    if (!created.ok) throw new Error(created.message);
    return created.data.athlete.athleteId;
  }

  const fighterIds = [];
  for (const name of FIGHTERS) fighterIds.push(await ensure(name, "FIGHTER"));
  const volunteerIds = [];
  for (const name of VOLUNTEERS) volunteerIds.push(await ensure(name, "VOLUNTEER"));

  const sessions = await listSessions(actor, "seed-sessions");
  if (!sessions.ok) throw new Error(sessions.message);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIMEZONE || "America/New_York" }).format(new Date());
  let session = sessions.data.sessions.find((row) => row.dateLocal === today && row.status === "DRAFT" && row.createdBy === coachEmail);
  if (!session) {
    const created = await createSession(actor, { requestId: `seed-session-${today}`, dateLocal: today });
    if (!created.ok) throw new Error(created.message);
    session = created.data.session;
  }
  let revision = session.revision;
  const { getRepository } = await import("../lib/repository");
  const attendance = await getRepository().readAttendance(session.sessionId);
  const present = new Set(attendance.rows.filter((row) => row.present).map((row) => `${row.athleteId}:${row.assignedRole}`));

  async function checkIn(athleteId: string, assignedRole: "FIGHTER" | "VOLUNTEER") {
    if (present.has(`${athleteId}:${assignedRole}`)) return;
    const saved = await putAttendance(actor, session!.sessionId, {
      requestId: `seed-attend-${athleteId.slice(0, 8)}-${assignedRole}`,
      expectedRevision: revision,
      athleteId,
      assignedRole,
      present: true,
    });
    if (!saved.ok) throw new Error(saved.message);
    revision = saved.revision ?? revision;
  }

  for (const athleteId of fighterIds) await checkIn(athleteId, "FIGHTER");
  for (const athleteId of volunteerIds) await checkIn(athleteId, "VOLUNTEER");
  console.log(JSON.stringify({ sessionId: session.sessionId, fighters: fighterIds.length, volunteers: volunteerIds.length, dateLocal: today }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "seed:demo failed";
  console.error(message);
  process.exitCode = 1;
});
