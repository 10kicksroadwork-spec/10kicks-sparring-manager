"use client";

import { use, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/common/Shell";
import { api, locationLabel, newRequestId } from "@/components/common/client";
import { rundownStarted } from "@/lib/domain/rundown";
import { estimateDuration, formatDuration, type RoundTiming } from "@/lib/domain/timing";
import { locationsForFighterCount, type Location } from "@/lib/domain/types";
import {
  formatBlockList,
  otherHardBlocksForVolunteer,
  swapMultiBlockToastMessage,
  volunteersInMultipleHardBlocks,
} from "@/lib/domain/volunteer-load";
import { isHistoricalRundownView, rundownBackHref } from "@/lib/ui/saturday-nav";

function subscribeToUrl(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function fromAttendanceParam(): string | null {
  return new URLSearchParams(window.location.search).get("from");
}

type Assignment = {
  assignmentId: string;
  blockIndex: number;
  location: "MAIN_RING" | "FLOOR_1" | "FLOOR_2";
  fighterId: string;
  volunteerId: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "INTERRUPTED";
  locked: boolean;
};
type SwapOption = { volunteerId: string; displayName: string; current: boolean; reasons: string[] };
type Person = { athleteId: string; displayName: string; assignedRole: "FIGHTER" | "VOLUNTEER"; availabilityStatus: string };
type View = {
  session: { revision: number; status: string; updatedAt: string; activeGenerationId: string; settings: { timing: RoundTiming; hardRoundsPerSession: number } };
  attendance: Person[];
  assignments: Assignment[];
  corrupt: string[];
  swaps?: Record<string, SwapOption[]>;
};

const ALL_LOCATIONS: Location[] = ["MAIN_RING", "FLOOR_1", "FLOOR_2"];

export default function RundownPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [swapChoice, setSwapChoice] = useState<Record<string, string>>({});
  const fromAttendance = useSyncExternalStore(subscribeToUrl, fromAttendanceParam, () => null);

  async function reload() {
    const result = await api<View>(`/api/sessions/${sessionId}`);
    if (!result.ok) setError(result.error.message);
    else {
      setView(result.data);
      const next: Record<string, string> = {};
      for (const [assignmentId, options] of Object.entries(result.data.swaps ?? {})) {
        const current = options.find((row) => row.current) ?? options[0];
        if (current) next[assignmentId] = current.volunteerId;
      }
      setSwapChoice(next);
    }
  }
  useEffect(() => {
    let ignore = false;
    void api<View>(`/api/sessions/${sessionId}`).then((result) => {
      if (ignore) return;
      if (!result.ok) setError(result.error.message);
      else {
        setView(result.data);
        const next: Record<string, string> = {};
        for (const [assignmentId, options] of Object.entries(result.data.swaps ?? {})) {
          const current = options.find((row) => row.current) ?? options[0];
          if (current) next[assignmentId] = current.volunteerId;
        }
        setSwapChoice(next);
      }
    });
    return () => {
      ignore = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const names = new Map(view?.attendance.map((row) => [row.athleteId, row.displayName]) ?? []);
  const name = (id: string) => names.get(id) ?? "Unknown";
  const revision = view?.session.revision ?? 0;
  const blocks = [...new Set(view?.assignments.map((row) => row.blockIndex) ?? [])].sort((a, b) => a - b);
  const maxBlock = blocks.at(-1) ?? 0;
  const duration = view && maxBlock > 0 ? estimateDuration(maxBlock, view.session.settings.hardRoundsPerSession, view.session.settings.timing) : null;
  const fighterCount = (view?.attendance ?? []).filter((person) => person.assignedRole === "FIGHTER" && person.availabilityStatus === "AVAILABLE").length;
  const usedLocations = new Set(view?.assignments.map((row) => row.location) ?? []);
  const columns = ALL_LOCATIONS.filter((location) => locationsForFighterCount(fighterCount).includes(location) || usedLocations.has(location));
  const readOnly = isHistoricalRundownView({
    sessionStatus: view?.session.status,
    fromAttendanceSessionId: fromAttendance,
  });
  const canDiscard = !readOnly && Boolean(view?.session.activeGenerationId) && !rundownStarted(view?.session.status ?? "", view?.assignments ?? []);
  const backHref = rundownBackHref(sessionId, fromAttendance);
  const multiBlockVolunteers = volunteersInMultipleHardBlocks(view?.assignments ?? [], names);

  async function act(path: string, body: Record<string, unknown>, method = "POST") {
    if (readOnly) return;
    setBusy(true);
    setError("");
    const result = await api(path, { method, body: JSON.stringify({ requestId: newRequestId(), expectedRevision: revision, ...body }) });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else setNotice("Saved.");
    await reload();
  }

  async function swapVolunteer(match: Assignment) {
    if (readOnly) return;
    const volunteerId = swapChoice[match.assignmentId];
    if (!volunteerId || volunteerId === match.volunteerId) {
      setError("Pick a different eligible volunteer for this match.");
      return;
    }
    const volunteerName = name(volunteerId);
    const otherBlocks = otherHardBlocksForVolunteer(view?.assignments ?? [], volunteerId, match.assignmentId);
    setBusy(true);
    setError("");
    setNotice("");
    setToast("");
    const result = await api(`/api/sessions/${sessionId}/assignments/${match.assignmentId}`, {
      method: "PATCH",
      body: JSON.stringify({
        requestId: newRequestId(),
        expectedRevision: revision,
        action: "set-volunteer",
        volunteerId,
      }),
    });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else {
      setNotice(`Partner updated for ${name(match.fighterId)}.`);
      const multiBlockToast = swapMultiBlockToastMessage(volunteerName, otherBlocks);
      if (multiBlockToast) setToast(multiBlockToast);
    }
    await reload();
  }

  async function discard() {
    if (readOnly) return;
    setBusy(true);
    setError("");
    const result = await api<{ cleared: boolean }>(`/api/sessions/${sessionId}/unpublish`, {
      method: "POST",
      body: JSON.stringify({ requestId: newRequestId(), expectedRevision: revision }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      await reload();
      return;
    }
    router.push(`/sessions/${sessionId}/attendance`);
  }

  async function regenerate() {
    if (readOnly) return;
    setBusy(true);
    setError("");
    const result = await api<{ published: boolean; solve: { diagnostics?: { message: string }[]; nextSteps?: string[] } }>(`/api/sessions/${sessionId}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ requestId: newRequestId(), expectedRevision: revision }),
    });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else if (!result.data.published) {
      const lines = [...(result.data.solve.diagnostics?.map((item) => item.message) ?? []), ...(result.data.solve.nextSteps ?? [])];
      setError(lines.join(" ") || "The remaining rundown could not be rebuilt.");
    } else setNotice("Remaining matches rebuilt. Completed and locked matches stayed.");
    await reload();
  }

  return (
    <Shell>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-5xl leading-none">{readOnly ? "Previous schedule" : "Rundown"}</h1>
          <p className="mt-2 text-[var(--muted)]">Revision {revision} · {view?.session.status ?? "…"} · {view?.session.updatedAt?.slice(11, 16) ?? ""}{readOnly ? " · read-only" : ""}</p>
        </div>
        <a className="tap" href={`/sessions/${sessionId}/print`}>Print</a>
      </div>
      {error ? <p className="banner mt-3" role="alert">{error}</p> : null}
      {notice ? <p className="banner mt-3" role="status">{notice}</p> : null}
      {toast ? (
        <p className="toast" role="status" data-testid="swap-multi-block-toast">
          {toast}
        </p>
      ) : null}
      {view?.corrupt.length ? <p className="banner mt-3" role="alert">{view.corrupt[0]}</p> : null}
      {!view?.session.activeGenerationId ? <p className="mt-4">No rundown yet. <a className="underline" href={backHref}>Back to check-in</a></p> : null}
      {duration ? (
        <p className="mt-4 text-base" data-testid="session-duration">
          <strong>Estimated time: {formatDuration(duration.totalSeconds)}</strong>
          <span className="block text-sm text-[var(--muted)]">{duration.blockCount} blocks · {duration.roundCount} rounds · {view?.session.settings.timing.roundMinutes} min rounds · {view?.session.settings.timing.restSeconds} sec rest</span>
        </p>
      ) : null}
      {!readOnly && multiBlockVolunteers.length > 0 ? (
        <section className="card card-warn mt-4" data-testid="multi-volunteer-warning" aria-label="Volunteers in multiple blocks">
          <h2 className="font-display text-2xl text-[var(--gold)]">Volunteers in more than one block</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Fair warning when the pool is thin — these partners already appear in multiple hard assignments on this rundown.
          </p>
          <ul className="mt-3 grid gap-2">
            {multiBlockVolunteers.map((row) => (
              <li key={row.volunteerId} data-testid={`multi-volunteer-${row.volunteerId}`}>
                <strong>{row.displayName}</strong>
                <span className="mt-0.5 block text-sm text-[var(--muted)]">{formatBlockList(row.blocks)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="mt-4 grid gap-4">
        {blocks.map((block) => {
          const rows = view?.assignments.filter((row) => row.blockIndex === block) ?? [];
          const busyIds = new Set(rows.flatMap((row) => [row.fighterId, row.volunteerId]));
          const resting = view?.attendance.filter((person) => person.assignedRole === "FIGHTER" && person.availabilityStatus === "AVAILABLE" && !busyIds.has(person.athleteId)) ?? [];
          const blockComplete =
            rows.length > 0 &&
            rows.some((row) => row.status === "COMPLETED") &&
            rows.every((row) => row.status === "COMPLETED" || row.status === "INTERRUPTED");
          return (
            <section
              key={block}
              className={blockComplete ? "card card-complete" : "card"}
              data-testid={`block-${block}`}
              data-complete={blockComplete ? "true" : "false"}
              aria-label={blockComplete ? `Block ${block}, Completed` : `Block ${block}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-3xl">Block {block}</h2>
                {blockComplete ? (
                  <span className="block-complete-label" data-testid={`block-complete-label-${block}`}>Completed</span>
                ) : !readOnly ? (
                  <button className="tap" type="button" disabled={busy} data-testid={`complete-block-${block}`} onClick={() => void act(`/api/sessions/${sessionId}/blocks/${block}/complete`, { confirmBothRounds: true })}>Mark block complete</button>
                ) : null}
              </div>
              <div className="mt-3 grid gap-2">
                {columns.map((location) => {
                  const match = rows.find((row) => row.location === location);
                  const options = match ? view?.swaps?.[match.assignmentId] ?? [] : [];
                  const canSwap = Boolean(!readOnly && match && !match.locked && match.status === "PLANNED");
                  return (
                    <article key={location} className="rounded-xl border border-[var(--line)] p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--gold)]">{locationLabel(location)}</p>
                      {match ? (
                        <>
                          <p className="text-lg"><span data-testid={`match-${match.assignmentId}`}>{name(match.fighterId)} / {name(match.volunteerId)}</span></p>
                          <p className="text-sm text-[var(--muted)]">{match.status === "COMPLETED" ? "Completed · both rounds" : match.status === "INTERRUPTED" ? "Interrupted · not a full session" : "Hard · 2 rounds"}{match.locked ? " · Locked" : ""}</p>
                          {!readOnly ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button className="tap" type="button" disabled={busy} data-testid={`lock-${match.assignmentId}`} onClick={() => void act(`/api/sessions/${sessionId}/assignments/${match.assignmentId}`, { action: match.locked ? "unlock" : "lock" }, "PATCH")}>{match.locked ? "Unlock match" : "Lock match"}</button>
                            </div>
                          ) : null}
                          {canSwap ? (
                            <div className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3" data-testid={`swap-${match.assignmentId}`}>
                              <label className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]" htmlFor={`swap-select-${match.assignmentId}`}>
                                Eligible partner
                              </label>
                              <select
                                id={`swap-select-${match.assignmentId}`}
                                className="field"
                                data-testid={`swap-select-${match.assignmentId}`}
                                disabled={busy || options.length === 0}
                                value={swapChoice[match.assignmentId] ?? match.volunteerId}
                                onChange={(event) => setSwapChoice((prev) => ({ ...prev, [match.assignmentId]: event.target.value }))}
                              >
                                {options.map((option) => (
                                  <option key={option.volunteerId} value={option.volunteerId}>
                                    {option.displayName}{option.current ? " (current)" : ""}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="tap"
                                type="button"
                                disabled={busy || !swapChoice[match.assignmentId] || swapChoice[match.assignmentId] === match.volunteerId}
                                data-testid={`swap-apply-${match.assignmentId}`}
                                onClick={() => void swapVolunteer(match)}
                              >
                                Swap partner
                              </button>
                              <p className="text-xs text-[var(--muted)]">
                                Only volunteers who still fit limits, rest, and workload for this card. Free someone from another match first if you need them here.
                              </p>
                            </div>
                          ) : null}
                        </>
                      ) : <p>Open</p>}
                    </article>
                  );
                })}
              </div>
              <p className="mt-3 text-sm text-[var(--muted)]">Light / recovery — no partner assigned: {resting.map((person) => person.displayName).join(", ") || "none"}</p>
            </section>
          );
        })}
      </div>
      <section className="mt-6">
        <h2 className="font-display text-3xl">Fighter rotations</h2>
        <ul className="mt-2 grid gap-2">
          {(view?.attendance ?? []).filter((person) => person.assignedRole === "FIGHTER").map((fighter) => {
            const mine = (view?.assignments ?? []).filter((row) => row.fighterId === fighter.athleteId).sort((a, b) => a.blockIndex - b.blockIndex);
            const pieces: string[] = [];
            for (let block = 1; block <= maxBlock; block += 1) {
              const match = mine.find((row) => row.blockIndex === block);
              pieces.push(match ? `Block ${block} ${locationLabel(match.location)} (hard)` : `Block ${block} light/recovery`);
            }
            return <li key={fighter.athleteId} className="card"><strong>{fighter.displayName}</strong><span className="mt-1 block text-sm text-[var(--muted)]">{pieces.join(" → ")}</span></li>;
          })}
        </ul>
      </section>
      <div className="mt-6 grid gap-2">
        {canDiscard ? <button className="tap tap-gold h-14" type="button" disabled={busy} data-testid="discard-rundown" onClick={() => void discard()}>Discard rundown and return to check-in</button> : null}
        {!readOnly ? <button className="tap h-14" type="button" disabled={busy} data-testid="regenerate" onClick={() => void regenerate()}>Regenerate unfinished</button> : null}
        {!readOnly ? <button className="tap h-12" type="button" disabled={busy} onClick={() => void act(`/api/sessions/${sessionId}/undo`, {})}>Undo last rundown</button> : null}
        <a className="tap h-12" href={backHref} data-testid="back-from-rundown">Back to check-in</a>
      </div>
    </Shell>
  );
}
