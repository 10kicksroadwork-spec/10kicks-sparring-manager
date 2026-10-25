"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/common/Shell";
import { api, newRequestId } from "@/components/common/client";

type Athlete = { athleteId: string; displayName: string; weightLbs: number; skill: number; aggression: number; roleEligibility: string; active: boolean };
type Attendance = { athleteId: string; displayName: string; assignedRole: "FIGHTER" | "VOLUNTEER"; present: boolean; availabilityStatus: string; weightLbsSnapshot: number; skillSnapshot: number; aggressionSnapshot: number };
type SessionPayload = { session: { sessionId: string; revision: number; settings: { limitsNotice: string } }; attendance: Attendance[]; corrupt: string[] };

export default function AttendancePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const router = useRouter();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [view, setView] = useState<SessionPayload | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [walkIn, setWalkIn] = useState({ displayName: "", weightLbs: "", skill: "3", aggression: "3" });

  async function reload() {
    const [roster, session] = await Promise.all([
      api<{ athletes: Athlete[] }>("/api/athletes"),
      api<SessionPayload>(`/api/sessions/${sessionId}`),
    ]);
    if (!roster.ok) setError(roster.error.message);
    else setAthletes(roster.data.athletes.filter((athlete) => athlete.active));
    if (!session.ok) setError(session.error.message);
    else setView(session.data);
  }

  useEffect(() => {
    let ignore = false;
    void Promise.all([
      api<{ athletes: Athlete[] }>("/api/athletes"),
      api<SessionPayload>(`/api/sessions/${sessionId}`),
    ]).then(([roster, session]) => {
      if (ignore) return;
      if (!roster.ok) setError(roster.error.message);
      else setAthletes(roster.data.athletes.filter((athlete) => athlete.active));
      if (!session.ok) setError(session.error.message);
      else setView(session.data);
    });
    return () => {
      ignore = true;
    };
  }, [sessionId]);

  const revision = view?.session.revision ?? 0;
  const checked = new Map(view?.attendance.filter((row) => row.present && row.availabilityStatus === "AVAILABLE").map((row) => [row.athleteId, row]));
  const fighters = [...checked.values()].filter((row) => row.assignedRole === "FIGHTER");
  const volunteers = [...checked.values()].filter((row) => row.assignedRole === "VOLUNTEER");
  const incomplete = [...checked.values()].filter((row) => !(row.weightLbsSnapshot > 0) || row.skillSnapshot < 1 || row.aggressionSnapshot < 1);

  async function toggle(athlete: Athlete, role: "FIGHTER" | "VOLUNTEER", present: boolean) {
    setError("");
    const result = await api(`/api/sessions/${sessionId}/attendance`, {
      method: "PUT",
      body: JSON.stringify({
        requestId: newRequestId(),
        expectedRevision: revision,
        athleteId: athlete.athleteId,
        assignedRole: role,
        present,
        availabilityStatus: present ? "AVAILABLE" : "REMOVED",
        weightLbs: athlete.weightLbs,
        skill: athlete.skill,
        aggression: athlete.aggression,
      }),
    });
    if (!result.ok) setError(result.error.message);
    await reload();
  }

  async function addWalkIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await api(`/api/sessions/${sessionId}/attendance`, {
      method: "PUT",
      body: JSON.stringify({
        requestId: newRequestId(),
        expectedRevision: revision,
        assignedRole: "VOLUNTEER",
        present: true,
        createVolunteer: {
          displayName: walkIn.displayName,
          weightLbs: Number(walkIn.weightLbs),
          skill: Number(walkIn.skill),
          aggression: Number(walkIn.aggression),
          roleEligibility: "VOLUNTEER",
        },
      }),
    });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else {
      setNotice(`${walkIn.displayName} is checked in.`);
      setWalkIn({ displayName: "", weightLbs: "", skill: "3", aggression: "3" });
      await reload();
    }
  }

  async function generate() {
    setBusy(true);
    setError("");
    const result = await api<{ published: boolean; solve: { status: string; diagnostics?: { message: string }[]; nextSteps?: string[] } }>(`/api/sessions/${sessionId}/generate`, {
      method: "POST",
      body: JSON.stringify({ requestId: newRequestId(), expectedRevision: revision }),
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
      <p className="mt-2 text-[var(--muted)]">{fighters.length} fighters · {volunteers.length} volunteers · revision {revision || "…"}</p>
      {view?.session.settings.limitsNotice ? <p className="mt-3 text-sm text-[var(--muted)]">{view.session.settings.limitsNotice}</p> : null}
      {incomplete.length ? <p className="banner mt-3" role="status">Finish ratings before generating: {incomplete.map((row) => row.displayName).join(", ")}</p> : null}
      {view?.corrupt.length ? <p className="banner mt-3" role="alert">{view.corrupt[0]}</p> : null}
      {error ? <p className="banner mt-3" role="alert">{error}</p> : null}
      {notice ? <p className="banner mt-3" role="status">{notice}</p> : null}
      <section className="mt-5">
        <h2 className="font-display text-3xl">Fighters</h2>
        <ul className="mt-2 grid gap-2">
          {athletes.filter((athlete) => athlete.roleEligibility !== "VOLUNTEER").map((athlete) => {
            const on = checked.get(athlete.athleteId)?.assignedRole === "FIGHTER";
            return (
              <li key={athlete.athleteId}>
                <label className="card flex min-h-14 items-center gap-3">
                  <input className="h-6 w-6" type="checkbox" data-testid={`check-fighter-${athlete.athleteId}`} checked={on} onChange={(event) => void toggle(athlete, "FIGHTER", event.target.checked)} />
                  <span><strong>{athlete.displayName}</strong><span className="block text-sm text-[var(--muted)]">{athlete.weightLbs} lb · skill {athlete.skill} · agl {athlete.aggression}</span></span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="mt-6">
        <h2 className="font-display text-3xl">Volunteers</h2>
        <ul className="mt-2 grid gap-2">
          {athletes.filter((athlete) => athlete.roleEligibility !== "FIGHTER").map((athlete) => {
            const on = checked.get(athlete.athleteId)?.assignedRole === "VOLUNTEER";
            return (
              <li key={athlete.athleteId}>
                <label className="card flex min-h-14 items-center gap-3">
                  <input className="h-6 w-6" type="checkbox" data-testid={`check-volunteer-${athlete.athleteId}`} checked={on} onChange={(event) => void toggle(athlete, "VOLUNTEER", event.target.checked)} />
                  <span><strong>{athlete.displayName}</strong><span className="block text-sm text-[var(--muted)]">{athlete.weightLbs} lb · skill {athlete.skill} · agl {athlete.aggression}</span></span>
                </label>
              </li>
            );
          })}
        </ul>
        <form className="card mt-3 grid gap-2" onSubmit={(event) => void addWalkIn(event)}>
          <h3 className="font-display text-2xl">Walk-in volunteer</h3>
          <input className="field" required aria-label="Walk-in name" placeholder="Name" value={walkIn.displayName} onChange={(event) => setWalkIn({ ...walkIn, displayName: event.target.value })} data-testid="walkin-name" />
          <input className="field" required inputMode="decimal" aria-label="Walk-in weight" placeholder="Pounds" value={walkIn.weightLbs} onChange={(event) => setWalkIn({ ...walkIn, weightLbs: event.target.value })} data-testid="walkin-weight" />
          <div className="grid grid-cols-2 gap-2">
            <input className="field" aria-label="Walk-in skill" value={walkIn.skill} onChange={(event) => setWalkIn({ ...walkIn, skill: event.target.value })} />
            <input className="field" aria-label="Walk-in aggression" value={walkIn.aggression} onChange={(event) => setWalkIn({ ...walkIn, aggression: event.target.value })} />
          </div>
          <button className="tap h-12" type="submit" disabled={busy} data-testid="add-volunteer">Add and check in</button>
        </form>
      </section>
      <div className="mt-6 grid gap-2">
        <a className="tap h-12" href={`/sessions/${sessionId}/settings`}>Session limits</a>
        <button className="tap tap-gold h-14 text-lg" type="button" disabled={busy || fighters.length === 0} onClick={() => void generate()} data-testid="generate-rundown">
          {busy ? "Generating…" : "Generate rundown"}
        </button>
      </div>
    </Shell>
  );
}
