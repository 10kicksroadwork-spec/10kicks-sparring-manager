"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/common/Shell";
import { api, newRequestId } from "@/components/common/client";
import { partitionCheckIn } from "@/lib/domain/check-in-lists";
import { isReadyForHardMatch } from "@/lib/domain/profile";
import { rundownStarted } from "@/lib/domain/rundown";

type Athlete = { athleteId: string; displayName: string; weightLbs: number | null; skill: number | null; aggression: number | null; roleEligibility: string; active: boolean };
type Attendance = { athleteId: string; displayName: string; assignedRole: "FIGHTER" | "VOLUNTEER"; present: boolean; availabilityStatus: string; weightLbsSnapshot: number; skillSnapshot: number; aggressionSnapshot: number | null };
type SessionPayload = {
  session: { sessionId: string; revision: number; status: string; activeGenerationId: string };
  attendance: Attendance[];
  assignments: { status: string; locked: boolean }[];
  corrupt: string[];
};

function needsCampSeed(athletes: Athlete[], view: SessionPayload): boolean {
  const seen = new Set(view.attendance.map((row) => row.athleteId));
  return athletes.some((athlete) => athlete.active && athlete.roleEligibility !== "VOLUNTEER" && isReadyForHardMatch(athlete) && !seen.has(athlete.athleteId));
}

function applyToggle(view: SessionPayload, athlete: Athlete, role: "FIGHTER" | "VOLUNTEER", present: boolean): SessionPayload {
  const attendance = view.attendance.filter((row) => row.athleteId !== athlete.athleteId);
  attendance.push({
    athleteId: athlete.athleteId,
    displayName: athlete.displayName,
    assignedRole: role,
    present,
    availabilityStatus: present ? "AVAILABLE" : "REMOVED",
    weightLbsSnapshot: athlete.weightLbs ?? 0,
    skillSnapshot: athlete.skill ?? 0,
    aggressionSnapshot: athlete.aggression,
  });
  return { ...view, attendance };
}

