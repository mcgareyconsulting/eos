# Docker repo for app images (matches _REPO in cloudbuild.yaml and
# docs/DEPLOY.md §1).

resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_repo
  format        = "DOCKER"
  description   = "EOS app images"

  # CMEK lever (levers.tf, gated on var.enable_cmek). Null when the lever is
  # off, which leaves Artifact Registry on Google-managed encryption
  # (the default, zero-config option).
  kms_key_name = var.enable_cmek ? google_kms_crypto_key.app[0].id : null

  depends_on = [google_project_service.required]
}
