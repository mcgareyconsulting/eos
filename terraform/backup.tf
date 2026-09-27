# Phase 0 backups: long-term archive bucket, export automation, and the
# service accounts/IAM that let Firestore and Cloud Functions write to it.
# See README.md "Backups and recovery (Phase 0)" and IMPORT_PHASE0.md.

# Long-term archive bucket. Deliberately a different region (US-CENTRAL1)
# from the Firestore databases (us-east1) so a regional outage or incident
# affecting the database region doesn't also take out its backups.
resource "google_storage_bucket" "archive" {
  project  = var.project_id
  name     = var.archive_bucket_name
  location = "US-CENTRAL1"

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
# Cloud Scheduler → Firestore Admin API exportDocuments, direct HTTP call
# with an OAuth token (no Cloud Function/Cloud Run hop needed for this one).
# Sunday 03:00 America/Chicago — matches the existing scheduled function's
# time zone convention elsewhere in this project.
resource "google_cloud_scheduler_job" "firestore_export" {
  project  = var.project_id
  region   = "us-central1"
  name     = "eos-firestore-export"
  schedule = "0 3 * * 0"

  time_zone = "America/Chicago"

  http_target {
    uri         = "https://firestore.googleapis.com/v1/projects/${var.project_id}/databases/${var.prod_database_id}:exportDocuments"
    http_method = "POST"

    headers = {
      "Content-Type" = "application/json"
    }

    body = base64encode(jsonencode({
      outputUriPrefix = "gs://${google_storage_bucket.archive.name}/firestore"
    }))

    oauth_token {
      service_account_email = google_service_account.backup.email
      scope                 = "https://www.googleapis.com/auth/datastore"
    }
  }

  retry_config {
    retry_count = 3
  }

  depends_on = [google_project_service.required]
}
