"use client";

import { use, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/common/Shell";
import { api, locationLabel, newRequestId } from "@/components/common/client";
import { rundownStarted } from "@/lib/domain/rundown";
import { estimateDuration, formatDuration, type RoundTiming } from "@/lib/domain/timing";
import { locationsForFighterCount, type Location } from "@/lib/domain/types";
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
type Person = { athleteId: string; displayName: string; assignedRole: "FIGHTER" | "VOLUNTEER"; availabilityStatus: string };
type View = {
  session: { revision: number; status: string; updatedAt: string; activeGenerationId: string; settings: { timing: RoundTiming; hardRoundsPerSession: number } };
  attendance: Person[];
  assignments: Assignment[];
  corrupt: string[];
};

const ALL_LOCATIONS: Location[] = ["MAIN_RING", "FLOOR_1", "FLOOR_2"];

export default function RundownPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const fromAttendance = useSyncExternalStore(subscribeToUrl, fromAttendanceParam, () => null);

  async function reload() {
    const result = await api<View>(`/api/sessions/${sessionId}`);
    if (!result.ok) setError(result.error.message);
    else setView(result.data);
  }
  useEffect(() => {
    let ignore = false;
    void api<View>(`/api/sessions/${sessionId}`).then((result) => {
      if (ignore) return;
      if (!result.ok) setError(result.error.message);
      else setView(result.data);
    });
    return () => {
      ignore = true;
    };
  }, [sessionId]);

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
      {view?.corrupt.length ? <p className="banner mt-3" role="alert">{view.corrupt[0]}</p> : null}
      {!view?.session.activeGenerationId ? <p className="mt-4">No rundown yet. <a className="underline" href={backHref}>Back to check-in</a></p> : null}
      {duration ? (
        <p className="mt-4 text-base" data-testid="session-duration">
          <strong>Estimated time: {formatDuration(duration.totalSeconds)}</strong>
          <span className="block text-sm text-[var(--muted)]">{duration.blockCount} blocks · {duration.roundCount} rounds · {view?.session.settings.timing.roundMinutes} min rounds · {view?.session.settings.timing.restSeconds} sec rest</span>
        </p>
      ) : null}
      <div className="mt-4 grid gap-4">
        {blocks.map((block) => {
          const rows = view?.assignments.filter((row) => row.blockIndex === block) ?? [];
          const busyIds = new Set(rows.flatMap((row) => [row.fighterId, row.volunteerId]));
          const resting = view?.attendance.filter((person) => person.assignedRole === "FIGHTER" && person.availabilityStatus === "AVAILABLE" && !busyIds.has(person.athleteId)) ?? [];
          return (
            <section key={block} className="card" data-testid={`block-${block}`}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-3xl">Block {block}</h2>
                {!readOnly ? (
                  <button className="tap" type="button" disabled={busy} data-testid={`complete-block-${block}`} onClick={() => void act(`/api/sessions/${sessionId}/blocks/${block}/complete`, { confirmBothRounds: true })}>Mark block complete</button>
                ) : null}
              </div>
              <div className="mt-3 grid gap-2">
                {columns.map((location) => {
                  const match = rows.find((row) => row.location === location);
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
        {!readOnly && canDiscard ? <button className="tap tap-gold h-14" type="button" disabled={busy} data-testid="discard-rundown" onClick={() => void discard()}>Discard rundown and return to check-in</button> : null}
        {!readOnly ? <button className="tap h-14" type="button" disabled={busy} data-testid="regenerate" onClick={() => void regenerate()}>Regenerate unfinished</button> : null}
        {!readOnly ? <button className="tap h-12" type="button" disabled={busy} onClick={() => void act(`/api/sessions/${sessionId}/undo`, {})}>Undo last rundown</button> : null}
        <a className="tap h-12" href={backHref} data-testid="back-from-rundown">Back to check-in</a>
      </div>
    </Shell>
  );
}
