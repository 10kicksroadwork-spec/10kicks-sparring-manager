"use client";

import { use, useEffect, useState } from "react";
import { Shell } from "@/components/common/Shell";
import { NumericField } from "@/components/common/NumericField";
import { api, newRequestId } from "@/components/common/client";
import {
  formatNumericDraft,
  parseNumericDraft,
  validateRequiredNumericDraft,
} from "@/lib/ui/numeric-draft";

type Limits = {
  maxWeightDifferenceLbs: number;
  maxWeightDifferencePctOfLighterAthlete: number;
  maxSkillDifference: number;
  maxAggressionDifference: number;
};
type Timing = { roundMinutes: number; restSeconds: number };
type Settings = { limits: Limits; timing: Timing };

type SettingsDraft = {
  maxWeightDifferenceLbs: string;
  maxWeightDifferencePctOfLighterAthlete: string;
  maxSkillDifference: string;
  maxAggressionDifference: number;
  roundMinutes: string;
  restSeconds: string;
};

function toDraft(settings: Settings): SettingsDraft {
  return {
    maxWeightDifferenceLbs: formatNumericDraft(settings.limits.maxWeightDifferenceLbs),
    maxWeightDifferencePctOfLighterAthlete: formatNumericDraft(settings.limits.maxWeightDifferencePctOfLighterAthlete),
    maxSkillDifference: formatNumericDraft(settings.limits.maxSkillDifference),
    maxAggressionDifference: settings.limits.maxAggressionDifference,
    roundMinutes: formatNumericDraft(settings.timing.roundMinutes),
    restSeconds: formatNumericDraft(settings.timing.restSeconds),
  };
}

function validateDraft(draft: SettingsDraft): string | null {
  return (
    validateRequiredNumericDraft({
      label: "a maximum weight difference in pounds",
      draft: draft.maxWeightDifferenceLbs,
      min: 1,
      max: 100,
    }) ??
    validateRequiredNumericDraft({
      label: "a maximum weight difference percent",
      draft: draft.maxWeightDifferencePctOfLighterAthlete,
      min: 1,
      max: 100,
    }) ??
    validateRequiredNumericDraft({
      label: "a maximum skill difference",
      draft: draft.maxSkillDifference,
      min: 0,
      max: 6,
      integer: true,
    }) ??
    validateRequiredNumericDraft({
      label: "a round duration in minutes",
      draft: draft.roundMinutes,
      min: 1,
      max: 15,
      halfMinuteStep: true,
    }) ??
    validateRequiredNumericDraft({
      label: "rest between rounds in seconds",
      draft: draft.restSeconds,
      min: 0,
      max: 300,
      integer: true,
    })
  );
}

function draftToSettings(draft: SettingsDraft): Settings {
  return {
    limits: {
      maxWeightDifferenceLbs: parseNumericDraft(draft.maxWeightDifferenceLbs)!,
      maxWeightDifferencePctOfLighterAthlete: parseNumericDraft(draft.maxWeightDifferencePctOfLighterAthlete)!,
      maxSkillDifference: parseNumericDraft(draft.maxSkillDifference)!,
      maxAggressionDifference: draft.maxAggressionDifference,
    },
    timing: {
      roundMinutes: parseNumericDraft(draft.roundMinutes)!,
      restSeconds: parseNumericDraft(draft.restSeconds)!,
    },
  };
}

export default function SettingsPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
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
        setDraft(toDraft(result.data.session.settings));
      }
    });
    return () => { ignore = true; };
  }, [sessionId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;
    const validationError = validateDraft(draft);
    if (validationError) {
      setError(validationError);
      setNotice("");
      return;
    }
    const settings = draftToSettings(draft);
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
      <a className="tap mb-3 inline-flex h-12 min-w-28" href={`/sessions/${sessionId}/attendance`} data-testid="back-to-attendance">
        Back
      </a>
      <h1 className="font-display text-5xl leading-none">Session limits</h1>
      <p className="mt-2 text-[var(--muted)]">Settings for this Saturday session.</p>
      {error ? <p className="banner mt-3" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 text-[var(--ok)]" role="status">{notice}</p> : null}
      {draft ? (
        <form className="mt-5 grid gap-4" onSubmit={(event) => void save(event)} noValidate>
          <fieldset className="card grid gap-3">
            <legend className="font-display text-2xl">Matching</legend>
            <label>Maximum weight difference (lb)
              <NumericField className="field mt-1" allowDecimal inputMode="decimal" min={1} max={100} step="0.5" required aria-label="Max weight gap pounds"
                value={draft.maxWeightDifferenceLbs}
                onChange={(maxWeightDifferenceLbs) => setDraft({ ...draft, maxWeightDifferenceLbs })} />
            </label>
            <label>Maximum weight difference (% of lighter person)
              <NumericField className="field mt-1" allowDecimal inputMode="decimal" min={1} max={100} step="0.5" required aria-label="Max weight gap percent"
                value={draft.maxWeightDifferencePctOfLighterAthlete}
                onChange={(maxWeightDifferencePctOfLighterAthlete) => setDraft({ ...draft, maxWeightDifferencePctOfLighterAthlete })} />
            </label>
            <p className="text-sm text-[var(--muted)]">Both weight limits must pass. For example, 60 lb and 50% means a 120 lb person may be paired with someone at most 60 lb heavier.</p>
            <label>Maximum skill difference
              <NumericField className="field mt-1" inputMode="numeric" min={0} max={6} step={1} required aria-label="Max skill gap"
                value={draft.maxSkillDifference}
                onChange={(maxSkillDifference) => setDraft({ ...draft, maxSkillDifference })} />
            </label>
          </fieldset>
          <fieldset className="card grid gap-3">
            <legend className="font-display text-2xl">Round timing</legend>
            <label>Round duration (minutes)
              <NumericField className="field mt-1" allowDecimal inputMode="decimal" min={1} max={15} step={0.5} required aria-label="Round duration minutes"
                value={draft.roundMinutes}
                onChange={(roundMinutes) => setDraft({ ...draft, roundMinutes })} />
            </label>
            <label>Rest between rounds (seconds)
              <NumericField className="field mt-1" inputMode="numeric" min={0} max={300} step={1} required aria-label="Rest between rounds seconds"
                value={draft.restSeconds}
                onChange={(restSeconds) => setDraft({ ...draft, restSeconds })} />
            </label>
            <p className="text-sm text-[var(--muted)]">The estimated session duration includes rest between blocks, but no rest after the last round. It excludes setup and delays.</p>
          </fieldset>
          <button className="tap tap-gold h-12" type="submit" disabled={saving}>{saving ? "Saving…" : "Save session settings"}</button>
        </form>
      ) : <p className="mt-4">Loading…</p>}
    </Shell>
  );
}
