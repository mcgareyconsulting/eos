# APIs required for the current MVP footprint (Cloud Run + Firestore + Auth)
# plus the near-term additions this roadmap already anticipates: the
# audit-log onWrite trigger (cloudfunctions/eventarc) and the future nightly
# BigQuery batch worker (cloudscheduler) — see docs/ROADMAP.md "RESUME HERE".
# secretmanager/iam are included as Tier-0 foundation (least-privilege SAs,
# no exported keys, secrets out of env vars).

locals {
  required_apis = [
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "firestore.googleapis.com",
    "identitytoolkit.googleapis.com",
    "cloudfunctions.googleapis.com",
    "eventarc.googleapis.com",
    "cloudscheduler.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
  ]
}

resource "google_project_service" "required" {
  for_each = toset(local.required_apis)

  project = var.project_id
  service = each.value

  # Leave enabled if this module is ever destroyed — disabling APIs on
  # destroy is rarely what you want against a live client project.
  disable_on_destroy = false
}
