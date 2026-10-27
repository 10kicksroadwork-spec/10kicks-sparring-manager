# CARL — TASK LIST (10 Kicks Sparring Manager, UI scope 01)

**Intent:** This is a Saturday sparring **logistics/whiteboard replacement**, not a fighter-development or coaching-tracking product. Do not introduce unrelated features.

1. Replace `app/athletes/page.tsx` with compact, collapsed-by-default native `<details>` roster rows. A coach clicks a name to reveal weight, skill, and any existing note. Do not show `Inactive`, `BOTH`, `FIGHTER`, or `VOLUNTEER` labels in the roster list. Keep all underlying eligibility data and the existing add-athlete role dropdown.
2. Remove the duplicate "Athlete roster" dashboard CTA. Keep the global navigation's `Roster` link.
3. Remove the acknowledgement checkbox and its mandatory `confirmLimitsChange` API validation; remove the prior "not safety-certified" explanatory banners. Retain server-side numeric bounds and session revision conflict checking.
4. Preserve **both** existing weight matching thresholds and the skill threshold. The solver currently enforces weight **in pounds AND % of the lighter person**; removing one would change the matches. Replace ambiguous field labels with clear descriptions and one concrete example. Do not change the solver/scoring logic.
5. Add **round duration in whole minutes** (1–15; default **3**) and **rest duration in whole seconds** (0–300; default **60**) to session settings. Store them in existing `session.settings` JSON. Rehydrate defaults for existing sessions missing the new timing object. No SQL migration or additional table is needed.
6. Display an estimated time on the generated rundown and printed schedule. Every block represents **two sequential rounds**, with up to three sparring areas running **in parallel**. Count one rest period between adjacent rounds, including a block transition, but none after the final round. Do not count locations separately; do not count setup or delays. Formula: `roundCount = max(blockIndex) * hardRoundsPerSession`; `totalSeconds = roundCount * roundMinutes * 60 + max(0, roundCount - 1) * restSeconds`.
7. Confirm end-to-end that the settings page saves without a checkbox, older sessions still load, and rundown/print estimates agree. Verify existing matchmaking results remain identical with unchanged limits.

**Drop-in replacement source:** `10Kicks_Sparring_Update_DropIns.zip` contains full copies of every touched/new source file with the exact repository-relative paths. Merge into the existing repository, maintaining any subsequent local changes rather than overwriting them blindly.

## Acceptance checks

- Roster loads with names visible and details hidden. Opening a name shows its weight and skill; no role/status labels are displayed in headers.
- Global navigation still includes `Roster`, but the dashboard no longer has an `Athlete roster` button.
- Session limits save without any acknowledgement checkbox; errors remain visible for invalid values or stale revisions.
- A light 120 lb participant paired with a 135 lb participant still fails the 10% limit, despite meeting 15 lb. A 190/207 lb pair fails the pound limit, despite meeting 10%.
- Create a new session: default round `3 min`, rest `60 sec`. Change to `2 min` and `30 sec`, save and reload; settings persist.
- Six scheduled blocks with two rounds each: at 3:00/1:00, estimate is **47 min**; at 2:00/0:30, estimate is **29 min 30 sec**. Printed duration matches on-screen duration.
- A session created before the change still opens and receives default timing values without requiring a database migration.
- No numeric-limit/scheduling-rule changes, no new database tables or env variables.

## Verification status

TypeScript/TSX *syntax transpilation* succeeded for all modified source and test files. The pure duration helper was compiled and executed in Node with passing standalone checks. `npm run typecheck`, the Vitest suite, and Playwright tests have **not** been validated in this environment because the uploaded project lacked installed dependencies and `npm ci --offline` could not resolve the full npm cache. Run `npm ci && npm run typecheck && npm run lint && npm test && npm run test:e2e` in a working development environment before merging/deploying.

## Deployment

No Supabase or Google Sheets schema migration, new permissions, or new environment variables. Redeploy the Next.js application after running tests. Existing sessions hydrate timing defaults on read. Timezone remains `America/New_York`. Apply this patch to a branch and deploy to staging before production.

**Suggested commit:** `feat(sparring): simplify roster and limits; add session duration estimates`
