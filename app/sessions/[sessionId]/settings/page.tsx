"use client";

import { use, useEffect, useState } from "react";
import { Shell } from "@/components/common/Shell";
import { api, newRequestId } from "@/components/common/client";

type Limits = {
  maxWeightDifferenceLbs: number;
  maxWeightDifferencePctOfLighterAthlete: number;
  maxSkillDifference: number;
  maxAggressionDifference: number;
};
type Timing = { roundMinutes: number; restSeconds: number };
type Settings = { limits: Limits; timing: Timing };

export default function SettingsPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const [revision, setRevision] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let ignore = false;
    void api<{ session: { revision: number; settings: Settings } }>(`/api/sessions/${sessionId}`).then((result) => {
      if (ignore) return;
      if (!result.ok) setError(result.error.message);
      else {
        setRevision(result.data.session.revision);
        setSettings(result.data.session.settings);
      }
    });
    return () => { ignore = true; };
  }, [sessionId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    const result = await api(`/api/sessions/${sessionId}/settings`, {
      method: "PUT",
      body: JSON.stringify({
        requestId: newRequestId(),
        expectedRevision: revision,
        limits: settings.limits,
        timing: settings.timing,
      }),
    });
    setSaving(false);
    if (!result.ok) setError(result.error.message);
    else {
      setNotice("Session settings saved.");
      if (typeof result.revision === "number") setRevision(result.revision);
    }
  }

  return (
    <Shell>
      <h1 className="font-display text-5xl leading-none">Session limits</h1>
      <p className="mt-2 text-[var(--muted)]">Settings for this Saturday session.</p>
      {error ? <p className="banner mt-3" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 text-[var(--ok)]" role="status">{notice}</p> : null}
      {settings ? (
        <form className="mt-5 grid gap-4" onSubmit={(event) => void save(event)}>
          <fieldset className="card grid gap-3">
            <legend className="font-display text-2xl">Matching</legend>
            <label>Maximum weight difference (lb)
              <input className="field mt-1" type="number" min={1} max={100} step="0.5" required aria-label="Max weight gap pounds"
                value={settings.limits.maxWeightDifferenceLbs}
                onChange={(event) => setSettings({ ...settings, limits: { ...settings.limits, maxWeightDifferenceLbs: Number(event.target.value) } })} />
            </label>
            <label>Maximum weight difference (% of lighter person)
              <input className="field mt-1" type="number" min={1} max={100} step="0.5" required aria-label="Max weight gap percent"
                value={settings.limits.maxWeightDifferencePctOfLighterAthlete}
                onChange={(event) => setSettings({ ...settings, limits: { ...settings.limits, maxWeightDifferencePctOfLighterAthlete: Number(event.target.value) } })} />
            </label>
            <p className="text-sm text-[var(--muted)]">Both weight limits must pass. For example, 60 lb and 50% means a 120 lb person may be paired with someone at most 60 lb heavier.</p>
            <label>Maximum skill difference
              <input className="field mt-1" type="number" min={0} max={6} step={1} required aria-label="Max skill gap"
                value={settings.limits.maxSkillDifference}
                onChange={(event) => setSettings({ ...settings, limits: { ...settings.limits, maxSkillDifference: Number(event.target.value) } })} />
            </label>
          </fieldset>
          <fieldset className="card grid gap-3">
            <legend className="font-display text-2xl">Round timing</legend>
            <label>Round duration (minutes)
              <input className="field mt-1" type="number" min={1} max={15} step={0.5} required aria-label="Round duration minutes"
                value={settings.timing.roundMinutes}
                onChange={(event) => setSettings({ ...settings, timing: { ...settings.timing, roundMinutes: Number(event.target.value) } })} />
            </label>
            <label>Rest between rounds (seconds)
              <input className="field mt-1" type="number" min={0} max={300} step={1} required aria-label="Rest between rounds seconds"
                value={settings.timing.restSeconds}
                onChange={(event) => setSettings({ ...settings, timing: { ...settings.timing, restSeconds: Number(event.target.value) } })} />
            </label>
            <p className="text-sm text-[var(--muted)]">The estimated session duration includes rest between blocks, but no rest after the last round. It excludes setup and delays.</p>
          </fieldset>
          <button className="tap tap-gold h-12" type="submit" disabled={saving}>{saving ? "Saving…" : "Save session settings"}</button>
        </form>
      ) : <p className="mt-4">Loading…</p>}
    </Shell>
  );
}
