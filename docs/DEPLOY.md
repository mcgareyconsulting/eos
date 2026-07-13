# Deploying to Cloud Run (High Plains Bank GCP project)

Runbook for standing up this app in the client's GCP project. Assumes `gcloud`
is authenticated against that project (`gcloud config set project <PROJECT_ID>`).

> **Sending this to the client?** Use
> [`CLIENT_GCP_SETUP.md`](./CLIENT_GCP_SETUP.md) instead — it's the
> non-engineer checklist of what they need to do/provide before this runbook
> is runnable (GCP project, IAM access, sign-in domain, security tier).

> **Terraform alternative:** everything in sections 0–2 (APIs, Artifact
> Registry, runtime service account) plus the optional security levers can be
> provisioned as code from [`terraform/`](../terraform/README.md) — preferred
> when the client's cloud team wants to review the footprint before granting
> access. The gcloud commands below are the manual equivalent. **§0.5
> (Firebase project registration) is not part of that Terraform module** —
> it's a `firebase` CLI / Console action, not a `google_*` provider resource,
> so it's still a required manual step even on the Terraform path.

## 0. Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com \
  firebase.googleapis.com
```

## 0.5 Register this project with Firebase (BLOCKER)

A GCP project is not automatically a Firebase project — enabling
`firebase.googleapis.com` above does not register it, and `firebase deploy`
(§3, §4) will fail against an unregistered project. Do this once, before
anything else that touches `firebase`:

```bash
firebase login

PROJECT_ID=$(gcloud config get-value project)
firebase projects:addfirebase "$PROJECT_ID"
```

(Equivalent Console flow: Firebase Console → "Add project" → select the
existing GCP project → "Add Firebase".) This is idempotent — safe to
re-run/skip if the project is already Firebase-enabled.

Every `firebase` command in this runbook (§3, §4) already passes
`--project "$PROJECT_ID"` explicitly rather than relying on a locally
selected default project — keep doing that; don't rely on
`firebase use <alias>` state.

## 1. Create the Artifact Registry repo

```bash
gcloud artifacts repositories create eos \
  --repository-format=docker \
  --location=us-central1 \
  --description="EOS app images"
```

## 2. Create the runtime service account

Dedicated, least-privilege — **no exported JSON keys**. Cloud Run attaches
this SA to the running service, and the app authenticates to Firestore/Auth
via Application Default Credentials (ADC) using that attached identity.

```bash
gcloud iam service-accounts create eos-runtime \
  --display-name="EOS Cloud Run runtime"

PROJECT_ID=$(gcloud config get-value project)
SA="eos-runtime@${PROJECT_ID}.iam.gserviceaccount.com"

# Firestore read/write
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA}" --role="roles/datastore.user"

# Firebase Auth admin operations (session verification, user management via
# firebase-admin). If your org restricts broad Firebase Admin roles, scope
# down to roles/firebaseauth.admin instead — check what's actually available/
# permitted in this project and prefer the narrower role.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA}" --role="roles/firebase.sdkAdminServiceAgent"
```

No `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_SERVICE_ACCOUNT_JSON` should
be set in the Cloud Run service's env — leave both unset so `firebase-admin`
falls back to ADC.

## 3. Firestore database + rules

### 3.1 Create the Firestore database (one-time, BLOCKER)

> **PERMANENT CHOICE — confirm with the client before running this.** The
> database location cannot be changed later without a full export/import
> migration. This is the client's decision, not an engineering default —
> see `docs/CLIENT_GCP_SETUP.md` §3 (that doc recommends the `nam5` US
> multi-region unless the client's BigQuery conventions pin everything to a
> single region). Do not run this command until that's confirmed.

```bash
gcloud firestore databases create \
  --location=nam5 \
  --type=firestore-native \
  --project "$PROJECT_ID"
