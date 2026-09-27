# Terraform version and provider constraints. See README.md for details.

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    # google-beta needed for CMEK lever's google_project_service_identity (levers.tf).
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }

  # Remote state: gs://hpb-eos-tfstate (hpb-eos-prod, us-east1; versioned,
  # soft-delete 7d, uniform access, public access prevented). Created by hand
  # in the Console 2026-09-27; state migrated from the local `prod` workspace
  # the same day. Workspaces map to objects under the prefix
  # (e.g. eos/terraform/state/prod.tfstate). See README.md.
  backend "gcs" {
    bucket = "hpb-eos-tfstate"
    prefix = "eos/terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
