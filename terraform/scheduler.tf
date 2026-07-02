# Future nightly BigQuery batch worker (Firestore -> BigQuery consolidation
# warehouse). See docs/ROADMAP.md "Chosen direction - nightly batch worker
# (DECIDED)" and "RESUME HERE" item 4.
#
# STATUS: BLOCKED on client BigQuery conventions (dataset naming, region,
# partitioning standards, PII handling, retention, reader access — see
# ROADMAP "Schema mapping: BLOCKED on client"). Nothing in this file is
# active; it's a skeleton to fill in once those conventions arrive, so the
# shape of the eventual change is visible for review now rather than a
# surprise later.
#
# Decided design (from ROADMAP, to preserve once unblocked):
#   - Run cadence: nightly (decoupled from analytics grain, which is mostly
#     weekly - cost delta nightly-vs-weekly is noise at this scale).
#   - Date-partitioned append, not overwrite: each run appends current state
#     tagged with a `snapshot_date` partition column per collection.
#   - Collections to mirror: organizations, users, teams, team_members,
#     rocks + milestones, todos, issues, headlines, scorecard metrics/values,
#     meetings, plus the append-only `audit_log` collection (see the
#     separate onWrite-trigger audit log work, ROADMAP item 2 - independent
#     of this worker). Skip ephemeral presence/segment-cursor state.
#   - Per-table shape: stable scalar columns + `snapshot_date` partition +
#     a `raw` JSON column to absorb schema drift.
#   - Mechanics: Cloud Scheduler -> Cloud Run job -> BigQuery load jobs,
#     idempotent, partitioned by date.

# --- Cloud Run job: the nightly worker container ---
# Runs to completion (unlike the always-on `google_cloud_run_v2_service` in
# cloud_run.tf), reads current Firestore collection state, writes
# date-partitioned rows into BigQuery.
#
# resource "google_cloud_run_v2_job" "bq_nightly_sync" {
#   project  = var.project_id
#   name     = "${var.service_name}-bq-nightly-sync"
#   location = var.region
#
#   template {
#     template {
#       service_account = google_service_account.runtime.email # or a
#       # narrower dedicated SA scoped to datastore.viewer + bigquery.dataEditor
#       # on only the target dataset, once that dataset exists.
#
#       containers {
#         image = "REPLACE_ME" # worker image, once built
#         # env {
#         #   name  = "BQ_DATASET"
#         #   value = "REPLACE_ME" # per client BigQuery conventions, BLOCKED
#         # }
#       }
#     }
#   }
# }

# --- Cloud Scheduler: nightly trigger ---
# Invokes the Cloud Run job on a nightly cron schedule via OIDC-authenticated
# HTTP call to the Cloud Run Jobs API (or `google_cloud_scheduler_job` with an
# `http_target` pointed at the job's run URL - exact invocation shape depends
# on the provider version's support for triggering Cloud Run *jobs*
# specifically, verify against the pinned provider docs when unblocking
# this).
#
# resource "google_cloud_scheduler_job" "bq_nightly_sync_trigger" {
#   project  = var.project_id
#   region   = var.region
#   name     = "${var.service_name}-bq-nightly-sync-trigger"
#   schedule = "0 2 * * *" # 02:00 daily, adjust to client timezone/preference
#   time_zone = "America/Chicago" # verify against HPB's actual timezone
#
#   http_target {
#     http_method = "POST"
#     uri         = "REPLACE_ME" # Cloud Run Jobs "run" API endpoint
#
#     oauth_token {
#       service_account_email = google_service_account.runtime.email
#     }
#   }
#
#   depends_on = [google_project_service.required]
# }
