# Deployment

Verified on 25 October 2026.

| Item | Status |
| --- | --- |
| Production URL | NOT DEPLOYED |
| Vercel project | NOT CREATED. Do not use `ring-ready-app`. |
| Vercel account | `10kicksroadwork-3397` / `10kicksroadwork@gmail.com`, team `team_Z5GwCy5lx2UN8V5LOtgujlP5`, hobby plan |
| GitHub repo | NOT CREATED. Intended private repo: `https://github.com/10kicksroadwork-spec/10kicks-sparring-manager` |
| Database | Supabase project `10kicks-sparring-manager` (`qqmfyeimcirnkzyjryrh`), region `ca-central-1`. Not `ring-ready`. |
| Google Cloud project | NOT CONFIGURED. `gcloud` is not installed and no service-account JSON is present |
| Upstash Redis | NOT CREATED |
| OAuth client | NOT CREATED |

`npm run build` succeeded for Next.js 16.4.3 after the app compiled. Deployment waits on the owner approving Vercel team access. The build must be redeployed from this repo after that approval. Do not point this app at RingReadyApp or its Supabase project.

## After the owner approves access

1. Create a new Vercel project named `10kicks-sparring-manager` on team `team_Z5GwCy5lx2UN8V5LOtgujlP5`.
2. Push this repo to the private GitHub repo once that repo exists, and connect it.
3. Set server env vars from `.env.example` as secrets. Leave `SPARRING_STORE` unset. Leave `E2E_TEST_AUTH` unset.
4. Add the real production origin to the Google OAuth redirect URI: `https://<the-real-host>/api/auth/callback/google`. Also allow `http://localhost:3000/api/auth/callback/google` for local development.
5. Set `NEXT_PUBLIC_SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY` on the Vercel project. Do not put the service role key in a `NEXT_PUBLIC_` variable.
6. Apply `supabase/migrations/20261026170500_sparring_tables.sql` to the dedicated project. Writes use the Postgres lock. Do not add a paid Redis plan.
7. Open `/api/health` and confirm it reports status words only. Open `/api/athletes` signed out and confirm 401.

No coach email addresses have been chosen. Do not invent them.
