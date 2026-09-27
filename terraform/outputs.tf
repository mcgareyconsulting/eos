output "service_url" {
  description = "Public URL of the Cloud Run service."
  value       = google_cloud_run_v2_service.app.uri
}

output "runtime_service_account_email" {
  description = "Email of the dedicated least-privilege Cloud Run runtime service account (pass as _RUNTIME_SERVICE_ACCOUNT in cloudbuild.yaml substitutions)."
  value       = google_service_account.runtime.email
}

output "artifact_registry_repository" {
  description = "Fully-qualified Artifact Registry repository ID (docker host/project/location/repo)."
  value       = google_artifact_registry_repository.images.id
}

output "archive_bucket_name" {
  description = "Name of the long-term backup/export archive bucket (Firestore exports, Auth exports)."
  value       = google_storage_bucket.archive.name
}

output "backup_service_account_email" {
  description = "Email of the service account used for backup automation (Firestore export scheduler)."
  value       = google_service_account.backup.email
}

