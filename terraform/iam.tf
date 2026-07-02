# Dedicated, least-privilege Cloud Run runtime service account. No exported
# JSON keys are created anywhere in this module — Cloud Run attaches this SA
# to the running revision and the app authenticates via Application Default
# Credentials, per docs/DEPLOY.md §2.

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

# Cloud Logging writer so app logs land in Cloud Logging (Cloud Run grants
# this to its default SA automatically, but this runtime SA is custom so it
# needs it explicitly).
resource "google_project_iam_member" "runtime_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# --- NOTE: Firebase Admin role for the runtime SA ---
# docs/DEPLOY.md §2 also grants roles/firebase.sdkAdminServiceAgent (or the
# narrower roles/firebaseauth.admin) for session verification / user
# management via firebase-admin. Deliberately left out of this module: which
# role is actually available/permitted varies by project, and DEPLOY.md
# already flags "check what's actually available/permitted in this project
# and prefer the narrower role" as a manual step. Add the binding here once
# confirmed:
#
# resource "google_project_iam_member" "runtime_firebase_admin" {
#   project = var.project_id
#   role    = "roles/firebaseauth.admin" # narrower alternative to sdkAdminServiceAgent
#   member  = "serviceAccount:${google_service_account.runtime.email}"
# }

# --- NOTE: Cloud Build deploy service account ---
# cloudbuild.yaml (see repo root) does not specify a custom Cloud Build SA,
# so builds run as the project's default Cloud Build SA
# (<PROJECT_NUMBER>@cloudbuild.gserviceaccount.com). For `gcloud builds
# submit` to build/push/deploy per cloudbuild.yaml, that SA needs:
#   - roles/run.admin                 (deploy the Cloud Run revision)
#   - roles/iam.serviceAccountUser     (act as the runtime SA below, since
#                                        `gcloud run deploy` attaches it)
#   - roles/artifactregistry.writer    (push images)
# Left unmanaged here (not created as a resource) because granting roles to
# Google-managed default service accounts from a "reviewable footprint"
# module can mask who actually holds prod deploy power; the bank's cloud
# team should explicitly grant + track this, e.g.:
#
# resource "google_project_iam_member" "cloudbuild_run_admin" {
#   project = var.project_id
#   role    = "roles/run.admin"
#   member  = "serviceAccount:${data.google_project.this.number}@cloudbuild.gserviceaccount.com"
# }
# resource "google_service_account_iam_member" "cloudbuild_act_as_runtime" {
#   service_account_id = google_service_account.runtime.name
#   role                = "roles/iam.serviceAccountUser"
#   member              = "serviceAccount:${data.google_project.this.number}@cloudbuild.gserviceaccount.com"
# }
# resource "google_project_iam_member" "cloudbuild_ar_writer" {
#   project = var.project_id
#   role    = "roles/artifactregistry.writer"
#   member  = "serviceAccount:${data.google_project.this.number}@cloudbuild.gserviceaccount.com"
# }
#
# (would also need: `data "google_project" "this" { project_id = var.project_id }`)

# --- Org policy: constraints/iam.disableServiceAccountKeyCreation ---
# Bans creation of exported SA keys org-wide. Free, high-signal for a bank
# security review (this repo already avoids exported keys per docs/DEPLOY.md
# §2 — this constraint makes that enforced, not just convention). Left
# commented because:
#   1. It requires org-level `roles/orgpolicy.policyAdmin` (or Org Policy
#      Administrator), not just project owner — likely outside a
#      project-scoped consultant IAM grant.
#   2. Applying it at the org affects every project in the org, not just
#      this one — a call the client's cloud team should make deliberately.
# If the client wants it, either they apply the gcloud equivalent:
#   gcloud resource-manager org-policies enable-enforce \
#     constraints/iam.disableServiceAccountKeyCreation --organization=ORG_ID
# or uncomment below with their org ID (would also need an `org_id` variable
# added to variables.tf):
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
