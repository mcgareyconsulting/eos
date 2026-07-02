# EOS — Terraform (Cloud Run footprint)

Codifies the manual runbook in `../docs/DEPLOY.md` as reviewable-as-code
infrastructure for the High Plains Bank GCP project. Single flat root
module, no submodules — small enough footprint that module splitting would
just add indirection for reviewers.

## What this manages

- Required project APIs (`apis.tf`)
- Dedicated least-privilege Cloud Run runtime service account + IAM
  bindings (`iam.tf`)
- Artifact Registry Docker repo (`artifact_registry.tf`)
- The Cloud Run service *configuration* — SA, scaling, ingress, invoker
  binding (`cloud_run.tf`)
- Optional Tier 1 security levers, each off by default (`levers.tf`)
- Outputs for wiring into `cloudbuild.yaml` / DNS / docs (`outputs.tf`)
- A **commented skeleton** for the future nightly BigQuery batch worker,
  blocked on client conventions (`scheduler.tf`)

## What is deliberately NOT managed here

- **Firebase Auth provider configuration** (enabling Google sign-in,
  authorized domains, hosted-domain restriction). Firebase Auth setup is
  done in the Firebase Console — see `../docs/DEPLOY.md` §4. Terraform has
  a `google_identity_platform_*` resource family that *can* manage some of
  this, but it isn't wired up here; the console flow is the source of truth
  today.
- **`firestore.rules` / `firestore.indexes.json` deploys.** These deploy via
  the `firebase` CLI (`firebase deploy --only firestore:rules,firestore:indexes`),
  independent of this module and of app deploys — see `../docs/DEPLOY.md`
  §3. This module enables the Firestore API and grants the runtime SA
  `roles/datastore.user`, but does not touch rules/indexes content.
- **Application deploys (image builds/pushes/`gcloud run deploy`).** Those
  are owned by `../cloudbuild.yaml`, triggered per `../docs/DEPLOY.md` §5.
  The `google_cloud_run_v2_service` resource here manages the *service
  shape* (SA, scaling, ingress) with `lifecycle { ignore_changes = [...] }`
  on the image, specifically so Terraform and Cloud Build don't fight over
  the running image tag.
- **Custom domain mapping** (`../docs/DEPLOY.md` §6) — not yet in this
  module; add a `google_cloud_run_domain_mapping` resource if/when wanted.
- **BigQuery datasets/tables for the nightly sync worker** — blocked on
  client BigQuery conventions (dataset naming, region, partitioning, PII
  handling, retention — see `../docs/ROADMAP.md`). `scheduler.tf` is a
  commented skeleton only.
- **The audit-log `onWrite` Cloud Function** (captures all Firestore writes
  into an append-only `audit_log` collection, per the ROADMAP's decided
  Option 2 design) — not yet built or represented here; APIs it needs
  (`cloudfunctions`, `eventarc`) are already enabled in `apis.tf` so this
  module doesn't block that follow-up work.

## Prerequisites

- Terraform >= 1.7 (`versions.tf` pins the provider; developed/validated
  against Terraform 1.15 and `hashicorp/google` ~> 6.0).
- `gcloud` authenticated with permissions to create the resources below in
  the target project (Editor, or a narrower custom role covering IAM,
  Cloud Run, Artifact Registry, service usage, and — only if a Tier 1 lever
  is enabled — KMS, Compute (Cloud Armor), and audit config).
- The target GCP project already exists and billing is enabled (this
  module does not create the project itself).
- If any Tier 1 lever needing `local-exec` (PITR, see below) is enabled,
  `gcloud` must also be installed and authenticated in whatever environment
  runs `terraform apply` (a human's laptop or a CI runner with `gcloud`
  available) — not just have valid Application Default Credentials for the
  Terraform Google provider.

## Backend setup (remote state)

`versions.tf` ships with the `backend "gcs"` block **commented out** so this
applies cleanly with local state during initial review. Before using this
for real:

1. Have the client provision a dedicated GCS bucket for Terraform state
   (versioning enabled, uniform bucket-level access, restricted IAM —
   ideally not the same bucket as any app data).
2. Uncomment the `backend "gcs"` block in `versions.tf` and fill in the
   bucket name.
3. Run `terraform init -migrate-state` to move from local state to the
   bucket.

## Usage

```bash
cd terraform
terraform init
terraform plan -var="project_id=<GCP_PROJECT_ID>"
terraform apply -var="project_id=<GCP_PROJECT_ID>"
```

Or create a `terraform.tfvars` (gitignored, see `../.gitignore`) instead of
passing `-var` each time:

```hcl
project_id = "<GCP_PROJECT_ID>"
# region        = "us-central1"  # default shown
# service_name  = "eos"          # default shown
# artifact_repo = "eos"          # default shown
```

After first apply, wire the outputs into the deploy pipeline:

```bash
terraform output runtime_service_account_email
# -> pass as _RUNTIME_SERVICE_ACCOUNT in the cloudbuild.yaml substitutions,
#    see ../docs/DEPLOY.md §5
```

