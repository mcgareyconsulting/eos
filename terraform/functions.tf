# Dedicated runtime identity for the Cloud Functions (I-10 in
# docs/SECURITY_AUDIT_2026-09-08.md). Until this existed every function ran
# as the Compute Engine default SA, which holds roles/editor on the project.
# functions/src/global-options.ts sets this SA (plus internal-only ingress)
# as the default for every function; exportFirestore and
# checkBackupFreshness override it with eos-backup (backup.tf).
#
# Functions running as eos-functions, and what they touch:
#   auditTopLevelWrites, auditEffectivenessScoreWrites (Firestore/Eventarc
#     triggers) — append rows to audit_log in hpb-eos-prod-db.
#   archiveStaleTodos (scheduler) — read/update to-dos, issues, headlines,
#     rocks; write activity rows.
#   exportAuthUsers (scheduler) — list Firebase Auth users; write
#     gs://<archive>/auth/<date>.json.

resource "google_service_account" "functions" {
  project      = var.project_id
  account_id   = "eos-functions"
  display_name = "EOS Cloud Functions runtime"

  depends_on = [google_project_service.required]
}

# Firestore read/write (audit_log rows; archive sweep). Same role the app's
# runtime SA uses (iam.tf).
resource "google_project_iam_member" "functions_datastore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.functions.email}"
}

# Gen2 functions need to write their own logs.
resource "google_project_iam_member" "functions_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.functions.email}"
}

# exportAuthUsers: auth.listUsers() only. Viewer, not admin — it never
# writes to Firebase Auth.
resource "google_project_iam_member" "functions_firebaseauth_viewer" {
  project = var.project_id
  role    = "roles/firebaseauth.viewer"
  member  = "serviceAccount:${google_service_account.functions.email}"
}

# exportAuthUsers writes gs://<archive>/auth/<date>.json. Create-only, the
# same grant var.functions_service_account_email holds in backup.tf (which
# keeps pointing at the compute default SA until the cutover is verified —
# retiring that grant is a follow-up, not part of this additions-only apply).
resource "google_storage_bucket_iam_member" "functions_eos_sa_writer" {
  count = var.archive_iam_at_project_level ? 0 : 1

  bucket = google_storage_bucket.archive.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.functions.email}"
}

resource "google_project_iam_member" "functions_eos_sa_writer_project" {
  count = var.archive_iam_at_project_level ? 1 : 0

  project = var.project_id
  role    = "roles/storage.objectCreator"
  member  = "serviceAccount:${google_service_account.functions.email}"
}

# --- Trigger identity ------------------------------------------------------
#
# Firebase uses the runtime SA as the trigger identity too: the Firestore
# Eventarc triggers get eventTrigger.serviceAccountEmail = this SA, and the
# Scheduler jobs mint their OIDC token for it (firebase-tools
# cloudfunctionsv2.ts / cloudscheduler.ts). So this SA must be allowed to
# receive Eventarc events and to invoke its own Cloud Run services.

# Required on the trigger SA for Eventarc to deliver Firestore events
# (Cloud Run "Create triggers from Firestore events" docs).
resource "google_project_iam_member" "functions_eventarc_receiver" {
  project = var.project_id
  role    = "roles/eventarc.eventReceiver"
  member  = "serviceAccount:${google_service_account.functions.email}"
}

# run.invoker on the four services only (not project-wide, which would also
# cover the app's Cloud Run service). The services are Firebase-managed, so
# they are referenced by name like backup.tf does. For the two scheduled
# functions Firebase also sets this binding itself on deploy; the Eventarc
# triggered ones get no invoker binding from Firebase, so these are what make
# the audit triggers work. Without it the trigger is created and looks
# healthy, but every delivery fails "The request was not authenticated."
resource "google_cloud_run_v2_service_iam_member" "functions_invoke_self" {
  for_each = toset([
    "audittoplevelwrites",
    "auditeffectivenessscorewrites",
    "archivestaletodos",
    "exportauthusers",
  ])

  project  = var.project_id
  location = "us-east1"
  name     = each.value
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.functions.email}"
}

# TEMPORARY: whoever deploys the functions must be allowed to attach
# eos-functions as their runtime identity (iam.serviceAccounts.actAs). Today
# that is the consultant's account; replace with the build service account
# when deploys move to Cloud Build (audit step 12), same as
# backup_sa_deployers in backup.tf.
resource "google_service_account_iam_member" "functions_sa_deployers" {
  for_each = toset(var.functions_sa_deployers)

  service_account_id = google_service_account.functions.name
  role               = "roles/iam.serviceAccountUser"
  member             = each.value
}
