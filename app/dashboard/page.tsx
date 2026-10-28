"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/common/Shell";
import { api, newRequestId } from "@/components/common/client";
import { saturdaySessionCta } from "@/lib/ui/saturday-nav";

type Bootstrap = {
  actor: { email: string; role: string };
  activeSessionId: string | null;
  athleteCount: number;
  corrupt: string[];
  integrations: { supabase: string; lock: string; auth: string; store: string };
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

  const cta = data ? saturdaySessionCta(data.activeSessionId) : null;

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
        {!cta ? (
          <button className="tap tap-gold h-14 text-lg" type="button" disabled data-testid="session-cta-loading">Loading…</button>
        ) : cta.kind === "resume" ? (
          <a className="tap tap-gold h-14 text-lg" href={`/sessions/${cta.sessionId}/attendance`} data-testid="resume-saturday">
            {cta.label}
          </a>
        ) : (
          <button className="tap tap-gold h-14 text-lg" type="button" onClick={() => void startSaturday()} disabled={busy} data-testid="start-saturday">
            {busy ? "Starting…" : cta.label}
          </button>
        )}
      </div>
    </Shell>
  );
}
