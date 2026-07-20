# Dedicated, least-privilege Cloud Run runtime service account. No exported
# JSON keys are created anywhere in this module — Cloud Run attaches this SA
# to the running revision and the app authenticates via Application Default
# Credentials, per docs/DEPLOY.md §2.

# Only consumed by the opt-in Cloud Build deploy-SA grants below, to compute
# the Compute Engine default SA's email (it's project-number-scoped, not
# project-id-scoped).
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

# --- Cloud Build deploy service account grants (opt-in, default OFF) ---
# cloudbuild.yaml does not specify a custom Cloud Build SA, so builds run as
# whichever SA GCP treats as the project's "default" build identity — which
# one depends on when cloudbuild.googleapis.com was enabled on the project:
#   - Enabled BEFORE ~April 2024: the legacy Cloud Build SA,
#     <PROJECT_NUMBER>@cloudbuild.gserviceaccount.com.
#   - Enabled AFTER that date: Google no longer auto-creates that legacy SA;
#     builds instead run as the Compute Engine default SA,
#     <PROJECT_NUMBER>-compute@developer.gserviceaccount.com.
# `apis.tf` in THIS module is what enables cloudbuild.googleapis.com — so on
# any project this module is applied to for the first time (i.e. the actual
# client cutover target, a fresh GCP project), that enablement happens via
# this apply, guaranteeing the Compute Engine default SA case 100% of the
# time. The legacy-SA case can only apply when re-applying against a project
# that already had Cloud Build enabled beforehand (e.g. this repo's existing
# hpb-eos-prod) — see docs/DEPLOY.md §6.1 for that manual fallback.
#
# Left OFF by default so granting deploy power to a Google-managed default
# service account remains a deliberate, tracked decision by the bank's cloud
# team (flip var.grant_cloudbuild_deploy_permissions = true), not something
# silently bundled into every apply of this "reviewable footprint" module.
# Verified end-to-end against a live project during the deploy rehearsal —
# this is the exact grant set that got a real `gcloud builds submit` +
# `gcloud run deploy` working, not a theoretical set.
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

# Needed for the build SA to write Cloud Build's own build logs under
# cloudbuild.yaml's `options.logging: CLOUD_LOGGING_ONLY` — a fresh Compute
# Engine default SA (2024+ projects) has no project-level roles bound by
# default, unlike older projects' legacy auto-granted Editor role.
resource "google_project_iam_member" "cloudbuild_log_writer" {
  count = var.grant_cloudbuild_deploy_permissions ? 1 : 0

  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${local.cloudbuild_sa}"
}

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
