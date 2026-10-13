# Phase 1 front door: Global External Application Load Balancer in front of
# Cloud Run, serving var.custom_domain with a Google-managed certificate.
# Gated on var.enable_load_balancer (default OFF). See README.md
# "Load Balancer (load_balancer.tf)" and docs/TARGET_ARCHITECTURE.md §3.
#
#   DNS A record (Hover) ─► global IP ─► :443 HTTPS proxy (managed cert)
#                                     └► :80  redirect to HTTPS
#                           URL map ─► backend service (+ Cloud Armor if on)
#                                   ─► serverless NEG ─► Cloud Run `eos`
#
# This pass does NOT change who can reach the service: Cloud Run ingress stays
# INGRESS_TRAFFIC_ALL and the allUsers invoker stays (cloud_run.tf), so the
# *.run.app URL keeps working alongside the custom domain. Locking ingress to
# the LB, dropping allUsers and adding IAP are a separate, later step.
#
# The managed cert stays PROVISIONING until the A record resolves to
# lb_ip_address; that is expected and blocks nothing else in this apply.

# The IP handed to the bank's DNS admin. Destroying or replacing it breaks the
# domain until DNS is changed, so it is protected like the prod service.
resource "google_compute_global_address" "lb" {
  count = var.enable_load_balancer ? 1 : 0

  project = var.project_id
  name    = "${var.service_name}-lb-ip"

  depends_on = [google_project_service.required]

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_region_network_endpoint_group" "app" {
  count = var.enable_load_balancer ? 1 : 0

  project               = var.project_id
  name                  = "${var.service_name}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.app.name
  }

  # Compute API is enabled in the same apply on a fresh project; without this
  # the create races API propagation and fails SERVICE_DISABLED.
  depends_on = [google_project_service.required]
}

resource "google_compute_backend_service" "app" {
  count = var.enable_load_balancer ? 1 : 0

  project               = var.project_id
  name                  = "${var.service_name}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"

  # Attaches only when the Cloud Armor lever (levers.tf) is also on.
  security_policy = var.enable_cloud_armor ? google_compute_security_policy.waf[0].id : null

  backend {
    group = google_compute_region_network_endpoint_group.app[0].id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_url_map" "https" {
  count = var.enable_load_balancer ? 1 : 0

  project         = var.project_id
  name            = "${var.service_name}-url-map"
  default_service = google_compute_backend_service.app[0].id
}

# Name is derived from the domain so a hostname change creates the new cert
# before the proxy lets go of the old one (create_before_destroy).
resource "google_compute_managed_ssl_certificate" "app" {
  count = var.enable_load_balancer ? 1 : 0

  project = var.project_id
  name    = "${var.service_name}-cert-${substr(sha1(var.custom_domain), 0, 8)}"

  managed {
    domains = [var.custom_domain]
  }

  # Compute API is enabled in the same apply on a fresh project; without this
  # the create races API propagation and fails SERVICE_DISABLED.
  depends_on = [google_project_service.required]

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_target_https_proxy" "app" {
  count = var.enable_load_balancer ? 1 : 0

  project          = var.project_id
  name             = "${var.service_name}-https-proxy"
  url_map          = google_compute_url_map.https[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.app[0].id]
}

resource "google_compute_global_forwarding_rule" "https" {
  count = var.enable_load_balancer ? 1 : 0

  project               = var.project_id
  name                  = "${var.service_name}-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.lb[0].id
  port_range            = "443"
  target                = google_compute_target_https_proxy.app[0].id
}

# Port 80 only ever redirects to HTTPS; it never reaches Cloud Run.
resource "google_compute_url_map" "http_redirect" {
  count = var.enable_load_balancer ? 1 : 0

  project = var.project_id
  name    = "${var.service_name}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }

  # Compute API is enabled in the same apply on a fresh project; without this
  # the create races API propagation and fails SERVICE_DISABLED.
  depends_on = [google_project_service.required]
}

resource "google_compute_target_http_proxy" "redirect" {
  count = var.enable_load_balancer ? 1 : 0

  project = var.project_id
  name    = "${var.service_name}-http-proxy"
  url_map = google_compute_url_map.http_redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count = var.enable_load_balancer ? 1 : 0

  project               = var.project_id
  name                  = "${var.service_name}-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.lb[0].id
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect[0].id
}
