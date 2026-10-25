# Tasks

Status is what was verified in this workspace on 25 October 2026. A gate is not marked passed on a live gym account until that account exists.

## Phase A — Repository, contracts, and infrastructure

- [x] Next.js 16.4.3, React 19, TypeScript strict, Tailwind 4
- [x] Domain model and Zod API schemas
- [x] Google allowlist auth, roles, Sheets client, Redis lock interface, `.env.example`
- [ ] GitHub private repo `10kicks-sparring-manager` under `10kicksroadwork-spec`
- [ ] Vercel project linked (not `ring-ready-app`)
- [x] Gate, local: protected API returns 401/403 in `tests/integration/sessions.test.ts`

## Phase B — Roster and check-in

- [x] Idempotent `npm run sheets:init` for the seven tabs
- [x] Roster, session, attendance, and walk-in volunteer flow
- [x] Mobile check-in screen
- [ ] Gate, phone against the gym spreadsheet: a new athlete survives refresh
- [x] Gate, local memory store: Playwright check-in and walk-in passed

## Phase C — Matchmaker and validator

- [x] Weight gap uses absolute pounds AND percent of the lighter athlete
- [x] Skill gap and aggression gap are separate
- [x] Named exclusion beats a numeric exception
- [x] Independent `validateSchedule`
- [x] Gate: `npm test` domain cases passed, including the notice text “not safety-certified”

## Phase D — Scheduler

- [x] Backtracking search, shortest horizon, rest gap, location uniqueness, volunteer cap
- [x] Timeout is `TIME_BUDGET_EXHAUSTED`, not unsatisfiable
- [x] Gate: 5 fighters and 15 compatible volunteers solve in 6 blocks; a forced 5-block horizon is unsatisfiable

## Phase E — Control and regeneration

- [x] Lock, complete both rounds, regenerate, undo, revision check, audit row, print view
- [x] Redis lock is compare-and-delete; missing Redis fails writes closed
- [x] Gate: integration test keeps completed and locked rows; two concurrent attendance writes do not both apply

## Phase F — QA and production rollout

- [x] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
- [x] Playwright at 320, 360, 390, 430, and 1280, plus the coach flow on a 390-wide viewport
- [ ] Production URL, Google OAuth, gym spreadsheet, and Upstash
- [ ] Gate: a coach can do Definition of Done on the live URL

## Explicitly not done

- No Google spreadsheet was created. No Sheets write has run.
- No GitHub push. The available GitHub token cannot create repositories (`createRepository` is not accessible).
- No Vercel deployment. Team project listing returns 403 until the owner approves team access.
- No Upstash database. It should be attached from the Vercel project after that approval.
- Coach emails were not invented. Allowlists stay empty until the owner supplies them.
