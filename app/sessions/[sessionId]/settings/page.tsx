"use client";

import { use, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/common/Shell";
import { NumericField } from "@/components/common/NumericField";
import { api, newRequestId } from "@/components/common/client";
import {
  explainSkillLimits,
  explainWeightLimits,
} from "@/lib/domain/limit-explanations";
import type { MatchupFeasibility } from "@/lib/domain/matchup-feasibility";
import type { MinimumFeasibleLimitsResult } from "@/lib/domain/minimum-feasible-limits";
import { IGNORED_WEIGHT_PCT } from "@/lib/domain/minimum-feasible-limits";
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

type AttendanceRow = {
  athleteId: string;
  displayName: string;
  assignedRole: "FIGHTER" | "VOLUNTEER";
  present: boolean;
  weightLbsSnapshot: number;
  skillSnapshot: number;
};

type TimingDraft = {
  roundMinutes: string;
  restSeconds: string;
};

function snapHalf(value: number, min: number, max: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  return Math.round(clamped * 2) / 2;
}

function snapInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function validateTiming(draft: TimingDraft): string | null {
  return (
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

function presentFighters(rows: AttendanceRow[]) {
  return rows
    .filter((row) => row.present && row.assignedRole === "FIGHTER")
    .map((row) => ({
      displayName: row.displayName,
      weightLbs: row.weightLbsSnapshot,
      skill: row.skillSnapshot,
    }));
}

/** Fingerprint of who is present so we recalc mins when attendance changed before opening this page. */
function attendanceFingerprint(rows: AttendanceRow[]): string {
  return rows
    .filter((row) => row.present)
    .map((row) => `${row.athleteId}:${row.assignedRole}:${row.weightLbsSnapshot}:${row.skillSnapshot}`)
    .sort()
    .join("|");
}

function feasibilityTone(status: MatchupFeasibility["status"]): string {
  if (status === "ok") return "text-[var(--ok)]";
  if (status === "impossible") return "text-[var(--danger)]";
  return "text-[var(--muted)]";
}

function recommendedTone(status: MinimumFeasibleLimitsResult["status"]): string {
  if (status === "ok") return "text-[var(--ok)]";
  if (status === "impossible") return "text-[var(--danger)]";
  return "text-[var(--muted)]";
}

export default function SettingsPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const [revision, setRevision] = useState(0);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [timingDraft, setTimingDraft] = useState<TimingDraft | null>(null);
  const [fighters, setFighters] = useState<{ displayName: string; weightLbs: number; skill: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [feasibility, setFeasibility] = useState<MatchupFeasibility | null>(null);
  const [feasibilityLoading, setFeasibilityLoading] = useState(false);
  const [recommended, setRecommended] = useState<MinimumFeasibleLimitsResult | null>(null);
  const [recommendedLoading, setRecommendedLoading] = useState(false);
  /** Once the coach moves a slider, auto-apply from attendance refresh must not overwrite. */
  const [userEditing, setUserEditing] = useState(false);
  const feasibilitySeq = useRef(0);
  const recommendedSeq = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const limitsRef = useRef<Limits | null>(null);
  const userEditingRef = useRef(false);
  const appliedFingerprintRef = useRef<string | null>(null);

  useEffect(() => {
    limitsRef.current = limits;
  }, [limits]);

  useEffect(() => {
    userEditingRef.current = userEditing;
  }, [userEditing]);

  useEffect(() => {
    let ignore = false;
    void api<{
      session: { revision: number; settings: Settings };
      attendance: AttendanceRow[];
    }>(`/api/sessions/${sessionId}`).then((result) => {
      if (ignore) return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setRevision(result.data.session.revision);
      const saved = result.data.session.settings.limits;
      const nextLimits: Limits = {
        ...saved,
        maxWeightDifferencePctOfLighterAthlete: IGNORED_WEIGHT_PCT,
      };
      setLimits(nextLimits);
      limitsRef.current = nextLimits;
      setTimingDraft({
        roundMinutes: formatNumericDraft(result.data.session.settings.timing.roundMinutes),
        restSeconds: formatNumericDraft(result.data.session.settings.timing.restSeconds),
      });
      const attendance = result.data.attendance ?? [];
      setFighters(presentFighters(attendance));
      void applyRecommendedMinimums({
        fingerprint: attendanceFingerprint(attendance),
        force: true,
        seedLimits: nextLimits,
      });
    });
    return () => {
      ignore = true;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function runFeasibility(nextLimits: Limits) {
    const seq = ++feasibilitySeq.current;
    setFeasibilityLoading(true);
    const result = await api<{ feasibility: MatchupFeasibility }>(`/api/sessions/${sessionId}/feasibility`, {
      method: "POST",
      body: JSON.stringify({
        requestId: newRequestId(),
        limits: { ...nextLimits, maxWeightDifferencePctOfLighterAthlete: IGNORED_WEIGHT_PCT },
      }),
    });
    if (seq !== feasibilitySeq.current) return;
    setFeasibilityLoading(false);
    if (!result.ok) {
      setFeasibility({
        status: "inconclusive",
        message: result.error.message || "Could not check matchup feasibility right now.",
      });
      return;
    }
    setFeasibility(result.data.feasibility);
  }

  function scheduleFeasibility(nextLimits: Limits) {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void runFeasibility(nextLimits);
    }, 280);
  }

  async function applyRecommendedMinimums(args: {
    fingerprint: string;
    force: boolean;
    seedLimits?: Limits;
  }) {
    if (!args.force && userEditingRef.current) return;
    if (!args.force && appliedFingerprintRef.current === args.fingerprint) return;

    const seq = ++recommendedSeq.current;
    setRecommendedLoading(true);
    const result = await api<{ recommended: MinimumFeasibleLimitsResult }>(
      `/api/sessions/${sessionId}/recommended-limits`,
      {
        method: "POST",
        body: JSON.stringify({ requestId: newRequestId() }),
      },
    );
    if (seq !== recommendedSeq.current) return;
    setRecommendedLoading(false);

    if (!result.ok) {
      setRecommended({
        status: "inconclusive",
        message: result.error.message || "Could not calculate minimum limits right now.",
        method: "joint skill-then-lbs",
      });
      const fallback = args.seedLimits ?? limitsRef.current;
      if (fallback) scheduleFeasibility(fallback);
      return;
    }

    const next = result.data.recommended;
    setRecommended(next);
    appliedFingerprintRef.current = args.fingerprint;

    if (next.status === "ok" && (args.force || !userEditingRef.current)) {
      const base = args.seedLimits ?? limitsRef.current;
      if (base) {
        const applied: Limits = {
          ...base,
          maxWeightDifferenceLbs: next.limits.maxWeightDifferenceLbs,
          maxSkillDifference: next.limits.maxSkillDifference,
          maxWeightDifferencePctOfLighterAthlete: IGNORED_WEIGHT_PCT,
        };
        limitsRef.current = applied;
        setLimits(applied);
        setUserEditing(false);
        userEditingRef.current = false;
        scheduleFeasibility(applied);
        return;
      }
    }

    const fallback = args.seedLimits ?? limitsRef.current;
    if (fallback) scheduleFeasibility(fallback);
  }

  function patchLimit<K extends keyof Limits>(key: K, value: Limits[K]) {
    if (!limits) return;
    const next = { ...limits, [key]: value, maxWeightDifferencePctOfLighterAthlete: IGNORED_WEIGHT_PCT };
    limitsRef.current = next;
    setLimits(next);
    setUserEditing(true);
    userEditingRef.current = true;
  }

  function onLimitRelease() {
    if (limitsRef.current) scheduleFeasibility(limitsRef.current);
  }

  function recalculateMinimums() {
    setUserEditing(false);
    userEditingRef.current = false;
    setNotice("");
    // Force recompute for current attendance even if fingerprint matches.
    appliedFingerprintRef.current = null;
    void (async () => {
      const session = await api<{
        session: { revision: number; settings: Settings };
        attendance: AttendanceRow[];
      }>(`/api/sessions/${sessionId}`);
      if (!session.ok) {
        setError(session.error.message);
        return;
      }
      setRevision(session.data.session.revision);
      const attendance = session.data.attendance ?? [];
      setFighters(presentFighters(attendance));
      await applyRecommendedMinimums({
        fingerprint: attendanceFingerprint(attendance),
        force: true,
        seedLimits: limitsRef.current ?? undefined,
      });
    })();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!limits || !timingDraft || saving) return;
    const validationError = validateTiming(timingDraft);
    if (validationError) {
      setError(validationError);
      setNotice("");
      return;
    }
    const settings: Settings = {
      limits: { ...limits, maxWeightDifferencePctOfLighterAthlete: IGNORED_WEIGHT_PCT },
      timing: {
        roundMinutes: parseNumericDraft(timingDraft.roundMinutes)!,
        restSeconds: parseNumericDraft(timingDraft.restSeconds)!,
      },
    };
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

  const weightExplanation = limits ? explainWeightLimits(fighters, limits) : null;
  const skillExplanation = limits ? explainSkillLimits(fighters, limits) : null;

  return (
    <Shell>
      <a className="tap mb-3 inline-flex h-12 min-w-28" href={`/sessions/${sessionId}/attendance`} data-testid="back-to-attendance">
        Back
      </a>
      <h1 className="font-display text-5xl leading-none">Session limits</h1>
      <p className="mt-2 text-[var(--muted)]">Settings for this Saturday session.</p>
      {error ? <p className="banner mt-3" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 text-[var(--ok)]" role="status">{notice}</p> : null}
      {limits && timingDraft ? (
        <form className="mt-5 grid gap-4" onSubmit={(event) => void save(event)} noValidate>
          <fieldset className="card grid gap-5">
            <legend className="font-display text-2xl">Matching</legend>

            <div className="grid gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="max-weight-lbs" className="text-sm text-[var(--muted)]">Max weight difference (lb)</label>
                <p className="font-display text-3xl leading-none tabular-nums" aria-live="polite" data-testid="weight-lbs-value">
                  {limits.maxWeightDifferenceLbs}
                </p>
              </div>
              <input
                id="max-weight-lbs"
                className="limit-slider"
                type="range"
                min={1}
                max={100}
                step={0.5}
                value={limits.maxWeightDifferenceLbs}
                aria-label="Max weight gap pounds"
                onChange={(event) => patchLimit("maxWeightDifferenceLbs", snapHalf(Number(event.target.value), 1, 100))}
                onPointerUp={onLimitRelease}
                onTouchEnd={onLimitRelease}
                onKeyUp={onLimitRelease}
              />
              <p className="text-sm text-[var(--muted)]" data-testid="weight-explanation">
                {weightExplanation?.text ?? "Check fighters in to see a live weight example from the lightest person present."}
              </p>
            </div>

            <div className="grid gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="max-skill-diff" className="text-sm text-[var(--muted)]">Max skill difference (0–6)</label>
                <p className="font-display text-3xl leading-none tabular-nums" aria-live="polite" data-testid="skill-diff-value">
                  {limits.maxSkillDifference}
                </p>
              </div>
              <input
                id="max-skill-diff"
                className="limit-slider"
                type="range"
                min={0}
                max={6}
                step={1}
                value={limits.maxSkillDifference}
                aria-label="Max skill gap"
                onChange={(event) => patchLimit("maxSkillDifference", snapInt(Number(event.target.value), 0, 6))}
                onPointerUp={onLimitRelease}
                onTouchEnd={onLimitRelease}
                onKeyUp={onLimitRelease}
              />
              <p className="text-sm text-[var(--muted)]" data-testid="skill-explanation">
                {skillExplanation?.text ?? "Check fighters in to see a live skill band from the lowest-skill person present."}
              </p>
            </div>

            <div className="grid gap-2" data-testid="auto-minimums">
              <p className="text-sm text-[var(--muted)]">
                Opening this page sets both sliders to the smallest verified pair that still builds a complete schedule
                (joint search: skill 0→6, then minimal lb). Percent-of-lighter is not used.
              </p>
              {recommendedLoading && !recommended ? (
                <p className="text-sm text-[var(--muted)]" role="status">Calculating minimums…</p>
              ) : null}
              {recommended ? (
                <p className={`text-sm ${recommendedTone(recommended.status)}`} role="status" data-testid="recommended-message">
                  {recommendedLoading ? "Calculating minimums… " : null}
                  {recommended.message}
                </p>
              ) : null}
              <button
                className="tap h-12"
                type="button"
                disabled={recommendedLoading}
                data-testid="recalculate-minimums"
                onClick={() => recalculateMinimums()}
              >
                {recommendedLoading ? "Calculating…" : "Recalculate Minimums"}
              </button>
            </div>
          </fieldset>

          <section className="card grid gap-2" aria-labelledby="matchup-feasibility-heading" data-testid="matchup-feasibility">
            <h2 id="matchup-feasibility-heading" className="font-display text-2xl">Matchup feasibility</h2>
            <p className="text-sm text-[var(--muted)]">
              Uses the same scheduling rules as Generate. Suggestions do not save — use Save session settings when you want them.
            </p>
            {feasibilityLoading && !feasibility ? (
              <p className="text-sm text-[var(--muted)]" role="status">Checking schedule…</p>
            ) : null}
            {feasibility ? (
              <p className={`text-sm ${feasibilityTone(feasibility.status)}`} role="status" data-testid="feasibility-message">
                {feasibilityLoading ? "Checking schedule… " : null}
                {feasibility.message}
              </p>
            ) : null}
          </section>

          <fieldset className="card grid gap-3">
            <legend className="font-display text-2xl">Round timing</legend>
            <label>Round duration (minutes)
              <NumericField className="field mt-1" allowDecimal inputMode="decimal" min={1} max={15} step={0.5} required aria-label="Round duration minutes"
                value={timingDraft.roundMinutes}
                onChange={(roundMinutes) => setTimingDraft({ ...timingDraft, roundMinutes })} />
            </label>
            <label>Rest between rounds (seconds)
              <NumericField className="field mt-1" inputMode="numeric" min={0} max={300} step={1} required aria-label="Rest between rounds seconds"
                value={timingDraft.restSeconds}
                onChange={(restSeconds) => setTimingDraft({ ...timingDraft, restSeconds })} />
            </label>
            <p className="text-sm text-[var(--muted)]">The estimated session duration includes rest between blocks, but no rest after the last round. It excludes setup and delays.</p>
          </fieldset>
          <button className="tap tap-gold h-12" type="submit" disabled={saving}>{saving ? "Saving…" : "Save session settings"}</button>
        </form>
      ) : <p className="mt-4">Loading…</p>}
    </Shell>
  );
}
