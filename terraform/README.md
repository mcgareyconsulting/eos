# EOS Terraform: GCP Cloud Run Footprint

This directory contains the infrastructure-as-code for the EOS app's Cloud Run deployment on High Plains Bank's GCP project. The footprint is deliberately reviewable, with long-form design rationale documented below and `.tf` files kept focused on resource declarations.

## Overview: Architecture and Structure

**Core footprint (always-on):**
- Cloud Run service for the Next.js app (with least-privilege runtime service account)
- Firestore databases `hpb-eos-prod-db` (production) and `hpb-eos-sandbox-db` (sandbox), both pre-existing and **imported** into this module as of Phase 0 backups — see firestore.tf and IMPORT_PHASE0.md
- Artifact Registry (Docker repo for build images)
- Secret Manager secrets for the runtime's secret env vars, mounted into Cloud Run by reference, plus a Cloud KMS key for application-level encryption (Gate 2 — see "Secrets (Gate 2)" below and `docs/SECRETS_RUNBOOK.md`)
- Cloud Build (handles image builds and deployments via cloudbuild.yaml)
- Firebase Auth with Google sign-in restricted to the `allowed_domain`

**Backups and recovery (Phase 0, always-on as of this pass):** Firestore PITR + delete protection on prod, daily/weekly managed backup schedules on prod, a long-term export archive bucket, a weekly Firestore export via a scheduled Cloud Function, and log-based alerting on backup/DR-relevant events. See "Backups and recovery (Phase 0)" below.

