# Security

- Google sign-in is allowlist-only. A valid Google account that is not listed gets 403 and no roster data.
- Roles: admin, coach, viewer. Deactivate and named exclusions are admin-only.
- Sheets credentials, the Redis token, and the OAuth secret are server env vars. None use a `NEXT_PUBLIC_` prefix.
- The service account scope is `https://www.googleapis.com/auth/spreadsheets` for the one shared spreadsheet. It does not get Drive-wide access or domain-wide delegation.
- Sheet cells are written as user-entered strings, numbers, or booleans so a name cannot become a formula.
- Export text is escaped. Audit and error logs record event types, not secret values.
- Writes fail closed when Redis is down or the spreadsheet is missing.
- Session revision mismatches return 409. The lock token must match to release.
- A repeated generate with the same request id returns the first result.
- The test sign-in cookie is disabled when `NODE_ENV` is production.
- Production rejects `SPARRING_STORE=memory`.
- Anonymous roster reads and writes return 401. Cross-origin mutations from a signed-in coach return 403.

A search of `.next/static` after `npm run build` found no `private_key`, service-account JSON, Upstash token, or Google client secret.

The proposed 15 lb AND 10%, skill gap 1, and aggression gap 1 limits are pending coach review. They are not a certification that a pairing is safe.
