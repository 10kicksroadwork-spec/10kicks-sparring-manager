# Architecture

The app is a Next.js App Router project. Coach pages are client screens. Every API route runs on the Node.js runtime. Google sign-in is off unless `AUTH_REQUIRED=1`. The server talks to Supabase with the service role key. That key is not sent to the browser.

## Saturday model

`lib/domain` is pure TypeScript. `matchmaking.ts` decides whether two people may be paired. `validator.ts` checks a finished card and does not trust the solver. `solver.ts` searches block patterns, then locations, then volunteers. It returns `FEASIBLE`, `UNSAT`, or `TIME_BUDGET_EXHAUSTED`. A timeout is never labeled impossible.

One assignment is one hard match of two rounds. `INTERRUPTED` occupies the block and the pairing, and it does not count as a completed two-round session. Light/recovery is text on the rundown, not a row.

Default limits live in `PROPOSED_MATCH_LIMITS`. Weight in pounds, weight as a percent of the lighter person, and skill apply together. Round timing (`roundMinutes`, `restSeconds`) is stored in the session settings JSON. `parseSettings` fills in defaults for older sessions, so no migration is needed. `lib/domain/timing.ts` computes the estimated session length.

## Persistence

The source of truth is Supabase Postgres. Tables are `athletes`, `sessions`, `attendance`, `assignments`, `restrictions`, `overrides`, and `audit_log`. Row level security is on and there are no anon policies. The owner adds people in the Table Editor or the roster screen. The old Sheets client is unused.

A generate writes a new generation and points `Sessions.active_generation_id` at it in one batch. Older assignment rows stay. Cell values are strings or numbers, not formulas.

`SPARRING_STORE=memory` exists for unit tests and Playwright. Production throws if that mode is set.

## Concurrency

A Postgres `locks` table holds a compare-and-set lock for one coach write at a time. The search runs outside the lock. Inside the lock the server rereads the revision, revalidates, and commits in one database function. Release deletes the row only when the token matches. If Supabase is missing, writes return 503 and the desk can still open. Redis is not required.

The same `requestId` replays the stored audit result instead of publishing a second generation.

## Auth

NextAuth Google sign-in requires a verified email on `ADMIN_EMAILS`, `COACH_EMAILS`, or `VIEWER_EMAILS`. Viewers read. Coaches run the session and the roster. Only an admin deactivates an athlete or adds a named exclusion. There is no open registration.

Mutations require a same-origin request, or the header `x-requested-with: sparring-manager`, and they are rate-limited per coach. Auth is checked before the origin check, so an anonymous call is 401.

`/api/test/session` sets a test cookie only when `NODE_ENV` is not production and `E2E_TEST_AUTH=1`.
