# Phase 0 backups: long-term archive bucket, export automation, and the
# service accounts/IAM that let Firestore and Cloud Functions write to it.
# See README.md "Backups and recovery (Phase 0)" and IMPORT_PHASE0.md.

# Long-term archive bucket. US multi-region: Cloud Storage keeps multi-region
# data redundantly in at least two US regions >=100 miles apart, so a
# regional outage or incident in the database region (us-east1) does not
# take out its backups. This also satisfies Firestore's export rule: a
# us-east1 database can only export to a bucket in us-east1 or the US
# multi-region (a single other region such as us-central1 is rejected with
# INVALID_ARGUMENT — confirmed 2026-09-27).
resource "google_storage_bucket" "archive" {
  project  = var.project_id
  name     = var.archive_bucket_name
  location = "US"

  storage_class               = "ARCHIVE"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  # 7 years, UNLOCKED. Locking a retention policy is irreversible (you can
  # raise the retention period later but can never lower it or remove the
  # lock) — leave unlocked until the client confirms their actual records
  # retention schedule for this data.
  retention_policy {
    retention_period = 220752000 # 7 years, in seconds
    is_locked        = false
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required]
}

# Service account used by the weekly Firestore export (Cloud Scheduler job
# below) and, more broadly, any Phase 0 backup automation.
resource "google_service_account" "backup" {
  project      = var.project_id
  account_id   = "eos-backup"
  display_name = "EOS backup automation"

  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "backup_datastore_export_admin" {
  project = var.project_id
  role    = "roles/datastore.importExportAdmin"
  member  = "serviceAccount:${google_service_account.backup.email}"
}

# --- Archive bucket write access -------------------------------------------
#
# Two principals need to write into the archive bucket:
#   1. The Firestore service agent — Firestore's exportDocuments operation
#      writes directly to GCS as the *Firestore* service agent, not as the
#      caller/OAuth principal that kicks off the export.
#   2. The Cloud Functions runtime SA (var.functions_service_account_email)
#      — a separately authored weekly Firebase Auth export function writes
#      gs://<bucket>/auth/<date>.json under this identity.
#
# Bucket-level IAM (google_storage_bucket_iam_member) is least-privilege and
# the default here. It can fail with a permission-denied error if the
# Terraform-applying principal only holds roles/editor (editor does not
# reliably carry storage.buckets.setIamPolicy in every org policy
# configuration). If that happens, set var.archive_iam_at_project_level =
# true to fall back to project-level grants instead (broader: those roles
# would apply to every bucket in the project, not just this one).

resource "google_storage_bucket_iam_member" "firestore_export_writer" {
  count = var.archive_iam_at_project_level ? 0 : 1

  bucket = google_storage_bucket.archive.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:service-580850228782@gcp-sa-firestore.iam.gserviceaccount.com"
}

resource "google_storage_bucket_iam_member" "backup_sa_writer" {
  count = var.archive_iam_at_project_level ? 0 : 1

  bucket = google_storage_bucket.archive.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.backup.email}"
}

resource "google_storage_bucket_iam_member" "functions_sa_writer" {
  count = var.archive_iam_at_project_level ? 0 : 1

  bucket = google_storage_bucket.archive.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${var.functions_service_account_email}"
}

# Project-level fallback (see comment above). Broader than the bucket-scoped
# grants — only use if bucket-level IAM fails under the applying principal's
# permissions.
resource "google_project_iam_member" "firestore_export_writer_project" {
  count = var.archive_iam_at_project_level ? 1 : 0

  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:service-580850228782@gcp-sa-firestore.iam.gserviceaccount.com"
}

resource "google_project_iam_member" "backup_sa_writer_project" {
  count = var.archive_iam_at_project_level ? 1 : 0

  project = var.project_id
  role    = "roles/storage.objectCreator"
  member  = "serviceAccount:${google_service_account.backup.email}"
}

resource "google_project_iam_member" "functions_sa_writer_project" {
  count = var.archive_iam_at_project_level ? 1 : 0

  project = var.project_id
  role    = "roles/storage.objectCreator"
  member  = "serviceAccount:${var.functions_service_account_email}"
}

# --- Weekly Firestore export -------------------------------------------
#
# Done by the scheduled Cloud Function `exportFirestore`
# (functions/src/export-firestore.ts), Sunday 03:00 America/Chicago, running
# as the eos-backup service account and writing to a DATED prefix
# gs://<archive>/firestore/<stamp>/. The earlier Cloud Scheduler HTTP job was
# removed 2026-09-27: its request body was a fixed string, so every run hit
# the same object names and the second run collided with the bucket's
# retention policy. Firebase creates the function's own Scheduler job
# (`firebase-schedule-exportFirestore-us-east1`) on deploy.

# Gen2 functions need to write their own logs.
resource "google_project_iam_member" "backup_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.backup.email}"
}

# Whoever deploys `exportFirestore` must be allowed to attach eos-backup as
# its runtime identity (iam.serviceAccounts.actAs). Today that is the
# consultant's account; this grant is replaced by the build service account
# when deploys move to Cloud Build (hardening step 4/5).
resource "google_service_account_iam_member" "backup_sa_deployers" {
  for_each = toset(var.backup_sa_deployers)

  service_account_id = google_service_account.backup.name
  role               = "roles/iam.serviceAccountUser"
  member             = each.value
}

# The function's Scheduler job (created by Firebase on deploy) invokes the
# function over HTTP with an OIDC token minted for eos-backup. The compute
# default SA gets run.invoker project-wide; eos-backup gets it only on this
# one service. The service itself is Firebase-managed, so it is referenced
# by name rather than as a Terraform resource.
resource "google_cloud_run_v2_service_iam_member" "backup_invokes_export_firestore" {
  project  = var.project_id
  location = "us-east1"
  name     = "exportfirestore"
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.backup.email}"
}
