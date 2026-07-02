# Deploying to Cloud Run (High Plains Bank GCP project)

Runbook for standing up this app in the client's GCP project. Assumes `gcloud`
is authenticated against that project (`gcloud config set project <PROJECT_ID>`).

## 0. Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com
```

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

## 3. Deploy Firestore rules + indexes

Independent of the app deploy — do this whenever `firestore.rules` or
`firestore.indexes.json` change:

```bash
firebase deploy --only firestore:rules,firestore:indexes --project "$PROJECT_ID"
```

## 4. Firebase Auth setup

In Firebase Console (same GCP project):

1. **Authentication → Sign-in method** → enable **Google**.
2. Restrict sign-in to the bank's Workspace domain: set
   `NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN=highplainsbank.com` (build arg/substitution,
   see below). This only *hints* the domain to the Google account picker —
   for a hard server-side lock, also configure the allowed domain under
   Authentication → Settings → Authorized domains, and check `hd` /email
   domain server-side if you need enforcement beyond the picker UX.
3. Add the Cloud Run URL (and any custom domain, see §6) to **Authorized
   domains**.

## 5. Build and deploy

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_REGION=us-central1,_SERVICE=eos,_REPO=eos,\
_RUNTIME_SERVICE_ACCOUNT=eos-runtime@${PROJECT_ID}.iam.gserviceaccount.com,\
_NEXT_PUBLIC_FIREBASE_API_KEY=...,\
_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...,\
_NEXT_PUBLIC_FIREBASE_PROJECT_ID=...,\
_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...,\
_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...,\
_NEXT_PUBLIC_FIREBASE_APP_ID=...,\
_NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN=highplainsbank.com
```

The `NEXT_PUBLIC_FIREBASE_*` values are public web config (from Firebase
Console → Project Settings → General → Your apps), not secrets — but they're
baked into the client JS bundle at `next build` time, so they must be passed
as build args (substitutions above), not just as a runtime env var on the
Cloud Run service.

`cloudbuild.yaml` builds the image, pushes it to Artifact Registry, and runs
`gcloud run deploy` with `--allow-unauthenticated` (app-layer access control
is Firebase Auth + the hosted-domain restriction, not Cloud Run IAM — see
security levers below if you want GCP-level auth instead).

## 6. Custom domain

```bash
gcloud beta run domain-mappings create \
  --service=eos --domain=eos.highplainsbank.com --region=us-central1
```

Then add the CNAME/records Cloud Run prints out at the DNS provider, and add
that domain to Firebase Auth's authorized domains (step 4.3).

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
