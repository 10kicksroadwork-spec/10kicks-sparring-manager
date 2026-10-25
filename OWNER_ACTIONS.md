# Owner actions

These are the only steps this environment cannot finish. Do not paste passwords, JSON keys, or tokens into chat.

## 1. Vercel team access

Open the consent link in `docs/owner-actions.md` in the project store (it expires about 10 minutes after it is issued) and approve team `team_Z5GwCy5lx2UN8V5LOtgujlP5`.

After that, the app can be created as a new project named `10kicks-sparring-manager`. It must not be deployed to `ring-ready-app`.

## 2. Private GitHub repo

The cloud GitHub login cannot create repositories. In the gym account `10kicksroadwork-spec`, create an empty private repository named `10kicks-sparring-manager`. Then grant this Cursor environment permission to push to it.

Do not send a personal access token in chat. Add it through the approved secret UI if a token is required.

## 3. Gym spreadsheet and Google Cloud

In the gym Google account, create an empty spreadsheet named `10 Kicks — Sparring Manager Database`. In a Google Cloud project, enable the Google Sheets API and create a service account with no extra project roles. Share the spreadsheet with that service account as Editor. Put the spreadsheet id and the JSON key in Vercel secret env vars, not in chat and not in git.

Also create an OAuth Web client with scopes openid, email, and profile. Redirects:

- `http://localhost:3000/api/auth/callback/google`
- `https://<the real Vercel host>/api/auth/callback/google` after the first deploy

## 4. Coach allowlist

Send the real admin, coach, and viewer Google emails through the env secret UI. They map to `ADMIN_EMAILS`, `COACH_EMAILS`, and `VIEWER_EMAILS`. No addresses were invented.

## 5. Upstash, only if a charge appears

After Vercel access, attach the free Marketplace Redis if it does not ask for a paid plan. If billing approval is required, stop there.

## 6. Coach review of the numbers

15 lb and 10%, skill gap 1, and aggression gap 1 are proposed defaults. A coach should accept or change them in Session limits. The app will keep the “not safety-certified” label.
