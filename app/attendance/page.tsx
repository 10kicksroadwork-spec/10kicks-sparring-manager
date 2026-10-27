"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/common/Shell";
import { api } from "@/components/common/client";

type VolunteerRow = {
  athleteId: string;
  displayName: string;
  sessionsHelped: number;
  hardSessionsCompleted: number;
  roundsCompleted: number;
};

export default function AttendancePage() {
  const router = useRouter();
  const [rows, setRows] = useState<VolunteerRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<{ volunteers: VolunteerRow[]; corrupt: string[] }>("/api/attendance").then((result) => {
      if (!result.ok) {
        if (result.error.code === "UNAUTHORIZED" || result.error.code === "FORBIDDEN") router.replace("/signin");
        else setError(result.error.message);
        return;
      }
      setRows(result.data.volunteers);
    });
  }, [router]);

  return (
    <Shell>
      <p className="text-sm uppercase tracking-[0.16em] text-[var(--gold)]">Volunteer history</p>
      <h1 className="font-display text-5xl leading-none">Attendance</h1>
      <p className="mt-2 text-[var(--muted)]">
        People who finished hard matches as volunteers. Sorted by most helpful first — use this when rewarding fighters who want to fight.
      </p>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Counts only <strong className="text-[var(--text)]">COMPLETED</strong> assignments where they were the volunteer on that Saturday&apos;s active rundown.
        One completed assignment = one hard session = two rounds.
      </p>
      {error ? <p className="banner mt-4" role="alert">{error}</p> : null}
      {!rows ? <p className="mt-6">Loading…</p> : null}
      {rows && rows.length === 0 ? <p className="mt-6 text-[var(--muted)]">No completed volunteer matches yet.</p> : null}
      {rows && rows.length > 0 ? (
        <ul className="mt-6 grid gap-2" data-testid="attendance-list">
          {rows.map((row, index) => (
            <li key={row.athleteId} className="card flex items-baseline justify-between gap-3" data-testid={`attendance-${row.athleteId}`}>
              <div>
                <p className="text-lg font-semibold">
                  <span className="mr-2 text-[var(--muted)]">{index + 1}.</span>
                  {row.displayName}
                </p>
                <p className="text-sm text-[var(--muted)]">
                  {row.sessionsHelped} Saturday{row.sessionsHelped === 1 ? "" : "s"} · {row.hardSessionsCompleted} hard session
                  {row.hardSessionsCompleted === 1 ? "" : "s"} · {row.roundsCompleted} round{row.roundsCompleted === 1 ? "" : "s"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Shell>
  );
}
