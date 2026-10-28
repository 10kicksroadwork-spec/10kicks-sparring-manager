# 10 Kicks Sparring Manager

Mobile web app for a 10 Kicks Saturday hard-sparring rundown. A coach checks fighters and volunteers in, generates three two-round hard sessions for each fighter, then locks, completes, or rebuilds the unfinished part of the card.

This repository is not RingReadyApp. Do not deploy it onto the Vercel project `ring-ready-app`.

The numeric match limits shipped here are **proposed defaults pending coach review**. They are not safety-certified. The coach decides suitability, injury readiness, conduct, and intensity.

## Saturday rules

- Each fighter needs 3 hard sessions, each session is 2 rounds, each with a different volunteer.
- With 5 or more fighters, each block can use Main ring, Back Mat, and Front Mat. With fewer than 5 fighters, only Main ring and Back Mat are used. Within every block, occupied locations must be a prefix of Main ring → Back Mat → Front Mat (never leave a higher-priority mat open). Location variety is preferred, but repeats are allowed so 5-fighter cards stay ~6 blocks while packing.
- A volunteer works at most 3 hard sessions, against different fighters. When enough people are checked in, generate prefers one block per volunteer; reuse (up to 3) is only used when the pool is too thin.
- Nobody is double-booked, and nobody works hard blocks back to back.
- Light/recovery is a placeholder. The app does not assign a partner for it.
- Named exclusions are absolute. A numeric exception needs the coach's email, a reason, and an acknowledgment, and it covers only that session.
- Completed and locked matches stay in place when the coach regenerates. A rundown that has not started can be discarded so check-in can change.

## Local development

```bash
npm install
npm run dev
```

Production refuses to boot a memory database. The live store is Supabase Postgres. Local tests set `SPARRING_STORE=memory` and `E2E_TEST_AUTH=1`. Copy `.env.example` to `.env.local` only when the Supabase service role key is available. Never commit that file.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

People can be added in the Supabase Table Editor on `athletes`, or in the app roster once the project is connected. The service role key stays on the server. Google Sheets scripts remain in the repo and are not the live store.

## Docs

- `COACH_GUIDE.md` — Saturday desk, for coaches
- `ARCHITECTURE.md` — solver, sheet, and locks
- `DEPLOYMENT.md` — what is live and what is not
- `SECURITY.md` — access rules
- `OWNER_ACTIONS.md` — remaining account-owner steps
- `TASKS.md` — phase gates and current status
