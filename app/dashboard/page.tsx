"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/common/Shell";
import { api, newRequestId } from "@/components/common/client";

type SessionRow = { sessionId: string; dateLocal: string; status: string; revision: number };

type Bootstrap = {
  actor: { email: string; role: string };
  activeSessionId: string | null;
  athleteCount: number;
  sessions: SessionRow[];
  corrupt: string[];
  integrations: { supabase: string; lock: string; auth: string; store: string };
};

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    void api<Bootstrap>("/api/bootstrap").then((result) => {
      if (!result.ok) {
        if (result.error.code === "UNAUTHORIZED" || result.error.code === "FORBIDDEN") router.replace("/signin");
        else setError(result.error.message);
        return;
      }
      setData(result.data);
    });
  }, [router]);

  async function reload() {
    const result = await api<Bootstrap>("/api/bootstrap");
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setData(result.data);
  }

  async function startSaturday() {
    setBusy(true);
    setError("");
    const result = await api<{ session: { sessionId: string } }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ requestId: newRequestId() }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.push(`/sessions/${result.data.session.sessionId}/attendance`);
  }

  async function deleteSession(session: SessionRow) {
    const label = `${session.dateLocal} (${session.status})`;
    if (!window.confirm(`Permanently delete ${label}? Attendance, matches, and audit for that Saturday are removed. This cannot be undone.`)) {
      return;
    }
    setDeletingId(session.sessionId);
    setError("");
    const result = await api<{ deleted: true }>(`/api/sessions/${session.sessionId}`, {
      method: "DELETE",
      body: JSON.stringify({
        requestId: newRequestId(),
        expectedRevision: session.revision,
        confirm: true,
      }),
    });
    setDeletingId(null);
    if (!result.ok) {
      setError(result.error.message);
      await reload();
      return;
    }
    await reload();
  }

  return (
    <Shell>
      <p className="text-sm uppercase tracking-[0.16em] text-[var(--gold)]">Coach desk</p>
      <h1 className="font-display text-5xl leading-none">Saturday session</h1>
      {data ? <p className="mt-2 text-[var(--muted)]">{data.actor.email} · {data.actor.role} · {data.athleteCount} active athletes</p> : <p className="mt-2">Loading…</p>}
      {data?.integrations.store === "missing" ? (
        <p className="banner mt-4" role="status">Database is not connected. The desk can open, but attendance will not save until Supabase is connected.</p>
      ) : null}
      {data?.integrations.lock === "missing" && data.integrations.store !== "memory" ? (
        <p className="banner mt-4" role="status">Write lock is not configured, so saves stay paused.</p>
      ) : null}
      {data?.corrupt.length ? <p className="banner mt-4" role="alert">Some roster rows look corrupt and were skipped. {data.corrupt[0]}</p> : null}
      {error ? <p className="banner mt-4" role="alert">{error}</p> : null}
      <div className="mt-6 grid gap-3">
        {data?.activeSessionId ? (
          <a className="tap tap-gold h-14 text-lg" href={`/sessions/${data.activeSessionId}/attendance`}>Resume Saturday</a>
        ) : null}
        <button className="tap h-14 text-lg" type="button" onClick={() => void startSaturday()} disabled={busy} data-testid="start-saturday">
          {busy ? "Starting…" : "Start Saturday session"}
        </button>
      </div>
      <section className="mt-8">
        <h2 className="font-display text-3xl">Previous sessions</h2>
        <ul className="mt-3 grid gap-2">
          {(data?.sessions ?? []).map((session) => (
            <li key={session.sessionId} className="card flex items-center gap-2" data-testid={`session-row-${session.sessionId}`}>
              <a className="min-h-11 flex-1" href={`/sessions/${session.sessionId}/rundown`}>
                <span className="font-semibold">{session.dateLocal}</span>
                <span className="ml-2 text-[var(--muted)]">{session.status} · rev {session.revision}</span>
              </a>
              <button
                className="tap shrink-0 text-[var(--danger)]"
                type="button"
                aria-label={`Delete session ${session.dateLocal}`}
                data-testid={`delete-session-${session.sessionId}`}
                disabled={deletingId === session.sessionId || busy}
                onClick={() => void deleteSession(session)}
              >
                {deletingId === session.sessionId ? "…" : "×"}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}
