# Tier 1 optional security levers (all default OFF). See README.md for details and costs.
# Each gated on a boolean variable in variables.tf.

# Lever 1: Cloud Armor (WAF / DDoS / IP allowlisting).
# Note: requires external HTTPS Load Balancer (not included here). See README.md.
resource "google_compute_security_policy" "waf" {
  count = var.enable_cloud_armor ? 1 : 0

  project     = var.project_id
  name        = "${var.service_name}-armor-policy"
  description = "Cloud Armor WAF policy for ${var.service_name}."

  # Default allow rule (required by the resource).
  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default allow rule"
  }

  # Example managed rule (OWASP CRS) — commented. Enable + tune per threat model.
  # rule {
  #   action   = "deny(403)"
  #   priority = 1000
  #   match {
  #     expr {
  #       expression = "evaluatePreconfiguredExpr('sqli-stable')"
  #     }
  #   }
  #   description = "Block SQLi patterns"
  # }
}

# Lever 2: CMEK (customer-managed encryption keys). See README.md for details.
resource "google_kms_key_ring" "app" {
  count = var.enable_cmek ? 1 : 0

  project  = var.project_id
  name     = "${var.service_name}-keyring"
  location = var.region

  depends_on = [google_project_service.required]
}

resource "google_kms_crypto_key" "app" {
  count = var.enable_cmek ? 1 : 0

  name     = "${var.service_name}-key"
  key_ring = google_kms_key_ring.app[0].id

  rotation_period = "7776000s" # 90 days

  lifecycle {
    prevent_destroy = true
  }
}

# Artifact Registry service agent grant (needed to use the CMEK key).
# google_project_service_identity is beta-only in v6.x; must run under google-beta (versions.tf).
resource "google_project_service_identity" "artifactregistry" {
  provider = google-beta
  count    = var.enable_cmek ? 1 : 0

  project = var.project_id
  service = "artifactregistry.googleapis.com"

  depends_on = [google_project_service.required]
}

resource "google_kms_crypto_key_iam_member" "artifact_registry_cmek" {
  count = var.enable_cmek ? 1 : 0

  crypto_key_id = google_kms_crypto_key.app[0].id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_project_service_identity.artifactregistry[0].email}"
}

# Lever 3: Firestore point-in-time recovery (PITR).
# Uses gcloud (not Terraform) because "(default)" database is pre-existing. See README.md.
resource "null_resource" "firestore_pitr" {
  count = var.enable_pitr ? 1 : 0

  triggers = {
    project = var.project_id
    enabled = var.enable_pitr
  }

  provisioner "local-exec" {
    command = "gcloud firestore databases update --project=${var.project_id} --database='(default)' --enable-pitr --quiet"
  }

  # WARNING: toggling var.enable_pitr = false does NOT auto-disable PITR (local-exec has no destroy symmetry).
  # Disable manually: gcloud firestore databases update --database='(default)' --no-enable-pitr
}

# Lever 4: Data Access audit logs (Firestore/Datastore API).
# Enables DATA_READ and DATA_WRITE logging. Note: storage volume can be nontrivial on read-heavy apps.
resource "google_project_iam_audit_config" "firestore_data_access" {
  count = var.enable_data_access_logs ? 1 : 0

  project = var.project_id
  service = "datastore.googleapis.com"

  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
}

# Tier 2 (comment-only): VPC Service Controls.
# Org-level Access Context Manager perimeter (not a per-project toggle).
# See README.md for details. Recommend as separate follow-up once BigQuery conventions land.
