# Cutover Checklist: trial project → client's GCP project

This is the ordered, engineer-facing diff between the trial deployment
(`hpb-eos`, our own GCP project, used for rehearsal/demo) and the real
target (the client's GCP project — `hpb-eos-prod` if that's the one
selected, per `docs/ROADMAP.md`). Every value below was validated by
actually running it end-to-end against `hpb-eos`.

- For **why** each choice was made, what the two projects actually contain
  today, and the current state of the move:
  [`CUTOVER_PLAN.md`](./CUTOVER_PLAN.md). That's the decision record; this is
  the procedure.
- For the client's own decisions (fresh start vs. data migration, security
  tier, who runs it after go-live): [`CLIENT_GCP_SETUP.md`](./CLIENT_GCP_SETUP.md).
- For the general "how to deploy to any project" mechanics this checklist
  points into: [`DEPLOY.md`](./DEPLOY.md) and [`terraform/README.md`](../terraform/README.md).

This doc doesn't repeat either of those — it's specifically "what's
different between the two projects, and in what order do you change it."

## What does NOT change

The app code, `cloudbuild.yaml`, the Dockerfile, and the Terraform module
are all project-agnostic — every project-specific value is a variable,
substitution, or env var, never hardcoded in source. Moving to the client's
project is *mostly* a **configuration** exercise, with three known
exceptions that ARE code changes:

- `firebase.json#firestore` is a static array of database ids (currently
  `hpb-eos-prod-db` + `hpb-eos-sandbox-db`) — see §3 below.
- **Sign-in allowlist** (§4–§5): "HPB domain plus specific consultant
  account" cannot be expressed by Firebase's single-domain restriction or
  the `hd` hint — it requires the server-side allowlist in
  `lib/firebase/session.ts` (`createSession()`), driven by an env var.
- **Audit-log triggers** (§8): the Cloud Functions must pin
  `database: "hpb-eos-prod-db"` or they silently listen on `(default)`.

## Trial-only values — do NOT carry these over

These are tied to *our* GCP identity, not the client's, and must be
regenerated fresh in the client's project rather than copied:

- **Billing account** (`013BF6-50C52E-E77374`, our personal account) — the
  client project must bill to the client's own account.
