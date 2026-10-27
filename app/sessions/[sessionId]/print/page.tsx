"use client";

import { use, useEffect, useState } from "react";
import { api, locationLabel } from "@/components/common/client";
import { estimateDuration, formatDuration, type RoundTiming } from "@/lib/domain/timing";
import { locationsForFighterCount, type Location } from "@/lib/domain/types";

type Assignment = { assignmentId: string; blockIndex: number; location: string; fighterId: string; volunteerId: string; status: string };
type View = {
  session: { dateLocal: string; timezone: string; revision: number; settings: { timing: RoundTiming; hardRoundsPerSession: number } };
  attendance: { athleteId: string; displayName: string; assignedRole: string }[];
  assignments: Assignment[];
};

export default function PrintPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<View>(`/api/sessions/${sessionId}/print`).then((result) => {
      if (!result.ok) setError(result.error.message);
      else setView(result.data);
    });
  }, [sessionId]);

  const names = new Map(view?.attendance.map((row) => [row.athleteId, row.displayName]) ?? []);
  const blocks = [...new Set(view?.assignments.map((row) => row.blockIndex) ?? [])].sort((a, b) => a - b);
  const fighterCount = new Set(view?.assignments.map((row) => row.fighterId) ?? []).size;
  const maxBlock = blocks.at(-1) ?? 0;
  const duration = view && maxBlock > 0 ? estimateDuration(maxBlock, view.session.settings.hardRoundsPerSession, view.session.settings.timing) : null;
  const used = new Set(view?.assignments.map((row) => row.location) ?? []);
  const columns = (["MAIN_RING", "FLOOR_1", "FLOOR_2"] as Location[]).filter(
    (location) => locationsForFighterCount(fighterCount).includes(location) || used.has(location),
  );

  return (
    <main className="print-sheet mx-auto max-w-3xl bg-white px-6 py-8 text-black">
      <p className="text-sm tracking-[0.18em]">10 KICKS</p>
      <h1 className="font-display text-4xl">Hard sparring rundown</h1>
      <p>{view?.session.dateLocal} · {view?.session.timezone} · revision {view?.session.revision}</p>
      <p className="mt-2 text-sm">Each hard match is two rounds. Light/recovery is a placeholder and is not an assigned partner.</p>
      {duration ? <p className="mt-2 text-sm" data-testid="print-duration"><strong>Estimated time: {formatDuration(duration.totalSeconds)}</strong> · {duration.roundCount} rounds, {view?.session.settings.timing.roundMinutes} min each, {view?.session.settings.timing.restSeconds} sec rest</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <table className="mt-4 w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            <th className="border-b border-black py-2">Block</th>
            {columns.map((location) => (
              <th key={location} className="border-b border-black py-2">{locationLabel(location)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blocks.map((block) => (
            <tr key={block}>
              <td className="border-b border-neutral-300 py-2">{block}</td>
              {columns.map((location) => {
                const match = view?.assignments.find((row) => row.blockIndex === block && row.location === location);
                return (
                  <td key={location} className="border-b border-neutral-300 py-2">
                    {match ? `${names.get(match.fighterId) ?? "Unknown"} / ${names.get(match.volunteerId) ?? "Unknown"} · 2 rounds${match.status === "INTERRUPTED" ? " · interrupted" : ""}` : "Open"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <button className="no-print mt-6 underline" type="button" onClick={() => window.print()} data-testid="print-rundown">Print or save PDF</button>
      <p className="sr-only">{blocks.map((block) => locationLabel("MAIN_RING") + block).join(" ")}</p>
    </main>
  );
}
