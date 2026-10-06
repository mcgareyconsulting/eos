variable "project_id" {
  description = "GCP project ID that hosts the EOS app (High Plains Bank project)."
  type        = string
}

variable "region" {
  description = "Primary region for Cloud Run, Artifact Registry, etc."
  type        = string
  default     = "us-east1"
}

variable "service_name" {
  description = "Cloud Run service name (matches _SERVICE in cloudbuild.yaml)."
  type        = string
  default     = "eos"
}

variable "artifact_repo" {
  description = "Artifact Registry (Docker) repository name (matches _REPO in cloudbuild.yaml)."
  type        = string
  default     = "eos"
}

variable "allowed_domain" {
  description = <<-EOT
    Workspace hosted domain allowed to sign in (Firebase Auth Google
    sign-in restriction). Documentation/reference only — this repo's
    Firebase Auth *provider* configuration is not managed by Terraform
    (see docs/DEPLOY.md §5 and terraform/README.md "not managed here").
    Mirrors NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN in cloudbuild.yaml.
  EOT
  type        = string
  default     = "highplainsbank.com"
}

variable "min_instances" {
  description = "Cloud Run minimum instance count. Not yet specified by the client — verify against expected traffic/cost tolerance before applying in prod."
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Cloud Run maximum instance count. Not yet specified by the client — verify against expected traffic/cost tolerance before applying in prod."
  type        = number
  default     = 2
}

variable "grant_cloudbuild_deploy_permissions" {
  description = <<-EOT
    Grant the Cloud Build deploy identity (Compute Engine default SA on any
    fresh project this module is first applied to — see iam.tf) the roles
    cloudbuild.yaml needs to actually deploy: roles/run.admin,
    roles/artifactregistry.writer, roles/iam.serviceAccountUser (to act as
    the runtime SA), and roles/logging.logWriter. Default OFF so this stays a
    deliberate decision by the bank's cloud team rather than something
    bundled into every apply. Without it, `terraform apply` succeeds but the
    first `gcloud builds submit` fails until these are granted manually
    (see docs/DEPLOY.md §6.1).
  EOT
  type        = bool
  default     = false
}

# Tier 1 optional security levers (all default OFF). See levers.tf and README.md.

variable "enable_cloud_armor" {
  description = "Provision a Cloud Armor security policy (WAF/DDoS). Requires a Load Balancer in front of Cloud Run — see levers.tf for scope notes. Ballpark ~$5-10/mo policy + LB cost (~$18-25/mo)."
  type        = bool
  default     = false
}

variable "enable_cmek" {
  description = "Provision a Cloud KMS keyring/key for customer-managed encryption. Ballpark ~$0.06/key/mo + operations; see levers.tf for what it does and does not cover."
  type        = bool
  default     = false
}

variable "enable_data_access_logs" {
  description = "Enable Data Access audit logs for the Firestore/Datastore API. Ballpark: standard Cloud Logging ingestion/storage rates on the resulting log volume (can be nontrivial under read-heavy load)."
  type        = bool
  default     = false
}

# Phase 0: backups (firestore.tf, backup.tf, monitoring.tf). See README.md
# "Backups and recovery (Phase 0)".

variable "prod_database_id" {
  description = "Firestore database ID for production (Native mode, us-east1). Pre-existing; imported, not created — see IMPORT_PHASE0.md."
  type        = string
  default     = "hpb-eos-prod-db"
}

variable "sandbox_database_id" {
  description = "Firestore database ID for the sandbox/refreshable-copy database (Native mode, us-east1). Pre-existing; imported, not created — see IMPORT_PHASE0.md."
  type        = string
  default     = "hpb-eos-sandbox-db"
}

variable "archive_bucket_name" {
  description = "GCS bucket name for long-term Firestore/Auth export archives (Archive storage class, versioned, locationally separate from the database region)."
  type        = string
  default     = "hpb-eos-prod-archive"
}

variable "archive_iam_at_project_level" {
  description = <<-EOT
    Fallback for granting archive-bucket write access. Bucket-level IAM
    (google_storage_bucket_iam_member) can fail if the Terraform-applying
    principal only holds roles/editor (editor lacks
    resourcemanager.projects.setIamPolicy at the bucket-policy level in some
    org setups). Default false = grant at the bucket (least privilege). Set
    true to instead grant roles/storage.objectAdmin /
    roles/storage.objectCreator at the *project* level for the same
    principals — broader, but works under editor-only credentials. See
    README.md "Backups and recovery (Phase 0)".
  EOT
  type        = bool
  default     = false
}

