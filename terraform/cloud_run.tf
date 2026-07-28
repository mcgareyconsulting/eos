# Cloud Run service for the Next.js app. Deploys/image updates are owned by
# cloudbuild.yaml (`gcloud run deploy` on every build) — this resource exists
# so the *service configuration* (SA, scaling, ingress) is reviewable as
# code, not so Terraform manages day-to-day deploys. See the lifecycle block
# below.

resource "google_cloud_run_v2_service" "app" {
  project  = var.project_id
  name     = var.service_name
  location = var.region

  # Public ingress: access control for this app is enforced at the
  # application layer (Firebase Auth, Google sign-in restricted to the
  # var.allowed_domain hosted domain — see docs/DEPLOY.md §5), not by
  # Cloud Run/GCP IAM. This matches cloudbuild.yaml's
  # `gcloud run deploy --allow-unauthenticated`. If the bank's security
  # review requires GCP-level auth instead (e.g. fronting with Identity-Aware
  # Proxy), see the commented alternative below — that also means flipping
  # cloudbuild.yaml's deploy step to `--no-allow-unauthenticated`.
  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.runtime.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      # Placeholder image only — cloudbuild.yaml builds and deploys the real
      # image on every push (see `images:` / the `deploy` step). Terraform
      # should never fight that deploy pipeline for the image tag, hence
      # `ignore_changes` below.
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
      # Service-level scaling (distinct from template.scaling above, which we
      # do manage). The API always returns this block zero-populated, so with
      # nothing declared here Terraform plans to remove it on every run and
      # the API puts it straight back — a diff that never converges and would
      # mask real drift. Instance counts stay controlled by template.scaling.
      scaling,
    ]
  }
}

# Public invoker binding: matches cloudbuild.yaml's
# `--allow-unauthenticated`. Access control is Firebase Auth (Google
# sign-in restricted to var.allowed_domain), *not* this IAM binding — see the
# comment on `ingress` above.
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = google_cloud_run_v2_service.app.project
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# --- Lever: GCP-level auth instead of app-layer auth ---
# If the bank's review wants Cloud Run/IAM (or IAP) to gate access rather
# than relying on Firebase Auth's hosted-domain restriction:
#   1. Remove the `google_cloud_run_v2_service_iam_member.public_invoker`
#      resource above (drop the `allUsers` binding).
#   2. Flip cloudbuild.yaml's `--allow-unauthenticated` to
#      `--no-allow-unauthenticated`.
#   3. Put Identity-Aware Proxy in front (requires an external HTTPS Load
#      Balancer + serverless NEG pointing at this service — same LB
#      dependency called out in levers.tf's Cloud Armor section; consider
#      standing up the LB once and hanging both Cloud Armor and IAP off it).
#   4. Grant specific principals `roles/run.invoker` instead of `allUsers`,
#      e.g.:
#
# resource "google_cloud_run_v2_service_iam_member" "iap_invoker" {
#   project  = google_cloud_run_v2_service.app.project
#   location = google_cloud_run_v2_service.app.location
#   name     = google_cloud_run_v2_service.app.name
#   role     = "roles/run.invoker"
#   member   = "serviceAccount:service-<PROJECT_NUMBER>@gcp-sa-iap.iam.gserviceaccount.com"
# }
