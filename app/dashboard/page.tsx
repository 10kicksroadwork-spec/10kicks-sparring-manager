"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/common/Shell";
import { api, newRequestId } from "@/components/common/client";

type Bootstrap = {
  actor: { email: string; role: string };
  activeSessionId: string | null;
  athleteCount: number;
  sessions: { sessionId: string; dateLocal: string; status: string; revision: number }[];
  corrupt: string[];
  integrations: { sheets: string; redis: string; auth: string; store: string };
};

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  return (
    <Shell>
      <p className="text-sm uppercase tracking-[0.16em] text-[var(--gold)]">Coach desk</p>
      <h1 className="font-display text-5xl leading-none">Saturday session</h1>
      {data ? <p className="mt-2 text-[var(--muted)]">{data.actor.email} · {data.actor.role} · {data.athleteCount} active athletes</p> : <p className="mt-2">Loading…</p>}
      {data?.integrations.store === "missing" ? (
        <p className="banner mt-4" role="status">Spreadsheet is not connected. The desk can open, but attendance will not save until the gym sheet is shared.</p>
      ) : null}
      {data?.integrations.redis === "missing" && data.integrations.store !== "memory" ? (
        <p className="banner mt-4" role="status">Write lock is not configured, so saves stay paused. That is intentional until Redis is connected.</p>
      ) : null}
      {data?.corrupt.length ? <p className="banner mt-4" role="alert">Some spreadsheet rows look corrupt and were skipped. {data.corrupt[0]}</p> : null}
      {error ? <p className="banner mt-4" role="alert">{error}</p> : null}
      <div className="mt-6 grid gap-3">
        {data?.activeSessionId ? (
          <a className="tap tap-gold h-14 text-lg" href={`/sessions/${data.activeSessionId}/attendance`}>Resume Saturday</a>
        ) : null}
        <button className="tap h-14 text-lg" type="button" onClick={() => void startSaturday()} disabled={busy} data-testid="start-saturday">
          {busy ? "Starting…" : "Start Saturday session"}
        </button>
        <a className="tap h-12" href="/athletes">Athlete roster</a>
      </div>
      <section className="mt-8">
        <h2 className="font-display text-3xl">Previous sessions</h2>
        <ul className="mt-3 grid gap-2">
          {(data?.sessions ?? []).map((session) => (
            <li key={session.sessionId}>
              <a className="card block min-h-11" href={`/sessions/${session.sessionId}/rundown`}>
                <span className="font-semibold">{session.dateLocal}</span>
                <span className="ml-2 text-[var(--muted)]">{session.status} · rev {session.revision}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}