**Optional security levers (Tier 1, all default OFF):** Cloud Armor, CMEK, Data Access audit logs. See Tier 1 Security Levers section below. (Firestore PITR was a Tier 1 lever here; it's now a Phase 0 baseline setting on the imported database resources, not a toggle — see below.)

**Planned/blocked:** Nightly BigQuery batch worker (awaiting client BigQuery conventions).

## Initialization and Usage

### Initial Setup

```bash
cd terraform

# Initialize the backend and providers
terraform init -backend=false  # Local state (default) during review
terraform plan

# Once the client provisions a state bucket:
# Uncomment the `backend "gcs"` block in versions.tf and reinitialize
terraform init
```

### Applying Changes

```bash
terraform plan
terraform apply
```

### Validation

```bash
terraform validate
terraform fmt -check -recursive
```

## Configuration

All inputs are defined in `variables.tf`. Key variables:

- `project_id` (required): GCP project ID hosting the app.
- `region` (default: `us-central1`): Primary region for Cloud Run, Artifact Registry, etc.
- `service_name` (default: `eos`): Cloud Run service name; must match `_SERVICE` in cloudbuild.yaml.
- `artifact_repo` (default: `eos`): Artifact Registry repository name; must match `_REPO` in cloudbuild.yaml.
- `allowed_domain` (default: `highplainsbank.com`): Workspace domain allowed to sign in via Firebase Auth.
- `min_instances`, `max_instances`: Cloud Run scaling. Not yet specified by the client; verify against expected traffic/cost before applying in production.
- `grant_cloudbuild_deploy_permissions` (default: OFF): Grant Cloud Build the roles it needs to deploy (see Cloud Build Deploy Service Account section below).
- Security lever toggles: `enable_cloud_armor`, `enable_cmek`, `enable_data_access_logs` (all default OFF).
- Phase 0 backup variables: `prod_database_id`, `sandbox_database_id`, `archive_bucket_name`, `archive_iam_at_project_level` (default OFF), `functions_service_account_email`, `alert_emails`. See "Backups and recovery (Phase 0)" below.
- Gate 2 runtime env: `google_oauth_client_id` and `google_oauth_redirect_uri` (**required**, no defaults, non-secret, set in the committed `terraform/terraform.tfvars`, which Terraform auto-loads — there is no `prod.tfvars`), `runtime_extra_env` (default `{}`, optional non-secret extras such as `ENV_LABEL`), `encrypt_google_tokens` (default `false`; Gate 4 — sets `GOOGLE_TOKEN_KMS_KEY` to the `eos-tokens` key so the app stores Google refresh tokens KMS-encrypted; flip only after the key IAM grant from Gate 2 is applied, see `docs/SECRETS_RUNBOOK.md` step 6). Secret *values* are never variables. See "Secrets (Gate 2)".

### Outputs

Run `terraform output` to see:
- `service_url`: Public URL of the Cloud Run service.
- `runtime_service_account_email`: Runtime SA email (pass as `_RUNTIME_SERVICE_ACCOUNT` in cloudbuild.yaml).
- `artifact_registry_repository`: Fully-qualified Artifact Registry repository ID.
- `archive_bucket_name`: Name of the long-term backup/export archive bucket.
- `backup_service_account_email`: Email of the backup automation service account.
- `runtime_secret_ids`: Secret Manager secret IDs mounted into Cloud Run (names only).
- `tokens_kms_key_id`: Resource ID of the `eos-tokens` KMS key (application-level encryption).

No output carries a secret value, and none can: this module never manages secret versions.

## Core Resources

### Cloud Run Service (cloud_run.tf)

The app runs as an always-on Cloud Run service. Terraform manages the service configuration (SA, scaling, ingress, and — since Gate 2 — **all container env**); image updates are owned by cloudbuild.yaml (`gcloud run deploy` on every build, which leaves env untouched). Env set by hand with `gcloud run services update --update-env-vars` is removed by the next apply; declare it in `runtime_extra_env` instead. See "Secrets (Gate 2)".

**Ingress and Authentication:**

Access control for this app is enforced at the application layer (Firebase Auth with Google sign-in restricted to `var.allowed_domain`), not at the GCP/Cloud Run level. This matches cloudbuild.yaml's `--allow-unauthenticated` deploy flag. The service is publicly callable; the app is responsible for auth.

**Alternative: GCP-level Auth (Cloud Run/IAP):**

If the bank's security review requires GCP-level authentication (e.g., via Identity-Aware Proxy) instead of relying on app-layer Firebase Auth:

1. Remove the `google_cloud_run_v2_service_iam_member.public_invoker` resource (drop the `allUsers` binding).
2. Flip cloudbuild.yaml's `--allow-unauthenticated` to `--no-allow-unauthenticated`.
3. Stand up an external HTTPS Load Balancer with a serverless NEG pointing at this service.
4. Put Identity-Aware Proxy in front.
5. Grant specific principals `roles/run.invoker` instead of `allUsers`.

This requires the load-balancer infrastructure mentioned in the Cloud Armor section (levers.tf).

### Artifact Registry (artifact_registry.tf)

Docker repository for app images. Repository ID matches `_REPO` in cloudbuild.yaml and docs/DEPLOY.md.

**CMEK Warning:** The `kms_key_name` attribute is **immutable** on an Artifact Registry repository. Terraform cannot update it in place — enabling CMEK (via the `enable_cmek` lever) *after* the repository already exists forces a destroy/recreate, which deletes every image in the repository with no recovery option. Decide on CMEK **before** the first `terraform apply` that creates this repository.

### Service Accounts and IAM (iam.tf)

**Runtime Service Account:**

A dedicated, least-privilege Cloud Run runtime service account (no exported JSON keys anywhere in this module). The app authenticates via Application Default Credentials (see docs/DEPLOY.md §2).

Roles granted:
- `roles/datastore.user`: Firestore read/write.
- `roles/logging.logWriter`: Cloud Logging writer.
- `roles/firebaseauth.admin`: Firebase Auth session-cookie creation (required for the app's sign-in flow; without it, ID-token exchange succeeds but session cookie creation 500s, breaking sign-in). Broader than needed (audit I-06); tracked as a follow-up outside Gate 2.

Resource-scoped grants (Gate 2, not project-level):
- `roles/secretmanager.secretAccessor` on each of the three runtime secrets (secrets.tf).
- `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the `eos-tokens` key only (kms.tf).

**Cloud Build Deploy Service Account Grants (opt-in, default OFF):**

By default, Cloud Build runs under the project's default build identity, which depends on when `cloudbuild.googleapis.com` was enabled:

- **Enabled before ~April 2024:** Legacy Cloud Build SA (`<PROJECT_NUMBER>@cloudbuild.gserviceaccount.com`).
- **Enabled after ~April 2024:** Compute Engine default SA (`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`).

This module enables `cloudbuild.googleapis.com` in `apis.tf`, guaranteeing the Compute Engine default SA case (post-April 2024 behavior). On fresh projects applying this module for the first time, the Compute Engine default SA is 100% certain. The legacy-SA case can only apply when re-applying against a project that already had Cloud Build enabled beforehand (see docs/DEPLOY.md §6.1 for that fallback).

To grant Cloud Build the permissions it needs to deploy, set `grant_cloudbuild_deploy_permissions = true` (default OFF so this remains a deliberate decision by the bank's cloud team):

Roles granted:
- `roles/run.admin`: Create and manage Cloud Run services.
- `roles/artifactregistry.writer`: Push images to Artifact Registry.
- `roles/iam.serviceAccountUser`: Act as the runtime SA when deploying.
- `roles/logging.logWriter`: Write Cloud Build's own build logs.

This grant set was verified end-to-end during the deploy rehearsal (docs/DEPLOY.md §6).

### Org Policy: Disable Service Account Key Creation (iam.tf, commented)

Bans the creation of exported service account keys org-wide. Free and high-signal for a bank security review (this repo already avoids exported keys per docs/DEPLOY.md §2; this constraint makes it enforced).

Left commented because:
1. It requires org-level `roles/orgpolicy.policyAdmin` (Org Policy Administrator), not just project owner.
2. Applying it at the org affects every project in the org, not just this one.

If the client wants it, they can apply the gcloud equivalent or uncomment the resource below after adding an `org_id` variable to variables.tf.

## Secrets (Gate 2): secrets.tf, cloud_run.tf, kms.tf

Audit refs I-03 (secrets as plain Cloud Run env vars) and C-06 (Google
refresh tokens in plaintext). The operator procedure, with a Console path
and a gcloud command for every step, is in **`docs/SECRETS_RUNBOOK.md`**.
This section covers the design and the order of operations.

**What Terraform manages:**

| File | Resources |
|---|---|
| `secrets.tf` | `google_secret_manager_secret.runtime` for `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_TASKS_PULL_SECRET`, `SIGN_IN_ALLOWLIST` (secret ID = env var name; automatic replication; labels; `deletion_protection = true`). `google_secret_manager_secret_iam_member.runtime_accessor`: `roles/secretmanager.secretAccessor` per secret, runtime SA only. A metadata-only `google_secret_manager_secret_version` data source (`fetch_secret_data = false`) feeds the Cloud Run precondition. |
| `cloud_run.tf` | The three secrets mounted as env via `value_source.secret_key_ref` (`version = "latest"`). `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_REDIRECT_URI` as plain env from variables. `runtime_extra_env` for other non-secret extras. **`template[0].containers[0].env` removed from `ignore_changes`**, so Terraform owns env. The image stays ignored because cloudbuild.yaml rolls it. |
| `kms.tf` | Key ring `eos` (`us-east1`, pinned) and key `eos-tokens` (`ENCRYPT_DECRYPT`, 90-day rotation, `prevent_destroy`). `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the key for the runtime SA. The app doesn't use it yet: the next gate envelope-encrypts refresh tokens with it. Separate from, and not affecting, the `enable_cmek` lever in levers.tf. |

**What Terraform deliberately does not manage: secret versions (values).**
A `google_secret_manager_secret_version` resource would put the value into
state and plan output, which is exactly the leak this gate closes. Cloud Run
`env` is not a sensitive attribute, and that is how the OAuth client secret
reached Terraform output on 2026-09-27. Operators add values out-of-band:

```bash
printf '%s' "$VALUE" | gcloud secrets versions add <SECRET_ID> --project=hpb-eos-prod --data-file=-
```

Console: Security → Secret Manager → `<SECRET_ID>` → **+ New version**.

**Why the order matters.** A Cloud Run revision that references a secret
with no enabled version fails to start. The precondition on
`google_cloud_run_v2_service.app` makes `plan` fail first (*"A secret in
secrets.tf has no ENABLED latest version…"*, or a Secret Manager "not found"
error from the data source when a secret has no versions at all). The
precondition is a backstop. The sequence below is the procedure.

### Cutover order

1. **Create secrets** (and IAM and the KMS key): targeted apply, no values
   yet, so the service is untouched.

   ```bash
   terraform apply \
     -target=google_project_service.required \
     -target=google_secret_manager_secret.runtime \
     -target=google_secret_manager_secret_iam_member.runtime_accessor \
     -target=google_kms_key_ring.eos \
     -target=google_kms_crypto_key.eos_tokens \
     -target=google_kms_crypto_key_iam_member.runtime_tokens_encrypter_decrypter
   ```

   The committed `terraform/terraform.tfvars` (auto-loaded, no `-var-file`
   needed) must already set `google_oauth_client_id` and
   `google_oauth_redirect_uri`, because variables are validated even on a
   targeted apply. Confirm `terraform workspace show` prints `prod` first —
   the `default` workspace is unused and holds an empty state.
2. **Add versions** to all three secrets. First rotate the OAuth client
   secret: its current value was exposed, so the version you add is the
   *new* one. For `GOOGLE_TASKS_PULL_SECRET`, see the runbook's Option A
   (keep the pull route disabled) or Option B (enable it).
3. **Apply:** `terraform plan` should show a single in-place update of
   `google_cloud_run_v2_service.app` (env diff only), then `terraform
   apply`. This plan prints the old plain values one last time on the
   "removed" side, so keep it off shared logs. Before applying, also check
   that `SIGN_IN_ALLOWLIST` isn't empty (`gcloud secrets versions access
   latest --secret=SIGN_IN_ALLOWLIST --project=hpb-eos-prod | grep -q @ ||
   echo "STOP: allowlist empty"` — an empty allowlist means open sign-in,
   see `lib/auth-allowlist.ts`), and read the env diff for anything live on
   the service but not declared in `terraform.tfvars`/`runtime_extra_env`
   (e.g. `ENV_LABEL`) — add it to `runtime_extra_env` before applying, or
   the apply drops it.
4. **Verify:** `gcloud run services describe eos --region=us-east1
   --format='yaml(spec.template.spec.containers[0].env)'` shows
   `secretKeyRef` for the three secrets and no values. Sign-in refuses a
   non-allowlisted account. The Google Tasks connect flow completes — but
   also tick a to-do on an **existing** Google Tasks connection and confirm
   it syncs; connecting alone only exercises the auth code exchange, and a
   token **refresh** is what actually uses the rotated client secret. A
   second `terraform plan` reports no changes.
5. **Remove env-var pushing from deploy.sh.** This is already done in code
   in this change: `sync_runtime_env` and `--sync-env` are gone, and it is
   safe to merge before step 1, because the service keeps its current env
   until step 3. The operator's part is to purge `GOOGLE_OAUTH_CLIENT_SECRET`
   (and any `GOOGLE_TASKS_PULL_SECRET`) from `.env.prod`, then disable and
   delete the old OAuth client secret.

### Rollback

- **Before step 3:** nothing to undo. Secrets and the key sit unused.
- **After step 3:** pin traffic to the previous (pre-Gate-2) revision:
  `gcloud run services update-traffic eos --to-revisions=<PREV>=100
  --region=us-east1 --project=hpb-eos-prod`. It still carries the old
  plain env, and it keeps working as long as the old OAuth client secret
  hasn't been disabled yet. That's why disabling it is the last step.
  `cloud_run.tf` has no `traffic` block, so Terraform does not manage
  traffic splitting: a `terraform apply` does not route traffic back to
  latest by itself. Fix the config, `terraform apply` it, then separately
  run `gcloud run services update-traffic eos --to-latest --region=us-east1
  --project=hpb-eos-prod` (or the Console equivalent) to move traffic back.
- **Wrong value:** add a corrected **new** version and roll a revision.
  Don't just disable the newest version.
- **Full revert:** revert only the env part of `cloud_run.tf` (restore the
  env `ignore_changes`) and restore plain env with gcloud. **Never** remove
  `secrets.tf` or `kms.tf` as a rollback: the secrets have
  `deletion_protection` and the key has `prevent_destroy`, and KMS keys
  can't be deleted anyway. Details are in `docs/SECRETS_RUNBOOK.md` (f).

**`default` workspace: unused, empty state.** All Gate 2 work — and all
current work generally — happens in workspace `prod`. Confirm with
`terraform workspace show` (must print `prod`) before any apply.

## Required APIs (apis.tf)

The module enables the following APIs:
- Core app: `run.googleapis.com`, `cloudbuild.googleapis.com`, `artifactregistry.googleapis.com`, `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `firebase.googleapis.com`.
- Future audit-log onWrite trigger: `cloudfunctions.googleapis.com`, `eventarc.googleapis.com`.
- Phase 0 backups: `storage.googleapis.com` (archive bucket), `monitoring.googleapis.com` + `logging.googleapis.com` (alert policies). `cloudscheduler.googleapis.com` is also used here (weekly Firestore export job) as well as by the future nightly BigQuery batch worker below.
- Foundation (least-privilege SAs, no exported keys, secrets): `secretmanager.googleapis.com`, `iam.googleapis.com`.
- Gate 2 application-level encryption (kms.tf): `cloudkms.googleapis.com`. (The CMEK lever in levers.tf needed it too but never enabled it.)

APIs are left enabled if the module is destroyed (safe default for a live client project).

## Tier 1 Security Levers (levers.tf)

Three of the four levers originally declared here are optional and default OFF; the MVP runs fine without any of them. Each is gated on its own boolean variable. **Ballpark combined cost: ~$40–75/mo** (verify against current GCP pricing before quoting). Tier 0 (least-privilege SAs, no exported keys, Secret Manager, default-deny Firestore rules, domain-restricted auth) is already the baseline in this module and the app itself. The fourth (former Lever 3, Firestore PITR) is retired as a lever — see its section below; PITR is now a Phase 0 baseline setting, always on for prod.

### Lever 1: Cloud Armor (WAF / DDoS / IP allowlisting)

- **Cost:** ~$5/mo per policy + ~$1/rule/mo + per-request evaluation (included in the ~$40–75/mo Tier 1 total).
- **Variable:** `enable_cloud_armor` (default OFF).

**Scope Note:** Cloud Armor policies only attach to an external HTTPS Load Balancer's backend service, not directly to a Cloud Run service. Wiring Cloud Run behind an LB requires:
- Serverless NEG (Network Endpoint Group)
- Backend service
- URL map
- Target HTTPS proxy
- Forwarding rule
- Reserved IP
- Managed SSL certificate

This is a meaningfully larger, separate footprint beyond "flip a flag" and is deliberately out of scope for this pass. The policy resource is created standalone and ready to attach once an LB exists; it has no effect on traffic until then.

**TODO:** Build `load_balancer.tf` (serverless NEG + LB chain) if/when the bank confirms they want Cloud Armor, then attach this policy to the LB's backend service.

### Lever 2: CMEK (Customer-Managed Encryption Keys)

- **Cost:** ~$0.06/key/mo (Cloud KMS key version) + ~$0.03/10k crypto operations.
- **Variable:** `enable_cmek` (default OFF).

**Applies to:**
- **Artifact Registry:** The `kms_key_name` attribute (see artifact_registry.tf) is a stable, supported provider attribute. **WARNING: Immutable — enable CMEK before the repository is created.**
- **Firestore:** Firestore supports CMEK on the database resource, but this module does not manage a `google_firestore_database` resource (the "(default)" database already exists, created via the Firebase console during MVP setup). Enabling CMEK on an existing Firestore database can be a one-way, database-recreating change in some configurations. Safer path: confirm the requirement with the client, then apply via:
  ```bash
  gcloud firestore databases update --project=<PROJECT_ID> --database='(default)' \
    --kms-key-name=<key resource name>
  ```
  Or import the database into Terraform first. Left as a documented gcloud alternative rather than an active/commented resource, since guessing the current attribute name against a real (already-existing) resource is exactly the kind of risk this module avoids.

**Service Agent Grant:** Artifact Registry does not implicitly get to use a CMEK key — its per-service service agent must be explicitly granted Encrypter/Decrypter on the key, or repo creation/image pushes fail with a KMS permission-denied error. The module uses `google_project_service_identity` (beta-only in hashicorp/google v6.x, declared in versions.tf) to provision/look up that service agent without hardcoding the service-account email.

### Former Lever 3: Firestore Point-in-Time Recovery (PITR) — retired, superseded by Phase 0

This used to be a `null_resource`/`local-exec` lever gated on `enable_pitr`, wired against a database literally named `"(default)"`. That database name was never correct for this project (the real databases are `hpb-eos-prod-db` and `hpb-eos-sandbox-db`), so the lever never actually did anything here.

As of the Phase 0 backups pass, both real Firestore databases are **imported** into this module (see firestore.tf and IMPORT_PHASE0.md), and PITR + delete protection are managed directly as attributes on the `google_firestore_database` resources — no toggle, no local-exec, no gcloud workaround needed. See "Backups and recovery (Phase 0)" below for the full picture, including the on/off state per database and the Console/gcloud equivalents.

### Lever 4: Data Access Audit Logs (Firestore/Datastore API)

- **Cost:** No separate GCP fee for enabling the log category itself, but Cloud Logging ingestion + storage volume (DATA_READ especially on a read-heavy app) can be nontrivial. Verify actual volume via a short trial before committing to a number.
- **Variable:** `enable_data_access_logs` (default OFF).

Enables `DATA_READ` and `DATA_WRITE` audit log categories for the Firestore/Datastore API.

### Tier 2 (Comment-Only): VPC Service Controls

VPC Service Controls is an org-level Access Context Manager construct (a security perimeter around APIs like Firestore/BigQuery to block data exfiltration), not a per-project Terraform resource you'd toggle here.

**Cost:** $0 direct GCP cost (real cost is the ops/design effort).

**Requirements:**
- Access Context Manager access policy at the *organization* level (org-level permissions; one per org, shared across projects).
- `google_access_context_manager_service_perimeter` naming the specific projects + restricted services (e.g., `firestore.googleapis.com`, `bigquery.googleapis.com`).
- Careful staging (dry-run mode first) since misconfiguration can break legitimate cross-project access, including the app's own Cloud Build → Cloud Run → Firestore path.

**Recommendation:** Scope this as a separate follow-up engagement once BigQuery conventions land, not bundled into this skeleton. No variable/resource for this lever is defined in this module.

## Provider Configuration (versions.tf)

**Terraform version:** >= 1.7.0

**Providers:**
- `hashicorp/google` ~> 6.0: Main GCP provider.
- `hashicorp/google-beta` ~> 6.0: Beta-only resources (currently the CMEK lever's `google_project_service_identity` resource in levers.tf, which is beta-only in v6.x). Declaring it here keeps `terraform plan`/`validate` green even with the CMEK lever OFF — Terraform type-checks every resource block regardless of `count`.

**Remote State Backend:**

Uncomment and fill in the `backend "gcs"` block once the client provisions a state bucket. Recommend:
- Dedicated bucket per project
- Versioning enabled
- Uniform bucket-level access
- **Not** the same bucket as app data

Example:

```hcl
backend "gcs" {
  bucket = "hpb-eos-tfstate"
  prefix = "eos/terraform/state"
}
```

Left as local state (no backend block) until then so this skeleton applies cleanly out of the box during review.

## Nightly BigQuery Batch Worker (Blocked)

### Status

**BLOCKED** on client BigQuery conventions (dataset naming, region, partitioning standards, PII handling, retention, reader access). The schema mapping is also blocked. Nothing in this section is active; it's a skeleton to fill in once those conventions arrive, so the shape of the eventual change is visible for review now rather than a surprise later.

### Decided Design (To Preserve Once Unblocked)

**Run cadence:** Nightly (decoupled from analytics grain, which is mostly weekly). Cost delta (nightly vs. weekly) is negligible at this scale.

**Data pattern:** Date-partitioned append, not overwrite. Each run appends current state tagged with a `snapshot_date` partition column per collection.

**Collections to mirror:**
- Core: `organizations`, `users`, `teams`, `team_members`, `rocks`, `milestones`, `todos`, `issues`, `headlines`.
- Analytics: `scorecard` metrics/values.
- Comms: `meetings`.
- Audit: Append-only `audit_log` collection (separate onWrite-trigger audit log work; see future Cloud Functions work, independent of this worker).
- Skip ephemeral presence/segment-cursor state.

**Per-table shape:** Stable scalar columns + `snapshot_date` partition + a `raw` JSON column to absorb schema drift.

**Mechanics:** Cloud Scheduler → Cloud Run job → BigQuery load jobs, idempotent, partitioned by date.

### Implementation Sketch (To Be Filled In)

Once conventions arrive, implement:

1. **Cloud Run Job:** Runs to completion (unlike the always-on `google_cloud_run_v2_service`), reads current Firestore collection state, writes date-partitioned rows into BigQuery. Service account narrowed to `datastore.viewer` + `bigquery.dataEditor` on only the target dataset.

2. **Cloud Scheduler Trigger:** Invokes the Cloud Run job nightly via OIDC-authenticated HTTP call to the Cloud Run Jobs API. Cron schedule: `0 2 * * *` (02:00 daily; adjust to client timezone/preference and verify against HPB's actual timezone). Depends on the provider version's support for triggering Cloud Run *jobs* specifically — verify against the pinned provider docs when unblocking.

## Backups and recovery (Phase 0)

This section covers everything added in the "Phase 0: backups" pass:
`firestore.tf`, `backup.tf`, `monitoring.tf`. It's written as teaching
material — for each thing Terraform creates or configures, there's the
plain-English explanation, where to see/do the same thing by hand in the
GCP Console, and the equivalent `gcloud` command. Knowing the manual path
matters even though Terraform is doing this for us: it's how you sanity-check
that Terraform did what it says it did, and it's your fallback if Terraform
or CI is unavailable during an incident.

Before any of this exists in Terraform state, see **IMPORT_PHASE0.md** — the
two databases must be imported first.

### 1. Point-in-time recovery (PITR) on the production database

**What it is:** Firestore continuously retains a rolling window of change
history, so you can restore the database (or query it) as of any point
within that window — not just from the last scheduled backup. This protects
against the "someone fat-fingered a bad write five minutes ago" class of
incident that a once-a-day backup can't undo cleanly. Enabled only on
`hpb-eos-prod-db` — the sandbox is a disposable, refreshable copy of prod
and doesn't need its own change history.

- **Terraform:** `point_in_time_recovery_enablement` on
  `google_firestore_database.prod` in `firestore.tf`.
- **Console:** Firestore → Databases → `hpb-eos-prod-db` → Disaster recovery
  tab → Point-in-time recovery.
- **gcloud:**
  ```bash
  gcloud firestore databases update --project=hpb-eos-prod \
    --database=hpb-eos-prod-db --enable-pitr
  ```

### 2. Delete protection on both databases

**What it is:** A guardrail that makes `gcloud firestore databases delete`
(or the equivalent Console action) refuse to run against the database while
this setting is on. It does not protect against *data* being deleted
(documents/collections) — only against the whole database being deleted.
Enabled on both `hpb-eos-prod-db` and `hpb-eos-sandbox-db`.

- **Terraform:** `delete_protection_state` on both
  `google_firestore_database` resources in `firestore.tf`.
- **Console:** Firestore → Databases → (database name) → Disaster recovery
  tab → Delete protection.
- **gcloud:**
  ```bash
  gcloud firestore databases update --project=hpb-eos-prod \
    --database=hpb-eos-prod-db --delete-protection
  ```

### 3. Managed backup schedules (daily + weekly) on production

**What it is:** Firestore's own native backup feature (distinct from PITR)
— it takes full snapshots of the database on a schedule and retains them
for a fixed period, independent of anything happening in the live database.
This is the "restore to last Tuesday" tool, as opposed to PITR's "restore to
2:17pm today" tool. Two schedules on `hpb-eos-prod-db`: one daily, one
weekly (Sunday), both retained for 14 weeks — the maximum retention Firestore
currently allows for a backup schedule. The sandbox database intentionally
has **no** backup schedules; it's a refreshable copy of prod, not a source
of truth worth its own backup chain.

- **Terraform:** `google_firestore_backup_schedule.prod_daily` and
  `.prod_weekly` in `firestore.tf`.
- **Console:** Firestore → Databases → `hpb-eos-prod-db` → Backups tab.
- **gcloud:**
  ```bash
  gcloud firestore backups schedules create --project=hpb-eos-prod \
    --database=hpb-eos-prod-db --recurrence=daily --retention=14w

  gcloud firestore backups schedules create --project=hpb-eos-prod \
    --database=hpb-eos-prod-db --recurrence=weekly --day-of-week=sunday \
    --retention=14w
  ```
  (List existing schedules with
  `gcloud firestore backups schedules list --database=hpb-eos-prod-db`.)

### 4. Long-term archive bucket

**What it is:** A Cloud Storage bucket for exports that need to live longer
than Firestore's own backup retention (14 weeks) — currently the weekly
Firestore export (below) and, separately, a weekly Firebase Auth export
written by a Cloud Function. `ARCHIVE` storage class (cheapest per-GB,
priced for data you rarely touch), versioned (so an overwrite doesn't
destroy the previous version), and in the `US` **multi-region**: Cloud
Storage keeps multi-region data in at least two US regions more than 100
miles apart, so a regional problem affecting the databases' `us-east1`
doesn't also take out the backups of them. (A single *other* region such as
`us-central1` is not an option: a `us-east1` Firestore database can only
export to a bucket in `us-east1` or the `US` multi-region — anything else
is rejected with `INVALID_ARGUMENT`, confirmed 2026-09-27.)
Public access is blocked at the bucket level (`public_access_prevention =
"enforced"`).

A 7-year retention policy is set but **unlocked** (`is_locked = false`).
Locking a bucket retention policy is **irreversible** — once locked, the
retention period can only be raised, never lowered or removed, even by the
project owner. This module leaves it unlocked until the client confirms
their actual records retention requirement for this data; locking it is a
one-line follow-up (`is_locked = true`) once that's confirmed, not something
to guess at now.

- **Terraform:** `google_storage_bucket.archive` in `backup.tf`.
- **Console:** Cloud Storage → Buckets → `hpb-eos-prod-archive` (or whatever
  `var.archive_bucket_name` is set to).
- **gcloud:**
  ```bash
  gcloud storage buckets create gs://hpb-eos-prod-archive \
    --project=hpb-eos-prod --location=US \
    --default-storage-class=ARCHIVE --uniform-bucket-level-access \
    --public-access-prevention

  gcloud storage buckets update gs://hpb-eos-prod-archive --versioning

  gcloud storage buckets update gs://hpb-eos-prod-archive \
    --retention-period=7y
  ```

**Bucket IAM (who can write to it):** the Firestore service agent
(`service-580850228782@gcp-sa-firestore.iam.gserviceaccount.com`, which
performs the actual write when a Firestore export runs — not the caller
that triggers it) gets `roles/storage.objectAdmin` on the bucket; the
`eos-backup` service account (below) and the Cloud Functions runtime SA each
get `roles/storage.objectCreator`.

- **Console:** Cloud Storage → Buckets → `hpb-eos-prod-archive` → Permissions
  tab.
- **gcloud:**
  ```bash
  gcloud storage buckets add-iam-policy-binding gs://hpb-eos-prod-archive \
    --member="serviceAccount:service-580850228782@gcp-sa-firestore.iam.gserviceaccount.com" \
    --role="roles/storage.objectAdmin"
  ```

**If bucket-level IAM fails under your credentials:** a principal holding
only `roles/editor` project-wide can sometimes lack the specific permission
to set IAM policy on an individual bucket. If `terraform apply` fails on the
`google_storage_bucket_iam_member` resources with a permission error, set
`archive_iam_at_project_level = true` and re-apply — this grants the same
roles at the *project* level instead (broader: those roles then apply to
every bucket in the project, not just this one, so treat it as a fallback,
not the default).

### 5. Backup service account

**What it is:** A dedicated service account (`eos-backup`) used only for
backup automation — kept separate from the app's runtime service account so
"can export/import Firestore data" isn't a permission the running web app
carries. Granted `roles/datastore.importExportAdmin` at the project level
(needed to kick off a Firestore export) and `roles/storage.objectCreator` on
the archive bucket (to grant the underlying write, mirroring what the
Firestore service agent needs to actually perform it).

- **Terraform:** `google_service_account.backup` in `backup.tf`.
- **Console:** IAM & Admin → Service Accounts → `eos-backup@hpb-eos-prod.iam.gserviceaccount.com`.
- **gcloud:**
  ```bash
  gcloud iam service-accounts create eos-backup \
    --project=hpb-eos-prod --display-name="EOS backup automation"

  gcloud projects add-iam-policy-binding hpb-eos-prod \
    --member="serviceAccount:eos-backup@hpb-eos-prod.iam.gserviceaccount.com" \
    --role="roles/datastore.importExportAdmin"
  ```

### 6. Weekly Firestore export (scheduled Cloud Function)

**What it is:** A second, independent copy of the production data, written
out as a portable export to the archive bucket, on top of (not instead of)
the native backup schedules in §3. Native backups live inside Firestore's
own backup system and are restored via the Firestore backup APIs; an export
is a set of files in GCS that can be imported into *any* Firestore database
(useful for standing up a fresh sandbox from a known-good prod snapshot, or
as a second, storage-independent copy of the data). Runs Sunday 03:00
America/Chicago — matching the time zone convention already used by the
existing scheduled function elsewhere in this project.

**Why a Cloud Function and not a plain Cloud Scheduler HTTP job:** the
original implementation was a Cloud Scheduler job (`eos-firestore-export`)
that POSTed straight to Firestore's `exportDocuments` API with a fixed
request body. A Scheduler job's request body is a static string, so it
can't insert today's date — every weekly run wrote to the same undated
prefix (`gs://hpb-eos-prod-archive/firestore/all_namespaces/...`), and the
second run would have collided with the archive bucket's 7-year retention
policy (retained objects can't be overwritten). That job was **removed
2026-09-27**. The first, undated export it produced (2026-09-27 15:58Z)
can't be deleted while retention holds and remains a valid one-off copy —
see Decisions in `docs/HARDENING_LOG.md`.

Replaced the same day by a scheduled Cloud Function, `exportFirestore`
(`functions/src/export-firestore.ts`, region `us-east1`), which builds a
**dated** prefix at run time —
`gs://hpb-eos-prod-archive/firestore/<YYYY-MM-DD>T<HHMMSS>Z/` — so no two
runs can ever collide, waits for the export operation to complete, and
throws on failure (so a failure is a Cloud Functions error in the logs,
which the "Firestore export (backup) failed" alert in §7 matches
regardless of who/what called the export). Runs as the `eos-backup` service
account (below). Firebase creates the function's own Cloud Scheduler job on
deploy — `firebase-schedule-exportFirestore-us-east1` (location
`us-east1`) — rather than one being hand-authored in Terraform.

- **Terraform:** the function itself is deployed via `firebase deploy`, not
  Terraform. `backup.tf` manages the IAM it needs:
  `google_project_iam_member.backup_log_writer` (`roles/logging.logWriter`
  at the project level — gen2 functions write their own logs),
  `google_cloud_run_v2_service_iam_member.backup_invokes_export_firestore`
  (`roles/run.invoker` on the `exportfirestore` Cloud Run service in
  `us-east1` — gen2 functions run as Cloud Run services under the hood, and
  the function's own Scheduler job invokes it over HTTP as `eos-backup`),
  and `google_service_account_iam_member.backup_sa_deployers`
  (`roles/iam.serviceAccountUser` on `eos-backup`, one binding per principal
  in `var.backup_sa_deployers` — today just the consultant's account,
  needed to deploy a function that runs as `eos-backup`; **temporary**,
  removed once deploys move to a dedicated build service account,
  hardening step 4/5).
- **Console:** Cloud Scheduler → Jobs →
  `firebase-schedule-exportFirestore-us-east1` (location `us-east1`) → ⋮ →
  **Force run** to trigger on demand. Logs: Cloud Run functions →
  `exportFirestore` → Logs.
- **gcloud:**
  ```bash
  # Trigger the scheduled export now, without waiting for Sunday
  gcloud scheduler jobs run firebase-schedule-exportFirestore-us-east1 \
    --location=us-east1 --project=hpb-eos-prod

  # Tail the function's own logs
  gcloud functions logs read exportFirestore \
    --region=us-east1 --project=hpb-eos-prod
  ```

**Deploying it:** `firebase deploy --only functions:exportFirestore
--non-interactive` needs `functions/.env.hpb-eos-prod` (gitignored; sets
`FIRESTORE_DATABASE_ID=hpb-eos-prod-db` and
`ARCHIVE_BUCKET=hpb-eos-prod-archive`, both non-secret) present locally —
without it the CLI can't resolve those params non-interactively.

### 7. Alerting on backup/DR-relevant events

**What it is:** Three log-based alert policies watching Cloud Audit Logs for
events that should never happen silently: a Firestore export failing, a
backup schedule being changed (created/updated/deleted — a signal that the
managed cadence in `firestore.tf` might no longer reflect reality), or a
database's settings being changed or the database itself deleted. All three
notify the same two email addresses (`var.alert_emails`), rate-limited to at
most one notification per hour per policy, auto-closing an open incident
after 7 days of no recurrence.

- **Terraform:** `google_monitoring_notification_channel.email` (for_each
  over `var.alert_emails`) and the three `google_monitoring_alert_policy`
  resources in `monitoring.tf`.
- **Console:** Monitoring → Alerting → Notification channels (to see/add
  email recipients) and Monitoring → Alerting → Policies (to see the three
  policies, their conditions, and their incident history).
- **gcloud:** channels and log-based alert policies are consoles-first
  workflows without a single clean `gcloud` one-liner equivalent (the policy
  JSON is easier to author in the Console's alert-policy JSON editor, or via
  `gcloud alpha monitoring policies create --policy-from-file=policy.json`
  once you've exported the JSON shape from an existing policy with
  `gcloud alpha monitoring policies describe POLICY_ID`).

## Notes on What This Module Does Not Manage

**Firebase Auth configuration:** Firebase Auth provider setup (Google OAuth client, hosted-domain restriction, password policy, etc.) is managed separately via the Firebase console or the gcloud Firebase CLI. The `allowed_domain` variable in this module is documentation/reference only.

**Firestore database creation:** The `hpb-eos-prod-db` and `hpb-eos-sandbox-db` databases already exist and are not *created* by this module — they were provisioned outside Terraform and are **imported** as of Phase 0 backups (see firestore.tf and IMPORT_PHASE0.md). Once imported, this module *does* manage their PITR/delete-protection settings and (for prod) backup schedules — it just never issues the create call for the database resource itself (`deletion_policy = "ABANDON"` on both).

**Cloud Build configuration:** `cloudbuild.yaml` (stored in the repo root) owns build image configuration and deploy steps. This module manages the GCP infrastructure and IAM permissions Cloud Build needs; the build itself is separately defined.

**App-layer configuration:** `NEXT_PUBLIC_*` values (Firebase web config) are baked into the image at build time via cloudbuild.yaml substitutions and are not managed here. The Cloud Run service's *runtime* env **is** managed here since Gate 2 (cloud_run.tf, secrets.tf).

**Secret values:** Secret Manager *versions* (the actual values) are deliberately not managed by this module; see "Secrets (Gate 2)".
