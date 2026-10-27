# Security

- Google sign-in is off unless `AUTH_REQUIRED=1`. With the gate off, the desk opens as a local coach and anyone with the link can use it. When the gate is on, sign-in is allowlist-only: a Google account that is not listed gets 403 and no roster data.
- Roles: admin, coach, viewer. Deactivate and named exclusions are admin-only.
- The Supabase service role key is a server env var named `SUPABASE_SERVICE_ROLE_KEY`. It does not use a `NEXT_PUBLIC_` prefix. The project URL may.
- Tables enable row level security and grant no access to `anon` or `authenticated`. The server uses the service role. The Table Editor uses the dashboard role.
- Sheet cells are written as user-entered strings, numbers, or booleans so a name cannot become a formula.
- Export text is escaped. Audit and error logs record event types, not secret values.
- Writes fail closed when Supabase or the Postgres lock cannot run.
- Session revision mismatches return 409. The lock token must match to release.
- A repeated generate with the same request id returns the first result.
- The test sign-in cookie is disabled when `NODE_ENV` is production.
- Production rejects `SPARRING_STORE=memory`.
- With `AUTH_REQUIRED=1`, anonymous roster reads and writes return 401. Cross-origin mutations return 403.

A search of `.next/static` after `npm run build` found no `private_key`, service-account JSON, Upstash token, or Google client secret.

The proposed 15 lb AND 10% and skill gap 1 limits are pending coach review. They are not a certification that a pairing is safe. Aggression is not a match limit.
