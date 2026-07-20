# Terraform + provider version constraints for the EOS Cloud Run footprint
# (High Plains Bank GCP project). Kept as a single boring root module — see
# terraform/README.md for how to init/plan/apply.

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    # google-beta is required only by the CMEK lever's
    # `google_project_service_identity.artifactregistry` resource (levers.tf),
    # which is beta-only in the v6.x provider. Declaring it here keeps
    # `terraform plan`/`validate` green even with the CMEK lever OFF —
    # Terraform type-checks every resource block regardless of `count`.
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }

  # Remote state backend — uncomment and fill in once the client provisions a
  # state bucket (recommend a dedicated bucket per project, versioning
  # enabled, uniform bucket-level access, and *not* the same bucket as app
  # data). This is deliberately left local (no backend block) until then so
  # this skeleton applies cleanly out of the box during review.
  #
  # backend "gcs" {
  #   bucket = "REPLACE_ME-tfstate"   # e.g. "hpb-eos-tfstate"
  #   prefix = "eos/terraform/state"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Only consumed by beta-only resources (currently the CMEK lever's Artifact
# Registry service-identity lookup in levers.tf). Same project/region as the
# GA provider.
provider "google-beta" {
  project = var.project_id
  region  = var.region
}