variable "functions_service_account_email" {
  description = "Service account email running the (separately authored) weekly Firebase Auth export Cloud Function. Defaults to the Compute Engine default SA, which is what Cloud Functions/Cloud Build use today on this project (see iam.tf comments on the same default-SA behavior)."
  type        = string
  default     = "580850228782-compute@developer.gserviceaccount.com"
}

variable "alert_emails" {
  description = "Email addresses notified by the Phase 0 backup/DR monitoring alert policies (monitoring.tf)."
  type        = list(string)
  default = [
    "joe.creighton@highplainsbank.com",
    "jessica.teichman@highplainsbank.com",
  ]
}

variable "backup_sa_deployers" {
  description = "Principals allowed to deploy Cloud Functions that run as the eos-backup service account (iam.serviceAccountUser on that SA). Temporary until deploys move to a build service account."
  type        = list(string)
  default     = ["user:daniel@mcgareyconsulting.com"]
}

variable "functions_sa_deployers" {
  description = "Principals allowed to deploy Cloud Functions that run as the eos-functions service account (iam.serviceAccountUser on that SA). Temporary until deploys move to a build service account."
  type        = list(string)
  default     = ["user:daniel@mcgareyconsulting.com"]
}

# Gate 2: runtime env owned by Terraform (cloud_run.tf, secrets.tf). See
# README.md "Secrets (Gate 2)". Secret values are NOT variables: they live
# only in Secret Manager versions added out-of-band (docs/SECRETS_RUNBOOK.md).

variable "google_oauth_client_id" {
  description = "Google OAuth web client ID for the Google Tasks integration (Cloud Run env GOOGLE_OAUTH_CLIENT_ID). Not a secret: it is visible in every OAuth consent redirect. Set in the workspace's gitignored .tfvars; copy the current value from the live service before the Gate 2 apply."
  type        = string

  validation {
    condition     = endswith(var.google_oauth_client_id, ".apps.googleusercontent.com")
    error_message = "google_oauth_client_id must be a Google OAuth client ID ending in .apps.googleusercontent.com."
  }
}

variable "google_oauth_redirect_uri" {
  description = "Pinned OAuth redirect URI (Cloud Run env GOOGLE_OAUTH_REDIRECT_URI). Must be the exact HTTPS callback registered on the OAuth client; see lib/google/tasks.ts for why it cannot be derived on Cloud Run. Not a secret."
  type        = string

  validation {
    condition     = startswith(var.google_oauth_redirect_uri, "https://") && endswith(var.google_oauth_redirect_uri, "/api/google/tasks/callback")
    error_message = "google_oauth_redirect_uri must be https://<host>/api/google/tasks/callback."
  }
}

variable "runtime_extra_env" {
  description = "Additional NON-SECRET plain env vars for the Cloud Run container (e.g. { ENV_LABEL = \"DEMO\", ENV_LABEL_TONE = \"amber\" }). Terraform owns all container env from Gate 2 on, so env set by hand with gcloud is removed by the next apply; declare it here instead. Never put a secret here: values appear in plan output and state."
  type        = map(string)
  default     = {}

  validation {
    condition = length(setintersection(keys(var.runtime_extra_env), [
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_REDIRECT_URI",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "GOOGLE_TASKS_PULL_SECRET",
      "SIGN_IN_ALLOWLIST",
    ])) == 0
    error_message = "runtime_extra_env must not redefine an env var already managed in cloud_run.tf / secrets.tf."
  }

  validation {
    condition     = alltrue([for k in keys(var.runtime_extra_env) : !startswith(k, "NEXT_PUBLIC_")])
    error_message = "NEXT_PUBLIC_* values are baked in at build time (cloudbuild.yaml); setting them as runtime env does nothing."
  }

  validation {
    condition     = alltrue([for k in keys(var.runtime_extra_env) : !can(regex("(?i)(SECRET|TOKEN|PASSWORD|PRIVATE_KEY|CREDENTIAL)", k))])
    error_message = "runtime_extra_env is for non-secret config only. Add a secret to local.runtime_secrets in secrets.tf instead."
  }
}