```

### 3.2 Deploy Firestore rules + indexes

Independent of the app deploy — do this whenever `firestore.rules` or
`firestore.indexes.json` change (and once, right after 3.1, to establish
the initial rules):

```bash
firebase deploy --only firestore:rules,firestore:indexes --project "$PROJECT_ID"
```

## 4. Audit log function

`functions/` (self-contained — its own `package.json`/`tsconfig.json`, not
part of the root pnpm workspace) holds the audit-log Cloud Function: a
2nd-gen `onDocumentWrittenWithAuthContext` trigger on every top-level
collection plus `meetings/{meetingId}/effectiveness_scores/{scoreId}`, which
writes an immutable row to `audit_log` for every create/update/delete. This
is the DECIDED (docs/ROADMAP.md) capture mechanism — a server-side trigger,
so nothing can bypass it (app server actions, admin/seed scripts, and
console edits all pass through Firestore and all get audited).

Required APIs (in addition to §0):

```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  eventarc.googleapis.com \
  run.googleapis.com
```

2nd-gen Cloud Functions deploy as Cloud Run services fronted by Eventarc, so
all three APIs are needed even though `run.googleapis.com` is already
enabled for the app itself.

Deploy:

```bash
firebase deploy --only functions --project "$PROJECT_ID"
```

This builds (`tsc`, via the `predeploy` hook in `firebase.json`) and deploys
under the project's default runtime service account for 2nd-gen Cloud
Functions — the **Compute Engine default SA**
(`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`), *not* the
App Engine default SA (`{PROJECT_ID}@appspot.gserviceaccount.com` — that's
the gen1 default, and doesn't apply here) — unless a dedicated per-function
SA is configured. It needs `roles/datastore.user` to write `audit_log`
rows:

```bash
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/datastore.user"
```

No client-facing service account changes are needed; clients never write to
`audit_log` directly (see `firestore.rules`).

**Caveat (ROADMAP-decided):** the Firestore `audit_log` collection grows
unbounded. Once the nightly Firestore→BigQuery worker ships it to BigQuery
(BigQuery becomes the permanent record), the Firestore copy may be put on a
TTL policy and periodically purged — don't rely on Firestore `audit_log` as
infinite retention past that point.

## 5. Firebase Auth setup

In Firebase Console (same GCP project):

1. **Authentication → Sign-in method** → enable **Google**.
2. Restrict sign-in to the bank's Workspace domain: set
   `NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN=highplainsbank.com` (build arg/substitution,
   see below). This only *hints* the domain to the Google account picker —
   for a hard server-side lock, also configure the allowed domain under
   Authentication → Settings → Authorized domains, and check `hd` /email
   domain server-side if you need enforcement beyond the picker UX.

The Cloud Run URL itself doesn't exist yet at this point in the runbook —
adding it to **Authorized domains** is a post-deploy step, §6.3 below (and
§7 for a custom domain).

## 6. Build and deploy

### 6.1 Grant the build service account deploy permissions (one-time)

`cloudbuild.yaml` doesn't specify a custom Cloud Build service account, so
`gcloud builds submit` runs as whichever SA GCP treats as this project's
default build identity — and on any project created recently (2024+),
that is **not** the legacy `<PROJECT_NUMBER>@cloudbuild.gserviceaccount.com`
SA (GCP stopped auto-creating it for newly-enabled projects); it's the
**Compute Engine default SA**,
`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`. Determine which
one is actually active before granting anything:

```bash
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

LEGACY_CLOUDBUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
COMPUTE_DEFAULT_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

if gcloud iam service-accounts describe "$LEGACY_CLOUDBUILD_SA" >/dev/null 2>&1; then
  BUILD_SA="$LEGACY_CLOUDBUILD_SA"
else
  BUILD_SA="$COMPUTE_DEFAULT_SA"
fi
echo "Acting build SA: $BUILD_SA"
```

Grant that SA what it needs to build, push, and deploy per `cloudbuild.yaml`:

```bash
# Deploy the Cloud Run revision.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${BUILD_SA}" --role="roles/run.admin"

