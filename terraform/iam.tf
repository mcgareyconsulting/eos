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

# Firebase Auth admin: firebase-admin's createSessionCookie() (this app's
# session-cookie auth flow, per docs/DEPLOY.md §2) requires this role on the
# calling identity — without it, the ID-token exchange succeeds but session
# cookie creation 500s, so sign-in is broken on a Terraform-only deploy
# without this binding. Narrower than roles/firebase.sdkAdminServiceAgent;
# docs/DEPLOY.md §2 mentions that broader role only as a fallback for
# projects where this narrower one isn't available/permitted — check that
# before switching.
resource "google_project_iam_member" "runtime_firebase_admin" {
  project = var.project_id
  role    = "roles/firebaseauth.admin"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# --- NOTE: Cloud Build deploy service account ---
# cloudbuild.yaml (see repo root) does not specify a custom Cloud Build SA
# (no `serviceAccount:` field / `--service-account` flag on `gcloud builds
# submit`), so manual builds run as whichever SA GCP treats as the
# project's "default" build identity — and which one that is depends on
# when the project enabled cloudbuild.googleapis.com:
#   - Projects that enabled it BEFORE ~April 2024: the legacy Cloud Build
#     SA, <PROJECT_NUMBER>@cloudbuild.gserviceaccount.com.
#   - Projects that enable it AFTER that date — which includes essentially
#     any fresh client GCP project, i.e. this deploy — do NOT get that
#     legacy SA auto-created. Builds instead run as the Compute Engine
#     default SA, <PROJECT_NUMBER>-compute@developer.gserviceaccount.com.
# See docs/DEPLOY.md §6.1 for a `gcloud` snippet that detects which one is
# actually active before granting roles. Whichever SA is acting needs:
#   - roles/run.admin                 (deploy the Cloud Run revision)
#   - roles/iam.serviceAccountUser     (act as the runtime SA below, since
#                                        `gcloud run deploy` attaches it)
#   - roles/artifactregistry.writer    (push images)
# Left unmanaged here (not created as a resource) because granting roles to
# Google-managed default service accounts from a "reviewable footprint"
# module can mask who actually holds prod deploy power; the bank's cloud
# team should explicitly grant + track this, e.g. (substitute whichever SA
# docs/DEPLOY.md §6.1 determines is actually active for this project):
#
# resource "google_project_iam_member" "cloudbuild_run_admin" {
#   project = var.project_id
#   role    = "roles/run.admin"
#   member  = "serviceAccount:REPLACE_WITH_ACTING_BUILD_SA" # legacy: ${data.google_project.this.number}@cloudbuild.gserviceaccount.com; or ${data.google_project.this.number}-compute@developer.gserviceaccount.com
# }
# resource "google_service_account_iam_member" "cloudbuild_act_as_runtime" {
#   service_account_id = google_service_account.runtime.name
#   role                = "roles/iam.serviceAccountUser"
#   member              = "serviceAccount:REPLACE_WITH_ACTING_BUILD_SA"
# }
# resource "google_project_iam_member" "cloudbuild_ar_writer" {
#   project = var.project_id
#   role    = "roles/artifactregistry.writer"
#   member  = "serviceAccount:REPLACE_WITH_ACTING_BUILD_SA"
# }
#
# (would also need: `data "google_project" "this" { project_id = var.project_id }`
# to compute PROJECT_NUMBER if using either default-SA form above.)

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
