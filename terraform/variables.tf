variable "project_id" {
  description = "GCP project ID that hosts the EOS app (High Plains Bank project)."
  type        = string
}

variable "region" {
  description = "Primary region for Cloud Run, Artifact Registry, etc."
  type        = string
  default     = "us-central1"
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

# --- Optional security levers (Tier 1, see docs/ROADMAP.md Pass 10 + ---
# --- terraform/levers.tf). All default OFF; the app runs fine without ---
# --- any of them. Flip on per the bank's security review requirements. ---

variable "enable_cloud_armor" {
  description = "Provision a Cloud Armor security policy (WAF/DDoS). Requires a Load Balancer in front of Cloud Run — see levers.tf for scope notes. Ballpark ~$5-10/mo policy + LB cost (~$18-25/mo) per ROADMAP Pass 10."
  type        = bool
  default     = false
}

variable "enable_cmek" {
  description = "Provision a Cloud KMS keyring/key for customer-managed encryption. Ballpark ~$0.06/key/mo + operations; see levers.tf for what it does and does not cover."
  type        = bool
  default     = false
}

variable "enable_pitr" {
  description = "Enable Firestore point-in-time recovery. Ballpark: PITR storage surcharge on Firestore (roughly the cost of ~7 extra days of storage, scales with data size); see levers.tf for the client-managed-database caveat."
  type        = bool
  default     = false
}

variable "enable_data_access_logs" {
  description = "Enable Data Access audit logs for the Firestore/Datastore API. Ballpark: standard Cloud Logging ingestion/storage rates on the resulting log volume (can be nontrivial under read-heavy load) per ROADMAP Pass 10."
  type        = bool
  default     = false
}
