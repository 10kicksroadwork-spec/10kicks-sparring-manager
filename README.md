# 10 Kicks Sparring Manager

Mobile web app for a 10 Kicks Saturday hard-sparring rundown. A coach checks fighters and volunteers in, generates three two-round hard sessions for each fighter, then locks, completes, or rebuilds the unfinished part of the card.

This repository is not RingReadyApp. Do not deploy it onto the Vercel project `ring-ready-app`.

The numeric match limits shipped here are **proposed defaults pending coach review**. They are not safety-certified. The coach decides suitability, injury readiness, conduct, and intensity.

## Saturday rules

- Each fighter needs 3 hard sessions, each session is 2 rounds, each with a different volunteer.
- Each fighter is on Main ring, Floor 1, and Floor 2 exactly once.
- A volunteer works at most 2 hard sessions, against different fighters.
- Nobody is double-booked, and nobody works hard blocks back to back.
- Light/recovery is a placeholder. The app does not assign a partner for it.
- Named exclusions are absolute. A numeric exception needs the coach's email, a reason, and an acknowledgment, and it covers only that session.
- Completed and locked matches stay in place when the coach regenerates.

## Local development

```bash
npm install
npm run dev
```

Production refuses to boot a memory database. Local tests set `SPARRING_STORE=memory` and `E2E_TEST_AUTH=1`. Copy `.env.example` to `.env.local` only when real Google, Auth, and Redis secrets are available. Never commit that file.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

`npm run sheets:init` creates the seven spreadsheet tabs after the gym sheet and service account exist. It does not create the spreadsheet itself, and it refuses to overwrite headers that do not match.

## Docs

- `COACH_GUIDE.md` — Saturday desk, for coaches
- `ARCHITECTURE.md` — solver, sheet, and locks
- `DEPLOYMENT.md` — what is live and what is not
- `SECURITY.md` — access rules
- `OWNER_ACTIONS.md` — remaining account-owner steps
- `TASKS.md` — phase gates and current status
