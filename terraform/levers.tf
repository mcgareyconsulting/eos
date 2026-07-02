# Tier 1 optional security levers (~$40-75/mo total per docs/ROADMAP.md
# Pass 10, "Security levers menu" — verify ballparks before quoting to the
# client, GCP pricing changes). Each is gated on its own boolean variable
# (variables.tf) and defaults OFF; the MVP deploy does not require any of
# them. Tier 0 (least-privilege SAs, no exported keys, Secret Manager,
# default-deny Firestore rules, domain-restricted auth) is already the
# baseline elsewhere in this module / the app itself, not repeated here.

# ---------------------------------------------------------------------------
# Lever 1: Cloud Armor (WAF / DDoS / IP allowlisting)
# Ballpark: ~$5/mo per policy + ~$1/rule/mo + per-request eval cost
# (docs/ROADMAP.md Pass 10 rolls this into the ~$40-75/mo Tier 1 total,
# alongside the load balancer itself).
#
# SCOPE NOTE: Cloud Armor policies only attach to an external HTTPS Load
# Balancer's backend service, not directly to a Cloud Run service. Wiring
# Cloud Run behind an LB requires a serverless NEG + backend service + URL
# map + target HTTPS proxy + forwarding rule + reserved IP (+ managed SSL
# cert). That's a meaningfully larger, separate footprint than "flip a
# flag" and is deliberately OUT OF SCOPE for this pass — TODO: build
# `load_balancer.tf` (serverless NEG + LB chain) if/when the bank confirms
# they want Cloud Armor, then attach this policy to its backend service.
# The policy resource below is created standalone so it's ready to attach
# once that LB exists; it has no effect on traffic until then.
resource "google_compute_security_policy" "waf" {
  count = var.enable_cloud_armor ? 1 : 0

  project     = var.project_id
  name        = "${var.service_name}-armor-policy"
  description = "Cloud Armor WAF policy for ${var.service_name} (attach to the LB backend service fronting Cloud Run — see scope note above)."

  # Default rule: allow everything not matched by a more specific rule
  # below. Required by the resource (every policy needs a catch-all).
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

  # Example managed rule (OWASP CRS preview) — left commented; enable +
  # tune to the client's actual threat model rather than shipping a
  # one-size-fits-all rule set.
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

# ---------------------------------------------------------------------------
# Lever 2: CMEK (customer-managed encryption keys)
# Ballpark: ~$0.06/key/mo (Cloud KMS key version) + $0.03/10k crypto
# operations — rounding error next to the LB/Armor cost, per ROADMAP Pass 10.
#
# Where CMEK applies in this footprint:
#   - Artifact Registry: wired below via `kms_key_name` on the repository
#     (see artifact_registry.tf) — this is a real, stable provider
#     attribute.
#   - Firestore: Firestore supports CMEK on the database resource, but this
#     module does not manage a `google_firestore_database` resource (the
#     "(default)" database already exists, created via the Firebase console
#     for the MVP — see the PITR lever below for the same caveat). Enabling
#     CMEK on an existing Firestore database is also a one-way, database-
#     recreating change in some configurations — verify current behavior
#     for this provider version before attempting it via Terraform. Safer
#     path: confirm requirement with the client, then apply via
#     `gcloud firestore databases update --database='(default)' \
#       --kms-key-name=<key resource name>` (or import the database into
#     Terraform first). Left as a documented gcloud alternative rather than
#     an active/commented resource, since guessing the current attribute
#     name against a real (already-existing) resource is exactly the kind
#     of risk this module avoids.
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

  # Cloud KMS enforces min ~24h rotation; a common default.
  rotation_period = "7776000s" # 90 days

  lifecycle {
    prevent_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Lever 3: Firestore point-in-time recovery (PITR)
# Ballpark: PITR retains ~7 days of change history; roughly adds the cost of
# a few extra days of storage on top of normal Firestore storage billing —
# per ROADMAP Pass 10, verify exact multiplier against current Firestore
# pricing before quoting.
#
# CAVEAT: the "(default)" Firestore database already exists (created via the
# Firebase console when the MVP was stood up) and is not created by this
# Terraform module. There's no `google_firestore_database` resource here to
# attach `point_in_time_recovery_enablement` to without first importing that
# existing database — importing a database you don't otherwise manage in
# Terraform (and whose other settings, e.g. delete-protection, you'd then be
# responsible for keeping in sync) is a bigger step than "flip a flag."
# Documenting + wiring the gcloud alternative instead, still gated on the
# same variable so `terraform apply` is the one on/off switch reviewers use:
#
# Native-resource example (COMMENTED — do not enable without first running
# `terraform import` against the real "(default)" database, and confirming
# `point_in_time_recovery_enablement` is the current attribute name/enum for
# your pinned provider version; treat the exact spelling below as
# illustrative, not verified against an active resource):
#
# resource "google_firestore_database" "default" {
#   project                           = var.project_id
#   name                              = "(default)"
#   location_id                       = var.region
#   type                              = "FIRESTORE_NATIVE"
#   point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"
# }

resource "null_resource" "firestore_pitr" {
  count = var.enable_pitr ? 1 : 0

  triggers = {
    project = var.project_id
    enabled = var.enable_pitr
  }

  provisioner "local-exec" {
    command = "gcloud firestore databases update --project=${var.project_id} --database='(default)' --enable-pitr --quiet"
  }

  # Note: this only runs the enable command on `terraform apply`; toggling
  # var.enable_pitr back to false does NOT run a corresponding disable
  # command automatically (local-exec has no native destroy-time symmetry
  # without a separate `when = destroy` provisioner referencing a fixed
  # command, which is intentionally omitted here to avoid silently flipping
  # a data-protection setting on `terraform destroy`). Disable manually via:
  #   gcloud firestore databases update --database='(default)' --no-enable-pitr
}

# ---------------------------------------------------------------------------
# Lever 4: Data Access audit logs (Firestore/Datastore API)
# Ballpark: no separate GCP fee for enabling the log category itself, but the
# resulting Cloud Logging ingestion + storage volume (DATA_READ especially,
# on a read-heavy app) can be nontrivial — per ROADMAP Pass 10, verify actual
# volume via a short trial before committing to a number.
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

# ---------------------------------------------------------------------------
# Tier 2 (comment-only): VPC Service Controls
# $0 direct GCP cost (real cost is the ops/design effort), per ROADMAP Pass
# 10 — "Tier 2 (quote on request)". VPC-SC is an org-level Access Context
# Manager construct (a security perimeter around APIs like Firestore/BigQuery
# to block data exfiltration), not a per-project Terraform resource you'd
# toggle here. It requires:
#   - An Access Context Manager access policy at the *organization* level
#     (org-level perms, likely one per org, shared across projects).
#   - A `google_access_context_manager_service_perimeter` naming the
#     specific projects + restricted services (e.g. firestore.googleapis.com,
#     bigquery.googleapis.com) to wall off.
#   - Careful staging (dry-run mode first) since a misconfigured perimeter
#     can break legitimate cross-project access, including this app's own
#     Cloud Build → Cloud Run → Firestore path.
# Recommend scoping as its own follow-up engagement once BigQuery
# conventions land (see docs/ROADMAP.md "RESUME HERE"), not bundled into
# this skeleton. No variable/resource for this lever is defined in this
# module.