Quality gates this module is validated against: `terraform fmt -check` and
`terraform validate` both pass as of this writing (`hashicorp/google` v6.50.0
via `~> 6.0`). Re-run both after any edits, especially to the intentionally
commented-out blocks if you ever uncomment them.

## Security levers — what each flag costs and buys

All default `false`. None are required for the MVP deploy; the app runs
identically without any of them, matching `../docs/DEPLOY.md`'s "Security
levers (optional, flip on as needed)" table. **Dollar figures below are
ballparks pulled from `../docs/ROADMAP.md` Pass 10 — verify against current
GCP pricing before quoting to the client.**

| Flag | Buys | Ballpark cost | Notes |
|---|---|---|---|
| `enable_cloud_armor` | WAF / DDoS / IP-allowlisting in front of the app | ~$5/mo policy + ~$1/mo/rule + per-request eval, plus the LB itself (~$18-25/mo) — Tier 1 total ~$40-75/mo across all levers combined | **Needs an external HTTPS Load Balancer in front of Cloud Run** (serverless NEG + backend service + URL map + proxy + forwarding rule). That LB is *not* built by this module yet — see the `TODO` in `levers.tf`. Enabling this flag alone creates a standalone policy with no effect until an LB exists to attach it to. |
| `enable_cmek` | Customer-managed encryption keys (Cloud KMS) | ~$0.06/key/mo + ~$0.03/10k crypto ops — rounding error next to Armor/LB | Wired into Artifact Registry (`kms_key_name`) today. Firestore CMEK is **not** wired here — the "(default)" database already exists (created via Firebase Console) and isn't a Terraform-managed resource in this module; see the caveat in `levers.tf`. |
| `enable_pitr` | Firestore point-in-time recovery (~7 days of change history) | Roughly a few extra days of storage cost on top of normal Firestore billing | Implemented via a `null_resource` + `local-exec` calling `gcloud firestore databases update --enable-pitr`, **not** the native Terraform attribute — because the "(default)" database is pre-existing/Firebase-console-managed and adopting it into Terraform would require an import first. Toggling the flag back to `false` does **not** auto-disable PITR (see the comment in `levers.tf`); disable manually via `gcloud firestore databases update --database='(default)' --no-enable-pitr`. |
| `enable_data_access_logs` | Data Access audit logs (every Firestore/Datastore read+write logged) | No separate enablement fee; Cloud Logging ingestion/storage on the resulting volume — can be nontrivial under read-heavy load | Implemented as `google_project_iam_audit_config` for `datastore.googleapis.com`, `DATA_READ` + `DATA_WRITE`. Recommend a short trial to see actual log volume/cost before committing long-term. |
| *(no flag — comment-only)* | VPC Service Controls perimeter around Firestore/BigQuery | $0 direct GCP cost; real cost is design/ops effort | Org-level Access Context Manager work (`google_access_context_manager_service_perimeter` + an org-level access policy), not a per-project toggle. See the comment block at the bottom of `levers.tf`. Recommend scoping as a separate follow-up once BigQuery conventions land, not bundled into this module. |

Also documented but intentionally **left commented, not gated by a flag**,
in `iam.tf`:

- **`constraints/iam.disableServiceAccountKeyCreation` org policy** — free,
  high-signal for a bank (bans exported SA keys org-wide, enforcing what
  this module already does by convention). Left commented because it needs
  org-level `roles/orgpolicy.policyAdmin` (likely outside a project-scoped
  consultant grant) and affects every project in the org, not just this
  one — a call for the client's cloud team to make deliberately.
- **Cloud Build deploy SA role grants** (`roles/run.admin`,
  `roles/iam.serviceAccountUser` on the runtime SA,
  `roles/artifactregistry.writer`) needed for `cloudbuild.yaml` to actually
  deploy. Left commented/unmanaged so granting deploy power to the default
  Cloud Build service account is an explicit, tracked decision by the
  client's cloud team rather than something bundled into this "reviewable
  footprint" module.

## Things flagged as needing client input

- **State backend bucket name/location** (see "Backend setup" above).
- **`org_id`** — not currently a variable; only needed if the
  `disableServiceAccountKeyCreation` org policy in `iam.tf` is ever
  uncommented.
- **Cloud Armor**: whether the bank actually wants an external HTTPS LB in
  front of Cloud Run (meaningfully larger footprint than the rest of this
  module) — see the scope TODO in `levers.tf`.
- **Firestore PITR / CMEK on Firestore**: confirm whether the client wants
  the existing "(default)" database formally imported into Terraform
  management, versus continuing to treat it as console/gcloud-managed.
- **`min_instances` / `max_instances`**: current defaults (`0` / `2`) are
  placeholders — no traffic/cost target has come from the client yet.
- **Nightly BigQuery worker** (`scheduler.tf`): fully blocked on BigQuery
  dataset naming, region, partitioning standard, PII handling, retention,
  and reader access conventions from the client's Jack Henry → BigQuery
  migration — see `../docs/ROADMAP.md`.
