# Cloud Run service. Image updates owned by cloudbuild.yaml; Terraform manages configuration.
# Auth model: app-layer (Firebase) not GCP-layer. See README.md "Cloud Run Service".

resource "google_cloud_run_v2_service" "app" {
  project  = var.project_id
  name     = var.service_name
  location = var.region

  # Public ingress; access control via Firebase Auth (var.allowed_domain).
  # See README.md for GCP-level auth (IAP) alternative.
  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.runtime.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      # Placeholder image. cloudbuild.yaml builds and deploys real images; ignore_changes below.
      image = "us-docker.pkg.dev/cloudrun/container/hello"
    }
  }

  depends_on = [
    google_project_service.required,
    google_artifact_registry_repository.images,
  ]

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
      # API always returns scaling zero-populated; ignore to prevent spurious diffs.
      scaling,
    ]
  }
}

# Public invoker binding (matches cloudbuild.yaml --allow-unauthenticated).
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = google_cloud_run_v2_service.app.project
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Alternative: GCP-level auth (Cloud Run/IAP). See README.md for details.
# Requires external HTTPS Load Balancer + serverless NEG.
#
# resource "google_cloud_run_v2_service_iam_member" "iap_invoker" {
#   project  = google_cloud_run_v2_service.app.project
#   location = google_cloud_run_v2_service.app.location
#   name     = google_cloud_run_v2_service.app.name
#   role     = "roles/run.invoker"
#   member   = "serviceAccount:service-<PROJECT_NUMBER>@gcp-sa-iap.iam.gserviceaccount.com"
# }