- **Open sign-in** (no server-side email check at all) — the client project
  must restrict access, but via the `createSession()` allowlist, **not** the
  hosted-domain hint (§4: the access decision is HPB domain *plus* the
  consultant email, which a domain restriction can't express).
- **The trial's OAuth client** (`187669305497-bgvkukdbaju8se2lthpp9t05be16s34h...`),
  if the Meet/Tasks connectors ship — a fresh OAuth client must be created
  *in the client's project*, with redirect URIs pointing at the client's
  real URL, not `eos-h2pbllpgzq-uc.a.run.app`.
- Any values in the trial's Secret Manager (`google-oauth-client-secret`) —
  secrets never move between projects; recreate them from source.

## Order of operations

### 1. Provision the project (Terraform, preferred)

> **⚠ Workspace first.** The `default` workspace's state holds the TRIAL's
> resources. Running an apply with client-project vars from `default` plans
> a *replacement of the trial deployment* — the fallback environment.
> Always `terraform workspace select prod` (create it once with
> `terraform workspace new prod`) before planning against the client
> project. A reviewed plan for `hpb-eos-prod` is saved as
> `terraform/prod.tfplan` (2026-07-27: 22 add / 0 change / 0 destroy).

```bash
cd terraform
terraform workspace select prod
terraform apply \
  -var="project_id=<CLIENT_PROJECT_ID>" \
  -var="region=us-east1" \
  -var="allowed_domain=highplainsbank.com" \
  -var="grant_cloudbuild_deploy_permissions=true"
```

**Region must be `us-east1`, not the module's `us-central1` default** — the
client DB `hpb-eos-prod-db` is pinned to us-east1 (permanent), the app does
several sequential Firestore reads per page render, and a Cloud Run region
cannot be changed in place (new service = new URL = redo §7/§9).

This needs billing already linked on the target project (Terraform doesn't
create projects or link billing — see `terraform/README.md` prerequisites).
`grant_cloudbuild_deploy_permissions=true` closes the #1 friction point
found during rehearsal: without it, `terraform apply` succeeds but the
first `gcloud builds submit` fails until those roles are granted (§6.1 in
`DEPLOY.md` has the manual fallback if Terraform isn't the path used).

Manual-`gcloud` equivalent: `DEPLOY.md` §0–§2, §6.1.

- [ ] `terraform workspace show` prints `prod`
- [ ] `terraform apply` completes clean (or the manual §0–§2 equivalent)
- [ ] Note the outputs: `terraform output runtime_service_account_email`,
      `terraform output artifact_registry_repository`

### 2. Register the project with Firebase (blocker, not covered by Terraform)

> **Already done for `hpb-eos-prod`** (verified 2026-07-27: Google provider
> enabled with its own OAuth client, 1 Auth user exists). Verify, don't
> re-run.

```bash
firebase projects:addfirebase <CLIENT_PROJECT_ID>
```

- [ ] Confirmed in Firebase Console the project shows as Firebase-enabled

### 3. Firestore database

The client's confirmed convention is a **named** database
(`hpb-eos-prod-db`), not `(default)` — this is *already* correct in
`firebase.json` and doesn't need changing for the real cutover (it only
needs temporary editing for off-target rehearsals — see the callout in
`DEPLOY.md` §3.2).

The project also carries a second named database, `hpb-eos-sandbox-db`, that
local development writes to instead of live data (`DEPLOY.md` §3.3). It is
listed alongside the live one in `firebase.json` so a single
`firebase deploy` keeps both on identical rules and indexes. It has no
bearing on what gets deployed — `pnpm ship` refuses to build from sandbox
config — but if the client's project is stood up fresh, create it too, or
drop the second entry from `firebase.json` and accept that local dev writes
to live data.

> **Already exists on `hpb-eos-prod`** (verified 2026-07-27):
> `hpb-eos-prod-db`, **us-east1**, containing a stale seeded "Demo Team"
> that must be deleted before the real import
> (`pnpm team:delete --team "Demo Team" --project hpb-eos-prod --database hpb-eos-prod-db`).

- [ ] Confirm the database doesn't already exist:
      `firebase firestore:databases:list --project <CLIENT_PROJECT_ID>`
- [ ] If it doesn't exist yet: confirm location (`nam5` vs. single-region)
      with the client **before** running `gcloud firestore databases create`
      — this is permanent, no migration path after the fact (`DEPLOY.md` §3.1)
- [ ] Deploy rules + indexes: `firebase deploy --only firestore:rules,firestore:indexes --project <CLIENT_PROJECT_ID>`
      — **early**: the 10 composite indexes build asynchronously and queries
      fail until they're ready, so this precedes the data import, not
      follows it

### 4. Firebase Auth

- [ ] Console → Authentication → Sign-in method → enable **Google**
      *(already enabled on `hpb-eos-prod`)*
- [ ] Set the OAuth consent/support email for the project
- [ ] Access decision (2026-07-27): **`highplainsbank.com` accounts plus
      `daniel@mcgareyconsulting.com`, no one else.** Neither the provider's
      single-domain restriction nor the `hd` hint can express that — do
      **not** set the provider domain restriction and do **not** bake
      `_NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN=highplainsbank.com` into the
      build (either one locks the consultant account out of the sign-in flow).
      Enforcement is the server-side env-driven allowlist in
      `createSession()` (`lib/firebase/session.ts`) + the matching
      `inDomain()` update in `firestore.rules`. If HPB later issues the
      consultant an `@highplainsbank.com` account, revert to the plain
      domain restriction and delete the allowlist.

### 5. Get the client's Firebase web config values

> **Already captured for `hpb-eos-prod`** — the repo's `.env.local`
> currently holds this exact web config (API key, auth domain, app id,
> sender id `580850228782`, database id). Copy from there rather than
> re-deriving in the console.

Firebase Console → Project Settings → General → Your apps → (create a Web
app if none exists) → SDK config. These are **public, non-secret** values
(same status as the trial's, shown here for the shape/mapping, not because
they're sensitive):

| Substitution | Trial (`hpb-eos`) value | Client value |
|---|---|---|
| `_NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `hpb-eos` | ← from Firebase console |
| `_NEXT_PUBLIC_FIREBASE_API_KEY` | `AIzaSyCgh3-aziIys0-XOFGJSL9tyc0X4saKBdw` | ← from Firebase console |
| `_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `hpb-eos.firebaseapp.com` | ← from Firebase console |
| `_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `hpb-eos.firebasestorage.app` | ← from Firebase console |
| `_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `187669305497` | ← from Firebase console |
| `_NEXT_PUBLIC_FIREBASE_APP_ID` | `1:187669305497:web:...` | ← from Firebase console |
| `_NEXT_PUBLIC_FIREBASE_DATABASE_ID` | *(empty — `(default)`)* | `hpb-eos-prod-db` |
| `_NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN` | *(empty — open sign-in)* | *(empty — see §4: allowlist in code, not `hd`)* |
| `_RUNTIME_SERVICE_ACCOUNT` | `eos-runtime@hpb-eos.iam.gserviceaccount.com` | `eos-runtime@<CLIENT_PROJECT_ID>.iam.gserviceaccount.com` |

- [ ] All 9 values captured before the first build (§6)

### 6. Build and deploy

Once the values from §5 are written into an env file (`.env.prod` for this
repo's real target), the deploy is `pnpm ship` — it assembles every
substitution below, tags the image with the git commit, and refuses a
project/config mismatch. See `DEPLOY.md` §6.2.

```bash
# Deploying to a project that has its own env file in the repo:
pnpm ship -- --env-file .env.prod --project <CLIENT_PROJECT_ID>
```

The raw equivalent, for a project with no env file yet:

```bash
gcloud builds submit --config cloudbuild.yaml --project <CLIENT_PROJECT_ID> \
  --substitutions=_REGION=us-east1,_SERVICE=eos,_REPO=eos,_TAG=$(git rev-parse --short HEAD),\
_RUNTIME_SERVICE_ACCOUNT=eos-runtime@<CLIENT_PROJECT_ID>.iam.gserviceaccount.com,\
_NEXT_PUBLIC_FIREBASE_API_KEY=...,_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...,\
_NEXT_PUBLIC_FIREBASE_PROJECT_ID=...,_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...,\
_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...,_NEXT_PUBLIC_FIREBASE_APP_ID=...,\
_NEXT_PUBLIC_FIREBASE_DATABASE_ID=hpb-eos-prod-db
# _REGION matches §1's us-east1 (cloudbuild.yaml's default is us-central1 —
# always pass it). _NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN deliberately omitted
# per §4. On Bitbucket *triggered* builds these same substitutions must be
# baked into the trigger definition (there's no command line), with
# _TAG=$SHORT_SHA instead of the manual git rev-parse.
```

- [ ] Build reports `SUCCESS` end-to-end (build → push → `gcloud run deploy`,
      no manual redeploy workaround needed — confirmed reliable after the
      `cloudbuild.yaml` deploy-step image fix)
- [ ] Note the printed Service URL

### 7. Close the loop: add the real URL to Firebase Auth

- [ ] Authentication → Settings → Authorized domains → add the Cloud Run URL
      from §6 (and the custom domain, once §9 is done)
- [ ] Sign in once to confirm — this is the step most likely to be missed;
      skipping it lets the app deploy fine but sign-in silently fails
- [ ] **Negative test:** sign in with a Google account that is neither
      `@highplainsbank.com` nor the allowlisted consultant email and confirm
      it is **rejected**. With an allowlist, proving the wrong account fails
      matters more than proving the right one succeeds.

### 8. Audit-log Cloud Function

> **⚠ Silent-failure trap — code change required first.** Both triggers in
> `functions/src/index.ts` (`auditTopLevelWrites`,
> `auditEffectivenessScoreWrites`) pass only a document path — no
> `database` option — so they listen on the **`(default)`** database. The
> client's data lives in `hpb-eos-prod-db`. Deployed as-is, everything
> reports green and the audit log captures **zero events**, with no error
> anywhere. Add `database: "hpb-eos-prod-db"` to both trigger options
> before deploying. (Verified against source 2026-07-27.)

- [ ] Add the `database` option to both triggers in `functions/src/index.ts`
- [ ] `gcloud services enable cloudfunctions.googleapis.com eventarc.googleapis.com run.googleapis.com --project <CLIENT_PROJECT_ID>`
- [ ] Grant `roles/datastore.user` to the Compute Engine default SA
      (`DEPLOY.md` §4 has the exact command — different SA/purpose than the
      Cloud Build deploy grants in §1 above, don't conflate the two)
- [ ] `firebase deploy --only functions --project <CLIENT_PROJECT_ID>`
- [ ] **Prove capture:** edit any doc in the app, then confirm a new row in
      `audit_log` — deploy success alone is not evidence the trigger fires

### 9. OAuth connectors (Meet / Google Tasks), if shipped by then

Google Tasks is **per-user**: each person connects their own Google account
under **Settings** (`/settings`; `/integrations` redirects there). Tokens are
stored under `google_tasks_connections/{uid}` (admin SDK only). Missing
`GOOGLE_OAUTH_*` on the Cloud Run service shows as "Not configured — set
GOOGLE_OAUTH_CLIENT_ID / _SECRET" on that page.

Two-way **completion**: EOS → Google on write; Google → EOS via pull
(Settings / To-Dos load, "Sync now", and `POST /api/google/tasks/pull`).

- [ ] Create a **new** OAuth 2.0 Web client in the client's project
      (Console → APIs & Services → Credentials) — do not reuse the trial's
- [ ] Add the client's real callback URL as the sole authorized redirect URI
- [ ] Consent screen: set publishing status per client policy (Testing +
      test users, or verified/Production if broadly used org-wide)
- [ ] Store the new client secret in the client project's Secret Manager
      (`google-oauth-client-secret` or equivalent name), grant the runtime
      SA `roles/secretmanager.secretAccessor`
- [ ] Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_REDIRECT_URI` (pinned,
      exact HTTPS value — see the comment in `lib/google/tasks.ts` for why
      this must be pinned rather than derived on Cloud Run) as Cloud Run env
      vars, and `GOOGLE_OAUTH_CLIENT_SECRET` as a secret mount. `pnpm ship`
      does **not** set these — update the service explicitly (see
      `.env.example`). Without them, Settings shows the client-id/secret
      error and all Task pushes are no-ops.
- [ ] Set `GOOGLE_TASKS_PULL_SECRET` on Cloud Run (long random string). Create
      a Cloud Scheduler job every 5 minutes:
      `POST https://<service-url>/api/google/tasks/pull` with header
      `Authorization: Bearer <GOOGLE_TASKS_PULL_SECRET>`. Without the secret
      or job, on-demand Sync / page-load pull still works for the signed-in
      user; teammates may lag until the owner opens Settings or To-Dos.

### 10. Custom domain (optional)

- [ ] `DEPLOY.md` §7 — domain mapping + DNS records
- [ ] Add the custom domain to Authorized domains (same place as §7 above)

### 11. Security levers

- [ ] Confirm the client's chosen tier (`CLIENT_GCP_SETUP.md` §5) and apply
      the matching `terraform/variables.tf` flags
      (`enable_cloud_armor` / `enable_cmek` / `enable_pitr` / `enable_data_access_logs`)

### 12. Decommission the trial

Per `CLIENT_GCP_SETUP.md` §7's commitment — do this **after** the client
project is confirmed working, not before:

- [ ] Export/delete `hpb-eos`'s Firestore data (per the migrate-vs-fresh-start
      decision already made with the client)
- [ ] Revoke the trial's OAuth client, delete its Secret Manager secrets
- [ ] `gcloud run services delete eos --project hpb-eos --region us-central1`
- [ ] Unlink billing / consider deleting the `hpb-eos` project entirely
