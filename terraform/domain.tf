# Custom domain for the app (pulse.highplainsbank.com), short-term path.
#
# Cloud Run domain mapping: Google terminates TLS for the hostname with a
# managed certificate and routes it to the `eos` service. It is a Preview
# feature (no SLA) and can't carry Cloud Armor or IAP, so it's the same
# public posture as the *.run.app URL with the bank's hostname on it. The
# long-term front door is a Global External Application Load Balancer
# (audit I-01, docs/TARGET_ARCHITECTURE.md). Moving there is a DNS change
# only — the hostname, Firebase authorized domain and OAuth redirect URI
# stay the same. Pre-issue the LB certificate with Certificate Manager DNS
# authorization before switching DNS, or there's a gap with no valid cert.
#
# Off until var.custom_domain is set. Before setting it:
#   1. The identity running `terraform apply` must be a verified owner of
#      the domain in Google Search Console (TXT record at the bank's DNS,
#      or an HPB admin verifies and adds that identity as an owner).
#   2. After apply, the bank adds the record from output
#      `custom_domain_dns_records` (a CNAME to ghs.googlehosted.com for a
#      subdomain). The certificate issues once DNS resolves (15-60 min).
# Then, as a separate change: Firebase Auth authorized domain, the Tasks
# OAuth client's redirect URI, and var.google_oauth_redirect_uri — see
# docs/CUSTOM_DOMAIN.md.

resource "google_cloud_run_domain_mapping" "app" {
  count = var.custom_domain == "" ? 0 : 1

  project  = var.project_id
  location = var.region
  name     = var.custom_domain

  metadata {
    namespace = var.project_id
    labels = {
      app = "eos"
    }
  }

  spec {
    route_name = google_cloud_run_v2_service.app.name
  }

  # Recreating the mapping re-issues the certificate (minutes-to-hours of
  # TLS errors on the bank's hostname). Change it deliberately or not at all.
  lifecycle {
    prevent_destroy = true
  }
}
