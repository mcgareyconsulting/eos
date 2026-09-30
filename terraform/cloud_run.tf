# Cloud Run service. Image updates owned by cloudbuild.yaml; Terraform manages configuration,
# including ALL container env (Gate 2: secrets as Secret Manager refs, see secrets.tf).
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

      # --- Runtime env (Gate 2: Terraform owns ALL container env) ---------
      #
      # From Gate 2 on, Terraform is the only writer of this service's env.
      # Anything set with `gcloud run services update --update-env-vars` is
      # removed by the next apply: add it to var.runtime_extra_env instead.
      # scripts/deploy.sh no longer pushes env, and cloudbuild.yaml's
      # `gcloud run deploy --image=...` keeps whatever env the service has.

      # Non-secret config: plain values, fine in plan output and state.
      env {
        name  = "GOOGLE_OAUTH_CLIENT_ID"
        value = var.google_oauth_client_id
      }
      env {
        name  = "GOOGLE_OAUTH_REDIRECT_URI"
        value = var.google_oauth_redirect_uri
      }

      # Gate 4 (C-06): key name for application-level encryption of Google
      # refresh tokens. Not a secret (a resource name); the runtime SA's
      # key-scoped grant is what matters (kms.tf). Absent until the flag is on.
      dynamic "env" {
        for_each = var.encrypt_google_tokens ? [google_kms_crypto_key.eos_tokens.id] : []
        content {
          name  = "GOOGLE_TOKEN_KMS_KEY"
          value = env.value
        }
      }

      # Optional extra plain env (e.g. ENV_LABEL). Empty by default.
      dynamic "env" {
        for_each = var.runtime_extra_env
        content {
          name  = env.key
          value = env.value
        }
      }

      # Secrets: references to Secret Manager (secrets.tf), resolved by Cloud
      # Run when an instance starts. Plan output, state and `gcloud run
      # services describe` show only the secret name + version, never the
      # value. "latest" means new instances pick up a newly added version;
      # roll a new revision to move every instance onto it
      # (docs/SECRETS_RUNBOOK.md).
      dynamic "env" {
        for_each = google_secret_manager_secret.runtime
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_project_service.required,
    google_artifact_registry_repository.images,
    # The runtime SA must be able to read every referenced secret before the
    # new revision starts, or the revision fails to become ready.
    google_secret_manager_secret_iam_member.runtime_accessor,
  ]

  lifecycle {
    # Production service/registry: a plan that replaces this (e.g. a wrong
    # region) must fail at plan time, never offer to destroy.
    prevent_destroy = true

    # Refuse to roll a revision that references a secret with no enabled
    # version: such a revision fails to start. See secrets.tf.
    precondition {
      condition = alltrue([
        for v in data.google_secret_manager_secret_version.runtime_latest : v.enabled
      ])
      error_message = "A secret in secrets.tf has no ENABLED latest version, so a Cloud Run revision referencing it would fail to start. Add a version first (docs/SECRETS_RUNBOOK.md step 2), then re-plan."
    }

    ignore_changes = [
      # Image is rolled by cloudbuild.yaml (via scripts/deploy.sh), not Terraform.
      template[0].containers[0].image,
      # Gate 2: template[0].containers[0].env is deliberately NOT ignored
      # any more. Terraform owns env; secrets are Secret Manager refs.
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
