# Gate 2 (secrets and keys): Secret Manager secrets for the Cloud Run runtime.
# Audit ref I-03. See README.md "Secrets (Gate 2)" and docs/SECRETS_RUNBOOK.md.
#
# Terraform creates the secret *containers* and their IAM only. It never
# creates a secret *version*: a google_secret_manager_secret_version resource
# would put the plaintext value into Terraform state (and into plan output),
# which is exactly the exposure this gate removes. Values are added
# out-of-band by an operator:
#
#   printf '%s' "$VALUE" | gcloud secrets versions add <SECRET_ID> \
#     --project=hpb-eos-prod --data-file=-
#
# Console: Security → Secret Manager → <SECRET_ID> → + New version.
#
# !!! Every secret below must have an ENABLED version before the Cloud Run
# !!! change in cloud_run.tf is applied. A revision that references a secret
# !!! with no enabled version fails to start. The precondition on the Cloud
# !!! Run service (backed by the data source at the bottom of this file)
# !!! stops the plan/apply before that happens.

locals {
  # Secret ID == the env var name the app reads, so the mapping in
  # cloud_run.tf is 1:1 and greppable. Secret IDs allow [A-Za-z0-9_-].
  runtime_secrets = toset([
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_TASKS_PULL_SECRET",
    "SIGN_IN_ALLOWLIST",
  ])

  secret_labels = {
    app        = "eos"
    component  = "runtime-env"
    managed-by = "terraform"
  }
}

resource "google_secret_manager_secret" "runtime" {
  for_each = local.runtime_secrets

  project   = var.project_id
  secret_id = each.value
  labels    = local.secret_labels

  replication {
    auto {}
  }

  # Destroying a secret destroys every version (the values) with it and
  # breaks the running service. Rolling back this gate never requires
  # deleting the secrets — see README.md "Rollback".
  deletion_protection = true

  depends_on = [google_project_service.required]
}

# Runtime SA may read each secret's payload — per secret, not project-wide,
# so no other principal gains access through this module and the runtime SA
# gains access to nothing else in Secret Manager.
resource "google_secret_manager_secret_iam_member" "runtime_accessor" {
  for_each = google_secret_manager_secret.runtime

  project   = each.value.project
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

# Metadata-only lookup of each secret's "latest" version, used by the
# precondition on google_cloud_run_v2_service.app. fetch_secret_data = false
# keeps the payload OUT of Terraform state: only name/enabled/create_time are
# read. Reading needs secretmanager.versions.get (not .access) for whoever
# runs plan. If a secret has no versions at all, this read fails the plan
# with a "not found" error — also the intended outcome.
data "google_secret_manager_secret_version" "runtime_latest" {
  for_each = google_secret_manager_secret.runtime

  project           = each.value.project
  secret            = each.value.secret_id
  version           = "latest"
  fetch_secret_data = false
}
