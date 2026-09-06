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

  # Remote state backend — uncomment once client provisions a bucket.
  # See README.md "Provider Configuration" for details.
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

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
