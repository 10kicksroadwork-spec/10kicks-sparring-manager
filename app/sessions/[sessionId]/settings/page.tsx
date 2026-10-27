"use client";

import { use, useEffect, useState } from "react";
import { Shell } from "@/components/common/Shell";
import { api, newRequestId } from "@/components/common/client";
import { PROPOSED_LIMITS_NOTICE } from "@/lib/domain/types";

type Limits = { maxWeightDifferenceLbs: number; maxWeightDifferencePctOfLighterAthlete: number; maxSkillDifference: number; maxAggressionDifference: number };

export default function SettingsPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const [revision, setRevision] = useState(0);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void api<{ session: { revision: number; settings: { limits: Limits; limitsNotice: string } } }>(`/api/sessions/${sessionId}`).then((result) => {
      if (!result.ok) setError(result.error.message);
      else {
        setRevision(result.data.session.revision);
        setLimits(result.data.session.settings.limits);
        setNotice(result.data.session.settings.limitsNotice);
      }
    });
  }, [sessionId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!limits) return;
    const result = await api<{ notice: string }>(`/api/sessions/${sessionId}/settings`, {
      method: "PUT",
      body: JSON.stringify({ requestId: newRequestId(), expectedRevision: revision, confirmLimitsChange: confirm, limits }),
    });
    if (!result.ok) setError(result.error.message);
    else {
      setNotice(result.data.notice);
      setError("");
      if (result.revision) setRevision(result.revision);
    }
  }

  return (
    <Shell>
      <h1 className="font-display text-5xl leading-none">Saturday limits</h1>
      <p className="banner mt-4">{notice || PROPOSED_LIMITS_NOTICE}</p>
      <p className="mt-3 text-sm text-[var(--muted)]">Weight and skill limits apply together. A close score never overrides a limit. Named exclusions cannot be waived here. Aggression is not used.</p>
      {error ? <p className="banner mt-3" role="alert">{error}</p> : null}
      {limits ? (
        <form className="mt-4 grid gap-3" onSubmit={(event) => void save(event)}>
          <label>Max weight gap (lb)
            <input className="field" aria-label="Max weight gap pounds" inputMode="decimal" value={limits.maxWeightDifferenceLbs} onChange={(event) => setLimits({ ...limits, maxWeightDifferenceLbs: Number(event.target.value) })} />
          </label>
          <label>Max weight gap (% of lighter athlete)
            <input className="field" aria-label="Max weight gap percent" inputMode="decimal" value={limits.maxWeightDifferencePctOfLighterAthlete} onChange={(event) => setLimits({ ...limits, maxWeightDifferencePctOfLighterAthlete: Number(event.target.value) })} />
          </label>
          <label>Max skill gap
            <input className="field" aria-label="Max skill gap" inputMode="numeric" value={limits.maxSkillDifference} onChange={(event) => setLimits({ ...limits, maxSkillDifference: Number(event.target.value) })} />
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
            I am changing these limits on purpose. They are not safety-certified.
          </label>
          <button className="tap tap-gold h-12" type="submit">Save limits</button>
        </form>
      ) : <p>Loading…</p>}
    </Shell>
  );
}
