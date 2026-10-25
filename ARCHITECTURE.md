# Architecture

The app is a Next.js App Router project. Coach pages are client screens. Every privileged API route runs on the Node.js runtime, checks the allowlist, and talks to Google Sheets only from the server.

## Saturday model

`lib/domain` is pure TypeScript. `matchmaking.ts` decides whether two people may be paired. `validator.ts` checks a finished card and does not trust the solver. `solver.ts` searches block patterns, then locations, then volunteers. It returns `FEASIBLE`, `UNSAT`, or `TIME_BUDGET_EXHAUSTED`. A timeout is never labeled impossible.

One assignment is one hard match of two rounds. `INTERRUPTED` occupies the block and the pairing, and it does not count as a completed two-round session. Light/recovery is text on the rundown, not a row.

Proposed limits live in `PROPOSED_MATCH_LIMITS` and `PROPOSED_LIMITS_NOTICE`. All four numbers apply together. `limitsPendingCoachReview` stays true.

## Persistence

The source of truth is a gym-owned Google Sheet with seven tabs: Athletes, Sessions, Attendance, Assignments, Restrictions, Overrides, and AuditLog. The service account has the spreadsheets scope only. `sheets:init` adds missing tabs and headers and will not replace a header row that does not match.

A generate writes a new generation and points `Sessions.active_generation_id` at it in one batch. Older assignment rows stay. Cell values are strings or numbers, not formulas.

`SPARRING_STORE=memory` exists for unit tests and Playwright. Production throws if that mode is set.

## Concurrency

Upstash Redis holds a `SET NX PX` lock. The search runs outside the lock. Inside the lock the server rereads the revision, revalidates, and commits. Release uses a token check so one worker cannot drop another's lock. If Redis is missing, writes return 503 and reads can still open.

The same `requestId` replays the stored audit result instead of publishing a second generation.

## Auth

NextAuth Google sign-in requires a verified email on `ADMIN_EMAILS`, `COACH_EMAILS`, or `VIEWER_EMAILS`. Viewers read. Coaches run the session and the roster. Only an admin deactivates an athlete or adds a named exclusion. There is no open registration.

Mutations require a same-origin request, or the header `x-requested-with: sparring-manager`, and they are rate-limited per coach. Auth is checked before the origin check, so an anonymous call is 401.

`/api/test/session` sets a test cookie only when `NODE_ENV` is not production and `E2E_TEST_AUTH=1`.
