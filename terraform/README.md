# EOS Terraform: GCP Cloud Run Footprint

This directory contains the infrastructure-as-code for the EOS app's Cloud Run deployment on High Plains Bank's GCP project. The footprint is deliberately reviewable, with long-form design rationale documented below and `.tf` files kept focused on resource declarations.

## Overview: Architecture and Structure

**Core footprint (always-on):**
- Cloud Run service for the Next.js app (with least-privilege runtime service account)
- Firestore database (existing "(default)" database, not managed by this module)
- Artifact Registry (Docker repo for build images)
- Cloud Build (handles image builds and deployments via cloudbuild.yaml)
- Firebase Auth with Google sign-in restricted to the `allowed_domain`

**Optional security levers (Tier 1, all default OFF):** Cloud Armor, CMEK, Firestore PITR, Data Access audit logs. See Tier 1 Security Levers section below.

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
- Security lever toggles: `enable_cloud_armor`, `enable_cmek`, `enable_pitr`, `enable_data_access_logs` (all default OFF).

### Outputs

Run `terraform output` to see:
- `service_url`: Public URL of the Cloud Run service.
- `runtime_service_account_email`: Runtime SA email (pass as `_RUNTIME_SERVICE_ACCOUNT` in cloudbuild.yaml).
- `artifact_registry_repository`: Fully-qualified Artifact Registry repository ID.

## Core Resources

### Cloud Run Service (cloud_run.tf)

The app runs as an always-on Cloud Run service. Terraform manages the service configuration (SA, scaling, ingress); image updates are owned by cloudbuild.yaml (`gcloud run deploy` on every build).

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
- `roles/firebaseauth.admin`: Firebase Auth session-cookie creation (required for the app's sign-in flow; without it, ID-token exchange succeeds but session cookie creation 500s, breaking sign-in).

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

## Required APIs (apis.tf)

The module enables the following APIs:
- Core app: `run.googleapis.com`, `cloudbuild.googleapis.com`, `artifactregistry.googleapis.com`, `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `firebase.googleapis.com`.
- Future audit-log onWrite trigger: `cloudfunctions.googleapis.com`, `eventarc.googleapis.com`.
- Future nightly BigQuery batch worker: `cloudscheduler.googleapis.com`.
- Foundation (least-privilege SAs, no exported keys, secrets): `secretmanager.googleapis.com`, `iam.googleapis.com`.

APIs are left enabled if the module is destroyed (safe default for a live client project).

## Tier 1 Security Levers (levers.tf)

All four levers are optional and default OFF; the MVP runs fine without any of them. Each is gated on its own boolean variable. **Ballpark combined cost: ~$40–75/mo** (verify against current GCP pricing before quoting). Tier 0 (least-privilege SAs, no exported keys, Secret Manager, default-deny Firestore rules, domain-restricted auth) is already the baseline in this module and the app itself.

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

### Lever 3: Firestore Point-in-Time Recovery (PITR)

- **Cost:** PITR retains ~7 days of change history; roughly adds the cost of a few extra days of storage on top of normal Firestore storage billing. Verify the exact multiplier against current pricing before quoting.
- **Variable:** `enable_pitr` (default OFF).

**Caveat:** The "(default)" Firestore database already exists (created via the Firebase console) and is not created by this module. There's no `google_firestore_database` resource to attach `point_in_time_recovery_enablement` to without first importing that existing database — importing a database you don't otherwise manage in Terraform (and whose other settings you'd then be responsible for syncing) is a bigger step than "flip a flag."

The module wires the gcloud alternative instead, still gated on the same variable so `terraform apply` is the one on/off switch:

```bash
gcloud firestore databases update --project=<PROJECT_ID> --database='(default)' --enable-pitr
```

To disable PITR manually:

```bash
gcloud firestore databases update --database='(default)' --no-enable-pitr
```

**Note:** `terraform destroy` does NOT run a corresponding disable command automatically (local-exec provisioners have no native destroy-time symmetry without a separate `when = destroy` provisioner, which is intentionally omitted here to avoid silently flipping a data-protection setting).

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

## Notes on What This Module Does Not Manage

**Firebase Auth configuration:** Firebase Auth provider setup (Google OAuth client, hosted-domain restriction, password policy, etc.) is managed separately via the Firebase console or the gcloud Firebase CLI. The `allowed_domain` variable in this module is documentation/reference only.

**Firestore database creation:** The "(default)" Firestore database already exists and is not created by this module (see the PITR and CMEK sections above for why importing it is intentionally avoided).

**Cloud Build configuration:** `cloudbuild.yaml` (stored in the repo root) owns build image configuration and deploy steps. This module manages the GCP infrastructure and IAM permissions Cloud Build needs; the build itself is separately defined.

**App-layer configuration:** Environment variables (NEXT_PUBLIC_* for the frontend, Firebase config, feature flags) are managed separately in cloudbuild.yaml substitutions or Cloud Run's service environment.