# Push images to Artifact Registry.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${BUILD_SA}" --role="roles/artifactregistry.writer"

# Act as the runtime SA, since `gcloud run deploy` attaches it to the
# revision (see §2).
gcloud iam service-accounts add-iam-policy-binding \
  "eos-runtime@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/iam.serviceAccountUser"
```

### 6.2 Run the build

```bash
PROJECT_ID=$(gcloud config get-value project)

gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_REGION=us-central1,_SERVICE=eos,_REPO=eos,\
_TAG=$(git rev-parse --short HEAD),\
_RUNTIME_SERVICE_ACCOUNT=eos-runtime@${PROJECT_ID}.iam.gserviceaccount.com,\
_NEXT_PUBLIC_FIREBASE_API_KEY=...,\
_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...,\
_NEXT_PUBLIC_FIREBASE_PROJECT_ID=...,\
_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...,\
_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...,\
_NEXT_PUBLIC_FIREBASE_APP_ID=...,\
_NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN=highplainsbank.com
```

`_TAG` defaults to `manual` in `cloudbuild.yaml` if omitted — set it
explicitly (as above) so each manual build produces a traceable,
distinguishable image tag instead of every manual build overwriting the
same `manual` tag. (Triggered builds instead get `${SHORT_SHA}` for free
from Cloud Build's own substitutions — this `_TAG` override exists
specifically because `${SHORT_SHA}` is empty on manual `gcloud builds
submit` runs, which would otherwise produce an invalid trailing-colon image
reference.)

The `NEXT_PUBLIC_FIREBASE_*` values are public web config (from Firebase
Console → Project Settings → General → Your apps), not secrets — but they're
baked into the client JS bundle at `next build` time, so they must be passed
as build args (substitutions above), not just as a runtime env var on the
Cloud Run service. (The Dockerfile fails the build with a clear error if any
of the required ones — API_KEY, AUTH_DOMAIN, PROJECT_ID, APP_ID — are
missing, rather than shipping a broken bundle silently.)

`cloudbuild.yaml` builds the image, pushes it to Artifact Registry, and runs
`gcloud run deploy` with `--allow-unauthenticated` (app-layer access control
is Firebase Auth + the hosted-domain restriction, not Cloud Run IAM — see
security levers below if you want GCP-level auth instead).

### 6.3 Add the Cloud Run URL to Firebase Auth (post-deploy)

Now that the service exists and has a URL (`gcloud run services describe
eos --region=us-central1 --format='value(status.url)'`), add it to
**Authentication → Settings → Authorized domains** in the Firebase Console
— this is the hard server-side lock referenced in §5.2. Skipping this step
still lets the app *build* and *deploy* fine, but sign-in will not work
until the domain is authorized.

## 7. Custom domain

```bash
gcloud beta run domain-mappings create \
  --service=eos --domain=eos.highplainsbank.com --region=us-central1
```

Then add the CNAME/records Cloud Run prints out at the DNS provider, and add
that domain to Firebase Auth's authorized domains (same place as §6.3).

## Security levers (optional, flip on as needed)

| Lever | What it buys | How |
|---|---|---|
| Cloud Armor + external LB | WAF, DDoS, IP allowlisting in front of Cloud Run | Put a serverless NEG + external HTTPS LB in front of the service, attach a Cloud Armor policy |
| CMEK | Customer-managed encryption keys for Firestore/Artifact Registry | Configure a Cloud KMS key ring, set on the Firestore database and AR repo |
| Firestore PITR | Point-in-time recovery for accidental writes/deletes | `gcloud firestore databases update --enable-pitr` |
| Data Access audit logs | Log every read/write to Firestore for compliance | Enable Data Access audit logging for the Firestore API in IAM → Audit Logs |
| VPC Service Controls | Perimeter around Firestore/Cloud Run to block data exfiltration | Define a VPC-SC perimeter around the project's GCP resources |

None of these are required for the MVP deploy above; add them per the bank's
security review requirements.
