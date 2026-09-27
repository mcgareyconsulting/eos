# Phase 0 backups: import checklist

This module now declares `google_firestore_database.prod` and
`google_firestore_database.sandbox` for two databases that **already exist**
and were **not** created by Terraform. Before the first `terraform apply`
that touches this module, those two resources must be imported into state —
otherwise Terraform will try to *create* them and fail (or, worse, if it
somehow didn't fail, you'd be relying on Terraform reasoning about a
create path for a resource type that behaves very differently on create vs.
update).

Everything else this module adds in Phase 0 (backup schedules, the archive
bucket, the backup service account, the Cloud Scheduler job, the alert
policies) is genuinely new and does not need to be imported — `terraform
apply` creates those normally.

Run these commands, in order, from a checkout of this repo on the
`feat/phase0-backups` branch (or whatever branch/commit has these files),
from the `terraform/` directory.

## 0. Workspace

If this project uses Terraform workspaces, make sure you're on the `prod`
workspace before doing anything below (`terraform workspace show` /
`terraform workspace select prod`). Everything here assumes a single
`hpb-eos-prod` project — do not run these imports against a workspace/state
file that isn't the one backing that project.

## 1. Init

```bash
cd terraform
terraform init
```

(Local state is fine per the existing README convention until the client
provisions a state bucket; if a backend is already configured for this
workspace, `init` will pick it up as usual.)

## 2. Import the two Firestore databases

```bash
terraform import google_firestore_database.prod \
  projects/hpb-eos-prod/databases/hpb-eos-prod-db

terraform import google_firestore_database.sandbox \
  projects/hpb-eos-prod/databases/hpb-eos-sandbox-db
```

Both commands should report `Import successful!`. If either fails with "not
found," double check the project ID and database ID against
`gcloud firestore databases list --project=hpb-eos-prod` before retrying —
do not guess at a different resource ID format.

## 3. Verify state

```bash
terraform state list | grep google_firestore_database
```

Expected output:

```
google_firestore_database.prod
google_firestore_database.sandbox
```

## 4. Plan

```bash
terraform plan
```

### What an acceptable plan looks like

Because PITR and delete protection are currently **disabled** on both live
databases (per the facts this module was written against, verified
2026-09-25), the plan **should** show in-place updates on the two imported
databases:

- `google_firestore_database.prod`: `point_in_time_recovery_enablement` and
  `delete_protection_state` changing to `POINT_IN_TIME_RECOVERY_ENABLED` /
  `DELETE_PROTECTION_ENABLED`. These are in-place updates, not
  replacements — Firestore supports flipping both settings live.
- `google_firestore_database.sandbox`: `delete_protection_state` changing to
  `DELETE_PROTECTION_ENABLED` (PITR should show no change — sandbox is
  already PITR-disabled and this module keeps it that way).

The plan should **also** show new resources being created (this is normal
and expected — nothing to import for these, they're genuinely new):

- `google_firestore_backup_schedule.prod_daily`
- `google_firestore_backup_schedule.prod_weekly`
- `google_storage_bucket.archive`
- `google_service_account.backup`
- `google_project_iam_member.backup_datastore_export_admin`
- `google_storage_bucket_iam_member.firestore_export_writer`
- `google_storage_bucket_iam_member.backup_sa_writer`
- `google_storage_bucket_iam_member.functions_sa_writer`
- `google_cloud_scheduler_job.firestore_export`
- `google_monitoring_notification_channel.email["..."]` (x2)
- `google_monitoring_alert_policy.firestore_export_failed`
- `google_monitoring_alert_policy.backup_schedule_changed`
- `google_monitoring_alert_policy.database_settings_changed`
- New `google_project_service.required` entries for `storage.googleapis.com`,
  `monitoring.googleapis.com`, `logging.googleapis.com` (no-ops if those APIs
  are already enabled on the project — `google_project_service` handles an
  already-enabled API idempotently).

### What is NOT acceptable — stop and investigate

- **Any `-/+` (destroy and recreate) on `google_firestore_database.prod` or
  `.sandbox`.** A replace on either database resource means an attribute
  this config sets doesn't match reality in a way Terraform thinks requires
  recreation (Firestore databases cannot be "recreated" by Terraform in any
  safe sense — `deletion_policy = "ABANDON"` plus `prevent_destroy = true`
  should make this structurally impossible, but if you somehow see it
  proposed, do not apply; stop and re-check `location_id`/`type`, which are
  the classic force-new attributes on this resource).
- **Any bare `-` (destroy) anywhere in this plan.** Nothing in Phase 0
  should destroy an existing resource. If you see one, stop.
- **Changes to attributes this module didn't ask to change** — e.g. if the
  plan proposes changing `concurrency_mode` or `app_engine_integration_mode`
  on either database, that means the `ignore_changes` lifecycle block in
  `firestore.tf` isn't doing what it's supposed to; do not apply until
  that's understood (it may mean the provider version resolved differs from
  what this module was written against — verify with
  `terraform providers schema -json` before proceeding).

If the plan matches the "acceptable" shape above, apply as usual:

```bash
terraform apply
```

## 5. Post-apply sanity check

```bash
terraform state list | grep -E "firestore|backup|archive|scheduler|monitoring"
```

Then spot-check in the console (see README.md "Backups and recovery
(Phase 0)" for exact paths):

- Firestore → Databases → `hpb-eos-prod-db` → shows PITR and delete
  protection both enabled.
- Firestore → Databases → `hpb-eos-prod-db` → Backups → shows a daily and a
  weekly schedule, 14-week retention.
- Cloud Storage → Buckets → `hpb-eos-prod-archive` exists, Archive class,
  versioning on.
- Cloud Scheduler → Jobs → `firebase-schedule-exportFirestore-us-east1` (us-east1, created by the function deploy) exists, next run Sunday
  03:00 America/Chicago.
- Monitoring → Alerting → Policies → three new policies exist and are
  enabled.
