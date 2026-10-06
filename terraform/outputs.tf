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

# Gate 2. Names/IDs only: no output in this module carries a secret value
# (secret versions are not managed by Terraform at all; see secrets.tf).
output "runtime_secret_ids" {
  description = "Secret Manager secret IDs mounted into the Cloud Run service as env vars (values are added out-of-band; see docs/SECRETS_RUNBOOK.md)."
  value       = sort([for s in google_secret_manager_secret.runtime : s.secret_id])
}

output "tokens_kms_key_id" {
  description = "Full resource ID of the Cloud KMS key for application-level encryption of Google refresh tokens (kms.tf)."
  value       = google_kms_crypto_key.eos_tokens.id
}


output "custom_domain_dns_records" {
  description = "DNS records the bank must add for var.custom_domain (domain.tf). Empty until the mapping exists; may take a minute after apply to populate (re-run `terraform refresh`)."
  value = var.custom_domain == "" ? [] : [
    for r in try(google_cloud_run_domain_mapping.app[0].status[0].resource_records, []) :
    { name = r.name, type = r.type, rrdata = r.rrdata }
  ]
}
