# Cutover Checklist: trial project → client's GCP project

This is the ordered, engineer-facing diff between the trial deployment
(`hpb-eos`, our own GCP project, used for rehearsal/demo) and the real
target (the client's GCP project — `hpb-eos-prod` if that's the one
selected, per `docs/ROADMAP.md`). Every value below was validated by
actually running it end-to-end against `hpb-eos`.

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
project is a **configuration** exercise, not a code change.

The one real exception: `firebase.json#firestore.database` is a static
string (currently `hpb-eos-prod-db`) — see §3 below.

## Trial-only values — do NOT carry these over

These are tied to *our* GCP identity, not the client's, and must be
regenerated fresh in the client's project rather than copied:

- **Billing account** (`013BF6-50C52E-E77374`, our personal account) — the
  client project must bill to the client's own account.
- **Open sign-in** (no `NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN` set) — the
  client project must restrict to their Workspace domain (§5).
- **The trial's OAuth client** (`187669305497-bgvkukdbaju8se2lthpp9t05be16s34h...`),
  if the Meet/Tasks connectors ship — a fresh OAuth client must be created
  *in the client's project*, with redirect URIs pointing at the client's
  real URL, not `eos-h2pbllpgzq-uc.a.run.app`.
- Any values in the trial's Secret Manager (`google-oauth-client-secret`) —
  secrets never move between projects; recreate them from source.

## Order of operations

### 1. Provision the project (Terraform, preferred)

```bash
cd terraform
terraform apply \
  -var="project_id=<CLIENT_PROJECT_ID>" \
  -var="allowed_domain=highplainsbank.com" \
  -var="grant_cloudbuild_deploy_permissions=true"
```

This needs billing already linked on the target project (Terraform doesn't
create projects or link billing — see `terraform/README.md` prerequisites).
`grant_cloudbuild_deploy_permissions=true` closes the #1 friction point
found during rehearsal: without it, `terraform apply` succeeds but the
first `gcloud builds submit` fails until those roles are granted (§6.1 in
`DEPLOY.md` has the manual fallback if Terraform isn't the path used).

Manual-`gcloud` equivalent: `DEPLOY.md` §0–§2, §6.1.

- [ ] `terraform apply` completes clean (or the manual §0–§2 equivalent)
- [ ] Note the outputs: `terraform output runtime_service_account_email`,
      `terraform output artifact_registry_repository`

### 2. Register the project with Firebase (blocker, not covered by Terraform)

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

- [ ] Confirm the database doesn't already exist:
      `firebase firestore:databases:list --project <CLIENT_PROJECT_ID>`
- [ ] If it doesn't exist yet: confirm location (`nam5` vs. single-region)
      with the client **before** running `gcloud firestore databases create`
      — this is permanent, no migration path after the fact (`DEPLOY.md` §3.1)
- [ ] Deploy rules + indexes: `firebase deploy --only firestore:rules,firestore:indexes --project <CLIENT_PROJECT_ID>`

### 4. Firebase Auth

- [ ] Console → Authentication → Sign-in method → enable **Google**
- [ ] Set the OAuth consent/support email for the project
- [ ] Decide hosted-domain enforcement (`DEPLOY.md` §5) — `highplainsbank.com`

### 5. Get the client's Firebase web config values

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
| `_NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN` | *(empty — open sign-in)* | `highplainsbank.com` |
| `_RUNTIME_SERVICE_ACCOUNT` | `eos-runtime@hpb-eos.iam.gserviceaccount.com` | `eos-runtime@<CLIENT_PROJECT_ID>.iam.gserviceaccount.com` |

- [ ] All 9 values captured before the first build (§6)

### 6. Build and deploy

```bash
gcloud builds submit --config cloudbuild.yaml --project <CLIENT_PROJECT_ID> \
  --substitutions=_REGION=us-central1,_SERVICE=eos,_REPO=eos,_TAG=$(git rev-parse --short HEAD),\
_RUNTIME_SERVICE_ACCOUNT=eos-runtime@<CLIENT_PROJECT_ID>.iam.gserviceaccount.com,\
_NEXT_PUBLIC_FIREBASE_API_KEY=...,_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...,\
_NEXT_PUBLIC_FIREBASE_PROJECT_ID=...,_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...,\
_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...,_NEXT_PUBLIC_FIREBASE_APP_ID=...,\
_NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN=highplainsbank.com,\
_NEXT_PUBLIC_FIREBASE_DATABASE_ID=hpb-eos-prod-db
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

### 8. Audit-log Cloud Function

- [ ] `gcloud services enable cloudfunctions.googleapis.com eventarc.googleapis.com run.googleapis.com --project <CLIENT_PROJECT_ID>`
- [ ] Grant `roles/datastore.user` to the Compute Engine default SA
      (`DEPLOY.md` §4 has the exact command — different SA/purpose than the
      Cloud Build deploy grants in §1 above, don't conflate the two)
- [ ] `firebase deploy --only functions --project <CLIENT_PROJECT_ID>`

### 9. OAuth connectors (Meet / Google Tasks), if shipped by then

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
      vars, and `GOOGLE_OAUTH_CLIENT_SECRET` as a secret mount

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
