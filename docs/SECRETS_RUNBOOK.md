# Secrets runbook (Gate 2: secrets and keys)

Operator procedure for moving the Cloud Run service `eos` (project
`hpb-eos-prod`, region `us-east1`) off plain env vars and onto Secret Manager,
rotating the Google OAuth client secret, and creating the KMS key the next
gate uses for Google refresh tokens. Audit refs: **I-03** (secrets in plain
env vars), **C-06** (refresh tokens in plaintext; key only, the encryption
itself is the next gate), **I-06** (see [IAM change](#iam-change)).

Every step lists the **Console** path and the **gcloud** command, plus a
**Check** that tells you it worked. Terraform code: `terraform/secrets.tf`,
`terraform/cloud_run.tf`, `terraform/kms.tf`. Design notes and the short
cutover summary: `terraform/README.md` → "Secrets (Gate 2)". Progress:
`docs/HARDENING_LOG.md`.

## What changes

| | Before (2026-09-27) | After Gate 2 |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_SECRET` | plain env var, pushed from `.env.prod` by `pnpm ship` | Secret Manager ref, `latest` |
| `GOOGLE_TASKS_PULL_SECRET` | not set (pull route returns 503) | Secret Manager ref, `latest` (see step 2) |
| `SIGN_IN_ALLOWLIST` | plain env var, set by hand with gcloud | Secret Manager ref, `latest` |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_REDIRECT_URI` | plain env vars, pushed by `pnpm ship` | plain env vars declared in Terraform (`terraform.tfvars`) |
| Who writes Cloud Run env | `scripts/deploy.sh` + hand-run gcloud | **Terraform only** (`ignore_changes` on env removed) |
| KMS | none (`enable_cmek` lever off) | key ring `eos`, key `eos-tokens` (lever untouched) |

Why it matters: a plain env var is readable by anyone with `run.services.get`
(Cloud Run Viewer and up), is copied into every revision, and lands in
Terraform plan output and state in cleartext (`env` is not a sensitive
attribute). A Secret Manager ref shows only the secret name and version;
reading the value needs `secretmanager.versions.access`, which this module
grants to the runtime service account alone.

## Before you start

- **Roles you need.** Terraform apply: project Owner (today's applying
  identity). Adding versions: `roles/secretmanager.secretVersionAdder` or
  Secret Manager Admin. OAuth client: `clientauthconfig` access (Owner or
  OAuth Config Editor). Plan needs `secretmanager.versions.get` because of
  the metadata-only version check in `secrets.tf`.
- **Terraform workspace `prod`, remote state.** Every Terraform command
  below runs from `terraform/` after:

  ```bash
  cd terraform
  terraform init                       # GCS backend gs://hpb-eos-tfstate
  terraform workspace select prod      # NEVER `default`
  ```

  Variables come from the **committed** `terraform/terraform.tfvars` (it's
  auto-loaded by every `terraform plan`/`apply` — no `-var-file` flag, and
  there is no `prod.tfvars`). The `default` workspace is unused and holds an
  empty state; all real work happens in workspace `prod`. Run
  `terraform workspace show` before any apply and confirm it prints `prod`.

- **`google_oauth_client_id` / `google_oauth_redirect_uri` already live in
  `terraform/terraform.tfvars`.** Both are non-secret. Cross-check them
  against the live service without printing any other env var (a bare
  `gcloud run services describe` prints the current client secret in
  cleartext; don't run one until step 4):

  ```bash
  gcloud run services describe eos --region=us-east1 --project=hpb-eos-prod --format=json \
    | jq -r '.spec.template.spec.containers[0].env[]
             | select(.name=="GOOGLE_OAUTH_CLIENT_ID" or .name=="GOOGLE_OAUTH_REDIRECT_URI")
             | "\(.name)=\(.value)"'
  ```

  Compare against `terraform/terraform.tfvars`:

  ```hcl
  google_oauth_client_id    = "<…>.apps.googleusercontent.com"
  google_oauth_redirect_uri = "https://<service host>/api/google/tasks/callback"
  ```

  If they don't match, fix `terraform/terraform.tfvars` before applying —
  don't apply first and fix it after.

  If the live service carries any other plain env var (for example
  `ENV_LABEL`), add it to `runtime_extra_env` in the same file, or the Gate 2
  apply removes it. Per the 2026-09-27 inventory there are none.

## The sequence

Order matters. A Cloud Run revision that references a secret with no enabled
version fails to start. The Terraform precondition catches this at plan
time, but don't rely on it:

1. **Create** the secrets, their IAM, and the KMS key (targeted apply).
2. **Rotate** the OAuth client secret: add a new one next to the old one.
3. **Add versions** to all three secrets.
4. **Apply** the Cloud Run change, then **verify** it.
5. **Finish**: disable, then delete, the old OAuth secret. Purge `.env.prod`.
   Delete old revisions that carry plaintext values.

The `scripts/deploy.sh` change (no more env pushing) ships in the same PR and
is safe to merge before step 1: from the merge on, `pnpm ship` stops touching
env and the service keeps the plain values it has until step 4.

Steps (a)–(f) below are what the Gate 2 brief asks for. They map onto the
sequence as: (a) = 2 and 5, (b) = 1 and 3, (c) = 4, (d) = 4, (e) is the
ongoing cadence, (f) is rollback.

---

### Step 1: Create secrets, IAM and the KMS key (no values yet)

This creates empty secret containers, the per-secret accessor grants, the
key ring and key, and enables `cloudkms.googleapis.com`. Nothing reads any
of it yet, so it can't affect the running service.

- **Terraform (preferred):**

  ```bash
  terraform apply \
    -target=google_project_service.required \
    -target=google_secret_manager_secret.runtime \
    -target=google_secret_manager_secret_iam_member.runtime_accessor \
    -target=google_kms_key_ring.eos \
    -target=google_kms_crypto_key.eos_tokens \
    -target=google_kms_crypto_key_iam_member.runtime_tokens_encrypter_decrypter
  ```

  Expect **9 to add** (3 secrets, 3 IAM members, key ring, key, key IAM
  member) plus `google_project_service.required["cloudkms.googleapis.com"]`
  if KMS isn't enabled yet. **0 to change, 0 to destroy.** If the plan
  touches `google_cloud_run_v2_service.app`, stop: a `-target` is missing.
  Terraform's "targeted apply" warning is expected.

- **Console (manual fallback, then import):** Security → Secret Manager →
  **+ Create secret**. Name `GOOGLE_OAUTH_CLIENT_SECRET`; leave "Secret
  value" empty; Replication policy: **Automatic**; Labels `app=eos`,
  `component=runtime-env`, `managed-by=terraform` → **Create secret**.
  Repeat for `GOOGLE_TASKS_PULL_SECRET` and `SIGN_IN_ALLOWLIST`. For each,
  open the secret → **Permissions** → **Grant access** → principal
  `eos-runtime@hpb-eos-prod.iam.gserviceaccount.com`, role **Secret Manager
  Secret Accessor**. KMS: Security → Key Management → **Create key ring**
  `eos`, location `us-east1` → key `eos-tokens`, Software, Symmetric
  encrypt/decrypt, rotation 90 days → key **Permissions** → grant the
  runtime SA **Cloud KMS CryptoKey Encrypter/Decrypter**.
- **gcloud (manual fallback, then import):**

  ```bash
  for S in GOOGLE_OAUTH_CLIENT_SECRET GOOGLE_TASKS_PULL_SECRET SIGN_IN_ALLOWLIST; do
    gcloud secrets create "$S" --project=hpb-eos-prod \
      --replication-policy=automatic \
      --labels=app=eos,component=runtime-env,managed-by=terraform
    gcloud secrets add-iam-policy-binding "$S" --project=hpb-eos-prod \
      --member=serviceAccount:eos-runtime@hpb-eos-prod.iam.gserviceaccount.com \
      --role=roles/secretmanager.secretAccessor
  done

  gcloud services enable cloudkms.googleapis.com --project=hpb-eos-prod
  gcloud kms keyrings create eos --location=us-east1 --project=hpb-eos-prod
  gcloud kms keys create eos-tokens --keyring=eos --location=us-east1 \
    --project=hpb-eos-prod --purpose=encryption \
    --rotation-period=90d --next-rotation-time="$(date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ)"
  gcloud kms keys add-iam-policy-binding eos-tokens --keyring=eos \
    --location=us-east1 --project=hpb-eos-prod \
    --member=serviceAccount:eos-runtime@hpb-eos-prod.iam.gserviceaccount.com \
    --role=roles/cloudkms.cryptoKeyEncrypterDecrypter
  ```

  If you used the Console or gcloud path, bring the resources under
  Terraform before step 4:

  ```bash
  for S in GOOGLE_OAUTH_CLIENT_SECRET GOOGLE_TASKS_PULL_SECRET SIGN_IN_ALLOWLIST; do
    terraform import \
      "google_secret_manager_secret.runtime[\"$S\"]" "projects/hpb-eos-prod/secrets/$S"
  done
  terraform import google_kms_key_ring.eos \
    projects/hpb-eos-prod/locations/us-east1/keyRings/eos
  terraform import google_kms_crypto_key.eos_tokens \
    projects/hpb-eos-prod/locations/us-east1/keyRings/eos/cryptoKeys/eos-tokens
  # IAM members: let the next apply create them (it's idempotent on an existing binding).
  ```

- **Check:**

  ```bash
  gcloud secrets list --project=hpb-eos-prod --filter='labels.app=eos'
  gcloud secrets get-iam-policy SIGN_IN_ALLOWLIST --project=hpb-eos-prod
  gcloud kms keys describe eos-tokens --keyring=eos --location=us-east1 \
    --project=hpb-eos-prod --format='yaml(purpose,rotationPeriod,nextRotationTime,primary.state)'
  ```

  You should see three secrets, one `secretAccessor` binding each for the
  runtime SA, and the key with `rotationPeriod: 7776000s` and an ENABLED
  primary.

### (a) Step 2: Rotate the Google OAuth client secret

**Why:** the current client secret was **exposed in Terraform output on
2026-09-27**. Cloud Run `env` is not a sensitive attribute, so plan output
and state print it in cleartext. It also sits in cleartext in every past
Cloud Run revision, in the versioned state bucket `gs://hpb-eos-tfstate`
(including noncurrent object versions), and in `.env.prod` on the
consultant's laptop. Moving it to Secret Manager doesn't unexpose any of
those copies. Rotating does, all at once: after step 5 every one of those
copies is a revoked credential.

> **Two OAuth clients — pick the right one.** `hpb-eos-prod` has two web
> clients and they look alike in the Console:
>
> | Client | Used by | Secret lives in |
> |---|---|---|
> | `…-7eue…` "Google Tasks API (dev+prod)" | the app's Google Tasks connector (`google_oauth_client_id`) | Secret Manager `GOOGLE_OAUTH_CLIENT_SECRET` |
> | `…-ui7v…` "Web client (auto created by Google Service)" | **Firebase Auth Google sign-in** | Firebase → Authentication → Sign-in method → Google → Web SDK configuration |
>
> This runbook rotates **`7eue` only**. Match the Client ID against
> `terraform.tfvars` before adding a secret. A `ui7v` secret in Secret
> Manager makes Tasks fail with 401 `invalid_client`; disabling or deleting
> the `ui7v` secret Firebase holds takes down **sign-in for everyone**
> (both happened on 2026-10-06, see `docs/HARDENING_LOG.md`). To rotate
> `ui7v`: add secret → paste into Firebase's Web SDK configuration → save →
> confirm the stored value's last 4 characters match the Console → test a
> fresh sign-in → only then disable and delete the old one. Never delete a
> secret you haven't disabled and tested first; deletion can't be undone.

Google OAuth web clients can hold **two secrets at once**, so this rotation
has no downtime. You add the new secret, switch the app to it (steps 3–4),
and only then disable and delete the old one (step 5).

- **Console:** APIs & Services → **Credentials** → OAuth 2.0 Client IDs →
  the **Web client** whose Client ID equals `google_oauth_client_id` →
  **Client secrets** panel → **+ Add secret**. (The same client is also
  listed under Google Auth Platform → **Clients**.) Copy the new secret now, or
  download the JSON; it may not be shown in full again. **Leave the old
  secret enabled** for now.
- **gcloud:** no equivalent. Google Auth Platform OAuth web-client secrets
  are managed in the Console only. (`gcloud iam oauth-clients` manages
  Workforce Identity Federation clients, which is a different product, not
  this client.)
- **Check:** the client's Client secrets panel lists **two** enabled
  secrets with different creation dates.

Hand the new value straight to step 3. Don't paste it into a file, a chat,
or a ticket.

### (b) Step 3: Add secret versions

Every secret needs an **enabled** version before step 4. Use `printf '%s'`
or `--data-file` from a pipe, never `echo`: `echo` appends a newline, which
becomes part of the secret. `read -rs` keeps the value out of shell history
and off the screen.

**`GOOGLE_OAUTH_CLIENT_SECRET`**: the NEW secret from step 2.

- **gcloud:**

  ```bash
  read -rs V && printf '%s' "$V" | gcloud secrets versions add GOOGLE_OAUTH_CLIENT_SECRET \
    --project=hpb-eos-prod --data-file=- ; unset V
  ```

- **Console:** Security → Secret Manager → `GOOGLE_OAUTH_CLIENT_SECRET` →
  **+ New version** → paste into **Secret value** → leave "Disable all past
  versions" unchecked → **Add new version**.

**`SIGN_IN_ALLOWLIST`**: the exact value live on the service today. It is
the sign-in perimeter, and if it is empty, sign-in is **open**. This copies
it across without retyping (value today:
`@highplainsbank.com,daniel@mcgareyconsulting.com`):

- **gcloud:**

  ```bash
  gcloud run services describe eos --region=us-east1 --project=hpb-eos-prod --format=json \
    | jq -j '.spec.template.spec.containers[0].env[] | select(.name=="SIGN_IN_ALLOWLIST") | .value' \
    | gcloud secrets versions add SIGN_IN_ALLOWLIST --project=hpb-eos-prod --data-file=-
  gcloud secrets versions access latest --secret=SIGN_IN_ALLOWLIST --project=hpb-eos-prod; echo
  ```

  (The allowlist isn't sensitive, so printing it back to compare is fine.
  Keep it in lockstep with `inDomain()` in `firestore.rules`.)
- **Console:** Secret Manager → `SIGN_IN_ALLOWLIST` → **+ New version** →
  paste the value → **Add new version**.

**`GOOGLE_TASKS_PULL_SECRET`**: this is not set today, and the pull route
`/api/google/tasks/pull` answers **503** ("not configured"). Mounting it
needs *some* version. Pick one:

- **Option A, keep the route disabled (recommended for this gate).** Store
  a single space. The app trims it to empty (`googleTasksPullSecret()` in
  `lib/google/tasks.ts`), so the route keeps answering 503. That's today's
  behavior: this gate changes where secrets live, not which endpoints are
  live.

  ```bash
  printf ' ' | gcloud secrets versions add GOOGLE_TASKS_PULL_SECRET \
    --project=hpb-eos-prod --data-file=-
  ```

  Console: Secret Manager → `GOOGLE_TASKS_PULL_SECRET` → **+ New version** →
  type one space → **Add new version**.
- **Option B, enable the route.** Only together with the Cloud Scheduler
  job that calls it (`docs/CUTOVER_CHECKLIST.md`, the Tasks section). Audit
  **C-09** (non-constant-time bearer compare on this public route) was
  fixed in PR #56 (`bearerMatches` in `lib/google/tasks.ts`, ~line 722).

  ```bash
  openssl rand -base64 48 | tr -d '\n' | gcloud secrets versions add GOOGLE_TASKS_PULL_SECRET \
    --project=hpb-eos-prod --data-file=-
  ```

**Check (all three):**

```bash
for S in GOOGLE_OAUTH_CLIENT_SECRET GOOGLE_TASKS_PULL_SECRET SIGN_IN_ALLOWLIST; do
  echo "== $S"; gcloud secrets versions list "$S" --project=hpb-eos-prod \
    --filter='state=ENABLED' --format='table(name,state,createTime)'
done
```

Each secret must list at least one `ENABLED` version. Console: each
secret's **Versions** tab.

### (c) Step 4a: Apply

Before touching anything, confirm the allowlist secret isn't empty. An
empty `SIGN_IN_ALLOWLIST` means **open sign-in** (see `inDomain()` /
`signInRefusal` in `lib/auth-allowlist.ts`):

```bash
gcloud secrets versions access latest --secret=SIGN_IN_ALLOWLIST --project=hpb-eos-prod \
  | grep -q @ || echo "STOP: allowlist empty"
```

Also confirm you're in the right workspace — an apply from `default` is a
much bigger mistake here than elsewhere, since this step changes live Cloud
Run env:

```bash
terraform workspace show   # must print: prod
```

```bash
terraform plan
```

Read the plan before applying. Expect exactly **one in-place update**,
`google_cloud_run_v2_service.app` (`~ update in-place`, never `-/+
replace`), whose `env` diff:

- adds `GOOGLE_TASKS_PULL_SECRET` with `value_source.secret_key_ref`
  (`version = "latest"`),
- changes `GOOGLE_OAUTH_CLIENT_SECRET` and `SIGN_IN_ALLOWLIST` from `value`
  to `value_source.secret_key_ref`,
- leaves `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_REDIRECT_URI` unchanged.
  If those two show a change, `terraform.tfvars` doesn't match live: fix the
  tfvars, don't apply.
- **drops any env var that's live on the service today but isn't declared
  in `terraform.tfvars` / `runtime_extra_env`** (for example `ENV_LABEL`).
  Read the full env diff, not just the three secrets above — if it removes
  something unexpected, add it to `runtime_extra_env` in
  `terraform/terraform.tfvars` and re-plan before applying.

⚠ This plan prints the **old** client secret and the allowlist one last
time, on the "removed" side of the env diff. Terraform state still holds the
old plain values, and they are revoked in step 5. Run the plan in your own
terminal. Don't save it to a shared location with `-out`, and don't paste it
into a ticket or chat. After this apply, plans and state carry only secret
references.

If the plan fails with *"A secret in secrets.tf has no ENABLED latest
version"*, or with a Secret Manager "not found" error on
`data.google_secret_manager_secret_version.runtime_latest`, step 3 is
incomplete. Go back and add the missing version.

```bash
terraform apply
```

Cloud Run creates a new revision. It only takes traffic once it's ready: a
revision that can't read a secret fails, the apply errors, and traffic stays
on the previous revision.

- **Console equivalent (don't use it; it drifts from Terraform, reference
  only):** Cloud Run → `eos` → **Edit & deploy new revision** → Container →
  **Variables & Secrets** → delete the plain `GOOGLE_OAUTH_CLIENT_SECRET` /
  `SIGN_IN_ALLOWLIST` → **Reference a secret** ×3 → exposed as environment
  variable, version `latest` → **Deploy**.
- **gcloud equivalent (reference only, same caveat):**

  ```bash
  gcloud run services update eos --region=us-east1 --project=hpb-eos-prod \
    --remove-env-vars=GOOGLE_OAUTH_CLIENT_SECRET,SIGN_IN_ALLOWLIST \
    --update-secrets=GOOGLE_OAUTH_CLIENT_SECRET=GOOGLE_OAUTH_CLIENT_SECRET:latest,GOOGLE_TASKS_PULL_SECRET=GOOGLE_TASKS_PULL_SECRET:latest,SIGN_IN_ALLOWLIST=SIGN_IN_ALLOWLIST:latest
  ```

### (d) Step 4b: Verify the revision reads the secrets

1. **The service shows secret refs and no values.**

   ```bash
   gcloud run services describe eos --region=us-east1 --project=hpb-eos-prod \
     --format='yaml(spec.template.spec.containers[0].env)'
   ```

   Expect `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_REDIRECT_URI` with a
   `value:`. The three secrets should have **no `value:`**, only
   `valueFrom.secretKeyRef` with `name: <SECRET_ID>` and `key: latest`.
   Console: Cloud Run → `eos` → **Revisions** → newest revision →
   **Containers** tab → Environment variables / Secrets: three secrets
   shown as "Secret: … version latest", no values.
2. **The new revision is ready and serving 100%.**

   ```bash
   gcloud run revisions list --service=eos --region=us-east1 --project=hpb-eos-prod --limit=3
   gcloud run services describe eos --region=us-east1 --project=hpb-eos-prod \
     --format='yaml(status.traffic)'
   ```

3. **No secret-access errors in the logs.**

   ```bash
   gcloud logging read 'resource.type="cloud_run_revision"
     AND resource.labels.service_name="eos" AND severity>=ERROR' \
     --project=hpb-eos-prod --freshness=15m --limit=20
   ```

   Console: Cloud Run → `eos` → **Logs**, severity ≥ Error.
4. **The app behaves.** Each check exercises one secret:
   - Sign in as an allowlisted `@highplainsbank.com` user: works.
   - Sign in with a Google account **outside** the allowlist: **refused**.
     This is the check that matters. If it gets in, `SIGN_IN_ALLOWLIST` is
     reading empty. Roll back now (step f).
   - Settings → Google Tasks → connect (or reconnect): the OAuth round trip
     completes.
   - On an **existing** Google Tasks connection (a user who connected
     before this rotation), tick one of that user's to-dos and confirm it
     syncs to Google Tasks. Connecting only exercises the authorization
     code exchange; a token **refresh** is what actually uses the client
     secret, so this — not the connect flow above — is the check that
     proves the rotated `GOOGLE_OAUTH_CLIENT_SECRET` works.
   - `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<service host>/api/google/tasks/pull`
     returns `503` with Option A and `401` with Option B.
5. **Terraform has converged.** `terraform plan`
   should report **No changes.**

Then flip the Gate 2 rows in `docs/HARDENING_LOG.md` to `applied` /
`verified`, with the revision name and the describe output as evidence.

### (a, continued) Step 5: Finish the rotation and remove the plaintext copies

Wait until step 4b passes, ideally with a day of normal use in between.

1. **Disable, then delete, the old OAuth client secret.**
   - Console: APIs & Services → Credentials → the web client → Client
     secrets → the **older** secret → **Disable**. Re-check the Tasks
     connect flow. Disabling can be undone, so if anything breaks,
     re-enable it and investigate. Once you're satisfied → **Delete**.
   - gcloud: no equivalent (see step 2).
2. **Purge `.env.prod`.** Delete the `GOOGLE_OAUTH_CLIENT_SECRET=` line and
   any `GOOGLE_TASKS_PULL_SECRET=` line. Until you do, `pnpm ship` prints a
   warning naming them (names only).
3. **Delete old revisions that carry the plaintext env.** Revisions are
   immutable, so pre-Gate-2 revisions keep the old values for as long as
   they exist. The old OAuth secret is revoked by now, but the allowlist is
   in there too. Deleting them also removes them as traffic-rollback
   targets, so do this last.
   - gcloud:

     ```bash
     gcloud run revisions list --service=eos --region=us-east1 --project=hpb-eos-prod \
       --format='table(metadata.name,metadata.creationTimestamp,status.conditions[0].status)'
     # For each revision created BEFORE the Gate 2 apply that is not serving traffic:
     gcloud run revisions delete <REVISION> --region=us-east1 --project=hpb-eos-prod --quiet
     ```

   - Console: Cloud Run → `eos` → **Revisions** → select the pre-Gate-2
     revisions (0% traffic) → **Delete**.
4. **State bucket.** Noncurrent versions of `prod.tfstate` in
   `gs://hpb-eos-tfstate` still contain the old plain values. After step 5.1
   that secret is revoked, so these copies are inert. They expire on the
   bucket's own versioning and lifecycle settings. No action needed, but
   note it in the log.

---

### (e) Rotation cadence

| Secret | Rotate | Also rotate immediately when |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_SECRET` | **annually** | anyone who could read it leaves or changes role (personnel change); suspected exposure (logs, plan output, screenshots, a lost laptop) |
| `GOOGLE_TASKS_PULL_SECRET` (once enabled, Option B) | **annually** | personnel change; suspected exposure; the Scheduler job is recreated |
| `SIGN_IN_ALLOWLIST` | not a credential, so no rotation; it is **updated** | on personnel change (people join or leave the perimeter) |
| KMS `eos-tokens` | automatic, every 90 days (Terraform `rotation_period`) | suspected key misuse: rotate manually (`gcloud kms keys versions create`) and have the app re-encrypt |

"Personnel change" means anyone leaving who held Owner or Secret Manager
access on `hpb-eos-prod`, access to the Terraform state bucket, or a laptop
copy of `.env.prod`. Include the consultant's engagement ending.

**How to rotate any runtime secret:**

1. Create the new value. For the OAuth client that means **+ Add secret**
   (step 2), keeping the old one.
2. Add it as a new version (step 3). Console: secret → **+ New version**.
3. Roll a new revision so every instance picks it up. `latest` is resolved
   when an instance starts, so instances started after step 2 already use
   it, but long-lived instances don't. Either run `pnpm ship`, or redeploy
   the running image:

   ```bash
   IMAGE=$(gcloud run services describe eos --region=us-east1 --project=hpb-eos-prod \
     --format='value(spec.template.spec.containers[0].image)')
   gcloud run deploy eos --image="$IMAGE" --region=us-east1 --project=hpb-eos-prod
   gcloud run revisions list --service=eos --region=us-east1 --project=hpb-eos-prod --limit=2
   ```

   Confirm a new revision name appears. Console: Cloud Run → `eos` → **Edit
   & deploy new revision** → **Deploy** (no edits).
4. Verify (step 4b, items 2–4).
5. Retire the old value: disable the previous version with `gcloud secrets
   versions disable <N> --secret=<ID> --project=hpb-eos-prod` (Console:
   Versions tab → ⋮ → Disable), and for the OAuth client disable, then
   delete, the old client secret. Destroy the old version once nothing has
   needed it for a while: `gcloud secrets versions destroy <N> ...`.

Log each rotation in `docs/HARDENING_LOG.md` with the date and the new
version number. Record the version number only, never the value.

### (f) Rollback

Nothing in this gate is deleted by a rollback. The secrets have
`deletion_protection`, and the KMS key has `prevent_destroy` (KMS keys can't
be deleted anyway).

- **Before step 4a:** nothing to roll back. The secrets and the key exist
  with no consumer and are harmless to leave.
- **After step 4a, if the new revision misbehaves.** Fastest path, a couple
  of minutes: send traffic back to the last pre-Gate-2 revision, which still
  has the old plain env. This works as long as step 5.1 (disable old OAuth
  secret) hasn't happened, which is why step 5 waits.

  ```bash
  gcloud run revisions list --service=eos --region=us-east1 --project=hpb-eos-prod --limit=5
  gcloud run services update-traffic eos --region=us-east1 --project=hpb-eos-prod \
    --to-revisions=<PREVIOUS_REVISION>=100
  ```

  Console: Cloud Run → `eos` → **Revisions** → **Manage traffic** → 100% to
  the previous revision. While traffic is pinned, new deploys don't take
  traffic.

  `cloud_run.tf` has no `traffic` block, so Terraform does not manage
  traffic splitting — a `terraform apply` does **not** route traffic back to
  latest on its own. To recover: (1) route back with the
  `update-traffic --to-revisions=<PREVIOUS_REVISION>=100` command above, (2)
  separately fix the config and `terraform apply` it, then (3) explicitly
  move traffic back with
  `gcloud run services update-traffic eos --to-latest --region=us-east1 --project=hpb-eos-prod`
  (or the Console equivalent) once you're satisfied the fix is good.
- **Wrong secret value (the usual cause).** Fix forward: add the corrected
  value as a **new** version (step 3), roll a revision (step e.3), then
  disable the bad version. Don't disable the newest version and expect
  `latest` to fall back to an older one. Add a new version instead.
- **Revision can't read a secret (permission denied in logs).** Re-run
  `terraform apply` to restore the accessor bindings.
  Check with `gcloud secrets get-iam-policy <ID> --project=hpb-eos-prod`.
- **Full revert (last resort).** This puts plaintext secrets back on the
  service, so treat the OAuth secret as exposed again afterwards.
  1. Pin traffic to the previous revision as above.
  2. In `terraform/cloud_run.tf` only, remove the `env` blocks and the
     precondition, and put `template[0].containers[0].env` back into
     `ignore_changes`. **Keep `secrets.tf` and `kms.tf`.** Removing them
     plans a delete of protected resources, and the apply fails.
     Optionally restore the old `scripts/deploy.sh` from git history.
     Review the plan: it must not touch the Cloud Run service's env.
  3. While traffic is still pinned, put the plain env back in **one**
     update, so no revision ever runs without the allowlist (with the
     allowlist unset, sign-in is open):

     ```bash
     AL=$(gcloud secrets versions access latest --secret=SIGN_IN_ALLOWLIST --project=hpb-eos-prod)
     CS=$(gcloud secrets versions access latest --secret=GOOGLE_OAUTH_CLIENT_SECRET --project=hpb-eos-prod)
     gcloud run services update eos --region=us-east1 --project=hpb-eos-prod \
       --clear-secrets --update-env-vars "^|^SIGN_IN_ALLOWLIST=${AL}|GOOGLE_OAUTH_CLIENT_SECRET=${CS}"
     unset AL CS
     gcloud run services update-traffic eos --to-latest --region=us-east1 --project=hpb-eos-prod
     ```

     Then re-verify sign-in (step 4b, item 4).

---

## IAM change

What this gate grants, all **resource-scoped** (no new project-level
roles):

| Principal | Role | On |
|---|---|---|
| `eos-runtime@hpb-eos-prod.iam.gserviceaccount.com` | `roles/secretmanager.secretAccessor` | each of the 3 secrets, individually |
| `eos-runtime@hpb-eos-prod.iam.gserviceaccount.com` | `roles/cloudkms.cryptoKeyEncrypterDecrypter` | key `eos-tokens` only (not the key ring or the project) |

Nothing is granted to any human or to the build or functions service
accounts. The runtime SA's existing project roles (`roles/datastore.user`,
`roles/logging.logWriter`, `roles/firebaseauth.admin`) are unchanged.

To confirm who can read a secret's value, open Console → IAM & Admin →
**Policy Troubleshooter** with permission `secretmanager.versions.access`
on the secret. Project Owners and Secret Manager Admins can also read it,
by inheritance.

**Follow-up, not part of this gate: I-06.** The runtime SA still holds
**`roles/firebaseauth.admin`** at the project level. That is full Identity
Platform admin: a compromised app instance could create users, set custom
claims (including `role: admin`), and mint sessions for anyone. The app
needs it today for `createSessionCookie`. The follow-up is to evaluate a
custom role limited to session-cookie creation and user lookup, and alert on
`SetAccountInfo` / custom-claim changes in the audit logs. If the full role
turns out to be unavoidable, IAP in front of the app (I-01) becomes the
compensating control. It is tracked in `docs/HARDENING_LOG.md`, and Gate 2
does not change it.
