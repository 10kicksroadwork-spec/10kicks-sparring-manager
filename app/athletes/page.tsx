"use client";

import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/common/Shell";
import { api, newRequestId } from "@/components/common/client";

type Athlete = {
  athleteId: string;
  displayName: string;
  weightLbs: number;
  skill: number;
  aggression: number;
  roleEligibility: "FIGHTER" | "VOLUNTEER" | "BOTH";
  active: boolean;
  coachNotes: string;
};

export default function AthletesPage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ displayName: "", weightLbs: "", skill: "3", aggression: "3", roleEligibility: "BOTH", coachNotes: "" });

  async function reload() {
    const result = await api<{ athletes: Athlete[]; corrupt: string[] }>("/api/athletes");
    if (!result.ok) setError(result.error.message);
    else {
      setAthletes(result.data.athletes);
      if (result.data.corrupt.length) setError(result.data.corrupt[0]);
    }
  }

  useEffect(() => {
    let ignore = false;
    void api<{ athletes: Athlete[]; corrupt: string[] }>("/api/athletes").then((result) => {
      if (ignore) return;
      if (!result.ok) setError(result.error.message);
      else {
        setAthletes(result.data.athletes);
        if (result.data.corrupt.length) setError(result.data.corrupt[0]);
      }
    });
    return () => {
      ignore = true;
    };
  }, []);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return athletes.filter((athlete) => !needle || athlete.displayName.toLowerCase().includes(needle));
  }, [athletes, query]);

  async function addAthlete(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const result = await api<{ athlete: Athlete }>("/api/athletes", {
      method: "POST",
      body: JSON.stringify({
        requestId: newRequestId(),
        displayName: form.displayName,
        weightLbs: Number(form.weightLbs),
        skill: Number(form.skill),
        aggression: Number(form.aggression),
        roleEligibility: form.roleEligibility,
        coachNotes: form.coachNotes,
      }),
    });
    if (!result.ok) setError(result.error.message);
    else {
      setNotice(`${result.data.athlete.displayName} saved.`);
      setForm({ ...form, displayName: "", weightLbs: "", coachNotes: "" });
      await reload();
    }
  }

  return (
    <Shell>
      <h1 className="font-display text-5xl leading-none">Roster</h1>
      <p className="mt-2 text-[var(--muted)]">Names are labels. Weight, skill, and aggression are the match inputs. Skip medical notes.</p>
      <label className="mt-4 block">
        <span className="sr-only">Search athletes</span>
        <input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search athletes" />
      </label>
      {error ? <p className="banner mt-3" role="alert">{error}</p> : null}
      {notice ? <p className="banner mt-3" role="status">{notice}</p> : null}
      <ul className="mt-4 grid gap-2">
        {shown.map((athlete) => (
          <li key={athlete.athleteId} className="card">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xl font-semibold">{athlete.displayName}</h2>
              <span className="text-sm text-[var(--muted)]">{athlete.active ? athlete.roleEligibility : "Inactive"}</span>
            </div>
            <p className="mt-1 text-[var(--muted)]">{athlete.weightLbs} lb · skill {athlete.skill} · aggression {athlete.aggression}</p>
            {athlete.coachNotes ? <p className="mt-1 text-sm">{athlete.coachNotes}</p> : null}
          </li>
        ))}
      </ul>
      <form className="card mt-6 grid gap-3" onSubmit={(event) => void addAthlete(event)}>
        <h2 className="font-display text-3xl">Add athlete</h2>
        <input className="field" required aria-label="Name" placeholder="Name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
        <input className="field" required inputMode="decimal" aria-label="Weight in pounds" placeholder="Weight (lb)" value={form.weightLbs} onChange={(event) => setForm({ ...form, weightLbs: event.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <label>Skill
            <input className="field" aria-label="Skill" inputMode="numeric" value={form.skill} onChange={(event) => setForm({ ...form, skill: event.target.value })} />
          </label>
          <label>Aggression
            <input className="field" aria-label="Aggression" inputMode="numeric" value={form.aggression} onChange={(event) => setForm({ ...form, aggression: event.target.value })} />
          </label>
        </div>
        <label>Role
          <select className="field" aria-label="Role eligibility" value={form.roleEligibility} onChange={(event) => setForm({ ...form, roleEligibility: event.target.value })}>
            <option value="BOTH">Fighter or volunteer</option>
            <option value="FIGHTER">Fighter</option>
            <option value="VOLUNTEER">Volunteer</option>
          </select>
        </label>
        <input className="field" aria-label="Optional non-medical note" placeholder="Optional non-medical note" value={form.coachNotes} onChange={(event) => setForm({ ...form, coachNotes: event.target.value })} />
        <button className="tap tap-gold h-12" type="submit">Save athlete</button>
      </form>
    </Shell>
  );
}
