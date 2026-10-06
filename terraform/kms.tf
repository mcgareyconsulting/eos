# Gate 2 (secrets and keys): Cloud KMS key for APPLICATION-LEVEL encryption.
# Audit ref C-06. See README.md "Secrets (Gate 2)".
#
# This key is for the app to encrypt data itself before writing it to
# Firestore: users' Google refresh tokens (google_tasks_connections/{uid},
# field refresh_token_enc) are encrypted with it directly via the KMS REST
# API (lib/google/token-cipher.ts, C-06). Cloud Run gets the key name as
# GOOGLE_TOKENS_KMS_KEY (cloud_run.tf).
#
# Rotation (90 days) is safe: each ciphertext names its key version, and KMS
# decrypts with any ENABLED version. Never disable or destroy an old version
# while tokens encrypted with it may still exist (refresh_token_kms_key on
# each doc records which one) — those users would have to reconnect.
#
# It is deliberately separate from the CMEK lever in levers.tf
# (var.enable_cmek → key ring "eos-keyring", key "eos-key", used by the
# Artifact Registry service agent for at-rest encryption). That lever is
# unchanged and still default OFF. Different purpose, different principal,
# different blast radius: one key per job.
#
# !!! Cloud KMS key rings and crypto keys can NEVER be deleted. !!!
# `terraform destroy` only drops them from state (key versions can be
# scheduled for destruction, which makes anything encrypted with them
# unrecoverable). Name and location are therefore permanent: this is pinned
# to us-east1 (the database region) rather than following var.region.

locals {
  tokens_kms_location = "us-east1"
}

resource "google_kms_key_ring" "eos" {
  project  = var.project_id
  name     = "eos"
  location = local.tokens_kms_location

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required]
}

resource "google_kms_crypto_key" "eos_tokens" {
  name     = "eos-tokens"
  key_ring = google_kms_key_ring.eos.id
  purpose  = "ENCRYPT_DECRYPT"

  # New primary version every 90 days. Old versions stay enabled, so data
  # encrypted under them still decrypts (the ciphertext names its version);
  # re-encryption on read/write is the app's job.
  rotation_period = "7776000s" # 90 days

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "SOFTWARE"
  }

  labels = {
    app        = "eos"
    component  = "app-encryption"
    managed-by = "terraform"
  }

  lifecycle {
    # Losing this key = losing every token encrypted with it.
    prevent_destroy = true
  }
}

# The runtime SA may encrypt and decrypt with this one key, and nothing else
# in KMS. Key-scoped, not key-ring- or project-scoped.
resource "google_kms_crypto_key_iam_member" "runtime_tokens_encrypter_decrypter" {
  crypto_key_id = google_kms_crypto_key.eos_tokens.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.runtime.email}"
}
