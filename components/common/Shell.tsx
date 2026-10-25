import Link from "next/link";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--ink)]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/dashboard" className="min-h-11 flex items-center gap-2">
            <span className="font-display text-2xl tracking-wide text-[var(--gold)]">10 KICKS</span>
            <span className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Sparring</span>
          </Link>
          <nav className="flex gap-2 text-sm">
            <Link className="tap" href="/dashboard">Saturday</Link>
            <Link className="tap" href="/athletes">Roster</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-5 pb-28">{children}</main>
    </div>
  );
}
