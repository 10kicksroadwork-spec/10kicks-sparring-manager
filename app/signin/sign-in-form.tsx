"use client";

import { useSearchParams } from "next/navigation";

export function SignInForm() {
  const params = useSearchParams();
  const denied = params.get("error");
  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-6 px-5 py-16">
      <p className="font-display text-5xl tracking-wide text-[var(--gold)]">10 KICKS</p>
      <h1 className="font-display text-4xl leading-none">Sparring Manager</h1>
      <p className="text-[var(--muted)]">Authorized coaches only. Sign in with the Google account the gym added to the list.</p>
      {denied ? (
        <p className="banner" role="alert">That Google account is not on the coach list. Ask an admin to add the exact email, then try again.</p>
      ) : null}
      <form action="/api/auth/signin/google" method="get">
        <button className="tap tap-gold h-12 w-full text-base" type="submit">Sign in with Google</button>
      </form>
    </main>
  );
}
