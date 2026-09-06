# Docker repository for app images. See README.md "Artifact Registry" for CMEK notes.

resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_repo
  format        = "DOCKER"
  description   = "EOS app images"

  # CMEK lever (levers.tf, gated on var.enable_cmek). Null when off.
  #
  # !!! kms_key_name is IMMUTABLE on an Artifact Registry repository !!!
  # Decide on CMEK before first apply; enabling after creation forces destroy/recreate.
  kms_key_name = var.enable_cmek ? google_kms_crypto_key.app[0].id : null

  depends_on = [
    google_project_service.required,
    google_kms_crypto_key_iam_member.artifact_registry_cmek,
  ]
}
