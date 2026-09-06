# Dedicated, least-privilege Cloud Run runtime service account. App authenticates via ADC.
# No exported JSON keys. See README.md "Service Accounts and IAM".

data "google_project" "this" {
  project_id = var.project_id
}

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "${var.service_name}-runtime"
  display_name = "${var.service_name} Cloud Run runtime"

  depends_on = [google_project_service.required]
}

# Firestore read/write for the app.
resource "google_project_iam_member" "runtime_datastore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# Cloud Logging writer for app logs (custom SA needs explicit grant).
resource "google_project_iam_member" "runtime_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# Firebase Auth admin for session-cookie creation. Required for sign-in flow.
# Without it, session cookie creation 500s and sign-in breaks.
resource "google_project_iam_member" "runtime_firebase_admin" {
  project = var.project_id
  role    = "roles/firebaseauth.admin"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# Cloud Build deploy service account grants (opt-in, default OFF).
# See README.md "Cloud Build Deploy Service Account Grants" for SA identity details.
locals {
  cloudbuild_sa = "${data.google_project.this.number}-compute@developer.gserviceaccount.com"
}

resource "google_project_iam_member" "cloudbuild_run_admin" {
  count = var.grant_cloudbuild_deploy_permissions ? 1 : 0

  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${local.cloudbuild_sa}"
}

resource "google_service_account_iam_member" "cloudbuild_act_as_runtime" {
  count = var.grant_cloudbuild_deploy_permissions ? 1 : 0

  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${local.cloudbuild_sa}"
}

resource "google_project_iam_member" "cloudbuild_ar_writer" {
  count = var.grant_cloudbuild_deploy_permissions ? 1 : 0

  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${local.cloudbuild_sa}"
}

# Cloud Build log writer (needed on 2024+ Compute Engine default SA).
resource "google_project_iam_member" "cloudbuild_log_writer" {
  count = var.grant_cloudbuild_deploy_permissions ? 1 : 0

  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${local.cloudbuild_sa}"
}

# Org policy: disable service account key creation (commented). See README.md.
# Requires org-level roles/orgpolicy.policyAdmin; affects entire org, not just project.
#
# resource "google_org_policy_policy" "disable_sa_key_creation" {
#   name   = "organizations/${var.org_id}/policies/iam.disableServiceAccountKeyCreation"
#   parent = "organizations/${var.org_id}"
#
#   spec {
#     rules {
#       enforce = "TRUE"
#     }
#   }
# }