export default function AttendancePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const router = useRouter();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [view, setView] = useState<SessionPayload | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);
  const [walkIn, setWalkIn] = useState({ displayName: "", weightLbs: "", skill: "3" });
  const [query, setQuery] = useState("");
  const revisionRef = useRef(0);
  const chainRef = useRef(Promise.resolve());
  const desiredRef = useRef(new Map<string, { athlete: Athlete; role: "FIGHTER" | "VOLUNTEER"; present: boolean }>());

  async function reload() {
    const [roster, session] = await Promise.all([
      api<{ athletes: Athlete[] }>("/api/athletes"),
      api<SessionPayload>(`/api/sessions/${sessionId}`),
    ]);
    if (!roster.ok) setError(roster.error.message);
    else setAthletes(roster.data.athletes);
    if (!session.ok) setError(session.error.message);
    else {
      revisionRef.current = session.data.session.revision;
      setView(session.data);
    }
  }

  useEffect(() => {
    let ignore = false;
    void (async () => {
      const [roster, session] = await Promise.all([
        api<{ athletes: Athlete[] }>("/api/athletes"),
        api<SessionPayload>(`/api/sessions/${sessionId}`),
      ]);
      if (ignore) return;
      if (!roster.ok) {
        setError(roster.error.message);
        return;
      }
      if (!session.ok) {
        setError(session.error.message);
        return;
      }
      setAthletes(roster.data.athletes);
      let next = session.data;
      if (needsCampSeed(roster.data.athletes, next)) {
        const seeded = await api<{ seeded: number }>(`/api/sessions/${sessionId}/camp-fighters`, {
          method: "POST",
          body: JSON.stringify({ requestId: newRequestId(), expectedRevision: next.session.revision }),
        });
        if (ignore) return;
        if (!seeded.ok) setError(seeded.error.message);
        else if (seeded.data.seeded > 0) {
          const again = await api<SessionPayload>(`/api/sessions/${sessionId}`);
          if (!ignore && again.ok) next = again.data;
        }
      }
      revisionRef.current = next.session.revision;
      setView(next);
    })();
    return () => {
      ignore = true;
    };
  }, [sessionId]);

  const revision = view?.session.revision ?? 0;
  const checked = new Map(view?.attendance.filter((row) => row.present && row.availabilityStatus === "AVAILABLE").map((row) => [row.athleteId, row]));
  const fighters = [...checked.values()].filter((row) => row.assignedRole === "FIGHTER");
  const volunteers = [...checked.values()].filter((row) => row.assignedRole === "VOLUNTEER");
  const lists = partitionCheckIn(athletes, view?.attendance ?? []);
  const needle = query.trim().toLowerCase();
  const fighterList = needle ? lists.fighters.filter((athlete) => athlete.displayName.toLowerCase().includes(needle)) : lists.fighters;
  const volunteerList = needle ? lists.volunteers.filter((athlete) => athlete.displayName.toLowerCase().includes(needle)) : lists.volunteers;
  const canDiscard = Boolean(view?.session.activeGenerationId) && !rundownStarted(view?.session.status ?? "", view?.assignments ?? []);

  async function flush(athleteId: string) {
    const next = desiredRef.current.get(athleteId);
    if (!next) return;
    desiredRef.current.delete(athleteId);
    const result = await api(`/api/sessions/${sessionId}/attendance`, {
      method: "PUT",
      body: JSON.stringify({
        requestId: newRequestId(),
        expectedRevision: revisionRef.current,
        athleteId: next.athlete.athleteId,
        assignedRole: next.role,
        present: next.present,
        availabilityStatus: next.present ? "AVAILABLE" : "REMOVED",
        weightLbs: next.athlete.weightLbs ?? undefined,
        skill: next.athlete.skill ?? undefined,
      }),
    });
    if (!result.ok) {
      const latest = result.error.details?.revision;
      if (result.error.code === "STALE_REVISION" && typeof latest === "number") {
        revisionRef.current = latest;
        if (!desiredRef.current.has(athleteId)) desiredRef.current.set(athleteId, next);
        await flush(athleteId);
        return;
      }
      setError(result.error.message);
      await reload();
      return;
    }
    if (typeof result.revision === "number") revisionRef.current = result.revision;
    if (desiredRef.current.has(athleteId)) await flush(athleteId);
  }

  function toggle(athlete: Athlete, role: "FIGHTER" | "VOLUNTEER", present: boolean) {
    if (present && !isReadyForHardMatch(athlete)) {
      setError(`${athlete.displayName} needs weight and skill (1–7) before a hard session.`);
      return;
    }
    setError("");
    setView((current) => (current ? applyToggle(current, athlete, role, present) : current));
    desiredRef.current.set(athlete.athleteId, { athlete, role, present });
    setPending((count) => count + 1);
    chainRef.current = chainRef.current
      .then(() => flush(athlete.athleteId))
      .finally(() => setPending((count) => Math.max(0, count - 1)));
  }

  async function addWalkIn(event: React.FormEvent) {
    event.preventDefault();
    await chainRef.current;
    setBusy(true);
    setError("");
    const result = await api(`/api/sessions/${sessionId}/attendance`, {
      method: "PUT",
      body: JSON.stringify({
        requestId: newRequestId(),
        expectedRevision: revisionRef.current,
        assignedRole: "VOLUNTEER",
        present: true,
        createVolunteer: {
          displayName: walkIn.displayName,
          weightLbs: Number(walkIn.weightLbs),
          skill: Number(walkIn.skill),
          roleEligibility: "VOLUNTEER",
        },
      }),
    });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else {
      if (typeof result.revision === "number") revisionRef.current = result.revision;
      setNotice(`${walkIn.displayName} is checked in.`);
      setWalkIn({ displayName: "", weightLbs: "", skill: "3" });
      await reload();
    }
  }

  async function discard() {
    await chainRef.current;
    setBusy(true);
    setError("");
    const result = await api<{ cleared: boolean }>(`/api/sessions/${sessionId}/unpublish`, {
      method: "POST",
      body: JSON.stringify({ requestId: newRequestId(), expectedRevision: revisionRef.current }),
    });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else {
      setNotice("Rundown discarded. Adjust check-in, then generate again.");
      await reload();
    }
  }

  async function generate() {
    await chainRef.current;
    setBusy(true);
    setError("");
    const result = await api<{ published: boolean; solve: { status: string; diagnostics?: { message: string }[]; nextSteps?: string[] } }>(`/api/sessions/${sessionId}/generate`, {
      method: "POST",
      body: JSON.stringify({ requestId: newRequestId(), expectedRevision: revisionRef.current }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      await reload();
      return;
    }
    if (!result.data.published) {
      const solve = result.data.solve;
      const lines = [
        ...(solve.diagnostics?.map((item) => item.message) ?? []),
        ...(solve.nextSteps ?? []),
      ];
      setError(lines.join(" ") || "No complete rundown was published.");
      return;
    }
    router.push(`/sessions/${sessionId}/rundown`);
  }

  return (
    <Shell>
      <h1 className="font-display text-5xl leading-none">Check-in</h1>
      <p className="mt-2 text-[var(--muted)]">{fighters.length} fighters · {volunteers.length} volunteers · revision {revision || "…"}{pending > 0 ? " · saving" : ""}</p>
      <p className="mt-2 text-sm text-[var(--muted)]">Camp fighters start checked in. Uncheck anyone who is absent. Everyone else with weight and skill is on the volunteer list. One role this Saturday.</p>
      <input className="field mt-3" aria-label="Find a person" placeholder="Find a person" value={query} onChange={(event) => setQuery(event.target.value)} />
      {canDiscard ? (
        <div className="card mt-3 grid gap-2">
          <p>A rundown is ready and sparring has not started. Discard it to change who is here, then generate again.</p>
          <button className="tap h-12" type="button" disabled={busy} onClick={() => void discard()} data-testid="discard-rundown">Discard rundown</button>
        </div>
      ) : null}
      {view?.corrupt.length ? <p className="banner mt-3" role="alert">{view.corrupt[0]}</p> : null}
      {error ? <p className="banner mt-3" role="alert">{error}</p> : null}
      {notice ? <p className="banner mt-3" role="status">{notice}</p> : null}
      <section className="mt-5">
        <h2 className="font-display text-3xl">Fighters</h2>
        <p className="text-sm text-[var(--muted)]">{lists.fighters.length} camp fighters with weight and skill</p>
        <ul className="mt-2 grid gap-2">
          {fighterList.map((athlete) => {
            const on = checked.get(athlete.athleteId)?.assignedRole === "FIGHTER";
            return (
              <li key={athlete.athleteId}>
                <label className="card flex min-h-14 items-center gap-3">
                  <input className="h-6 w-6" type="checkbox" data-testid={`check-fighter-${athlete.athleteId}`} checked={on} onChange={(event) => toggle(athlete, "FIGHTER", event.target.checked)} />
                  <span><strong>{athlete.displayName}</strong><span className="block text-sm text-[var(--muted)]">{athlete.weightLbs ?? "—"} lb · skill {athlete.skill ?? "—"}</span></span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="mt-6">
        <h2 className="font-display text-3xl">Volunteers</h2>
        <p className="text-sm text-[var(--muted)]">{lists.volunteers.length} with weight and skill</p>
        <ul className="mt-2 grid gap-2">
          {volunteerList.map((athlete) => {
            const on = checked.get(athlete.athleteId)?.assignedRole === "VOLUNTEER";
            return (
              <li key={athlete.athleteId}>
                <label className="card flex min-h-14 items-center gap-3">
                  <input className="h-6 w-6" type="checkbox" data-testid={`check-volunteer-${athlete.athleteId}`} checked={on} onChange={(event) => toggle(athlete, "VOLUNTEER", event.target.checked)} />
                  <span><strong>{athlete.displayName}</strong><span className="block text-sm text-[var(--muted)]">{athlete.weightLbs ?? "—"} lb · skill {athlete.skill ?? "—"}{athlete.active ? "" : " · not in camp"}</span></span>
                </label>
              </li>
            );
          })}
        </ul>
        <form className="card mt-3 grid gap-2" onSubmit={(event) => void addWalkIn(event)}>
          <h3 className="font-display text-2xl">Walk-in volunteer</h3>
          <input className="field" required aria-label="Walk-in name" placeholder="Name" value={walkIn.displayName} onChange={(event) => setWalkIn({ ...walkIn, displayName: event.target.value })} data-testid="walkin-name" />
          <input className="field" required inputMode="decimal" aria-label="Walk-in weight" placeholder="Pounds" value={walkIn.weightLbs} onChange={(event) => setWalkIn({ ...walkIn, weightLbs: event.target.value })} data-testid="walkin-weight" />
          <input className="field" aria-label="Walk-in skill" value={walkIn.skill} onChange={(event) => setWalkIn({ ...walkIn, skill: event.target.value })} />
          <button className="tap h-12" type="submit" disabled={busy} data-testid="add-volunteer">Add and check in</button>
        </form>
      </section>
      <div className="mt-6 grid gap-2">
        <a className="tap h-12" href={`/sessions/${sessionId}/settings`}>Session limits</a>
        {view?.session.activeGenerationId ? <a className="tap h-12" href={`/sessions/${sessionId}/rundown`}>Open rundown</a> : null}
        <button className="tap tap-gold h-14 text-lg" type="button" disabled={busy || pending > 0 || fighters.length === 0} onClick={() => void generate()} data-testid="generate-rundown">
          {busy ? "Generating…" : pending > 0 ? "Saving check-in…" : "Generate rundown"}
        </button>
      </div>
    </Shell>
  );
}
