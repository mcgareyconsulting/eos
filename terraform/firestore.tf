# Firestore databases (prod + sandbox) and backup schedules. Phase 0: backups.
#
# Both databases already exist (created outside Terraform) and are IMPORTED
# here, not created. See IMPORT_PHASE0.md for the exact import commands.
# `deletion_policy = "ABANDON"` means `terraform destroy` will NOT delete the
# database — it only removes it from state. Combined with `prevent_destroy`,
# this is a belt-and-suspenders guard against a stray `terraform destroy`
# wiping the bank's live data.

resource "google_firestore_database" "prod" {
  project     = var.project_id
  name        = var.prod_database_id
  location_id = "us-east1"
  type        = "FIRESTORE_NATIVE"

  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"

  # ABANDON, not DELETE: `terraform destroy`/removal from config must never
  # take the live database down with it. This resource exists to manage
  # settings (PITR, delete protection) on a database Terraform did not create.
  deletion_policy = "ABANDON"

  lifecycle {
    prevent_destroy = true

    # These attributes are set by the API on the existing database (from
    # whenever/however it was first created) and are not something this
    # Phase 0 pass intends to manage. Ignoring them avoids a spurious diff
    # (or worse, an attempted in-place/replace) immediately after import,
    # since the values Terraform would otherwise assume (provider defaults)
    # may not match what the API reports back for a pre-existing database.
    ignore_changes = [
      concurrency_mode,
      app_engine_integration_mode,
    ]
  }
}

resource "google_firestore_database" "sandbox" {
  project     = var.project_id
  name        = var.sandbox_database_id
  location_id = "us-east1"
  type        = "FIRESTORE_NATIVE"

  # Sandbox is a refreshable copy of prod — no PITR needed, but delete
  # protection stays on so it can't be dropped by accident (a deliberate
  # `terraform destroy` still works via `deletion_policy = "ABANDON"` below;
  # this only blocks the accidental console/gcloud delete).
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_DISABLED"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"

  deletion_policy = "ABANDON"

  lifecycle {
    prevent_destroy = true

    # See prod comment above — same rationale.
    ignore_changes = [
      concurrency_mode,
      app_engine_integration_mode,
    ]
  }
}

# Managed backup schedules on prod only. Sandbox intentionally has NO backup
# schedules — it's a refreshable copy of prod, not a source of truth, so
# there's nothing in it worth a separate backup chain.

resource "google_firestore_backup_schedule" "prod_daily" {
  project   = var.project_id
  database  = google_firestore_database.prod.name
  retention = "8467200s" # 14 weeks — the Firestore backup-schedule maximum.

  daily_recurrence {}
}

resource "google_firestore_backup_schedule" "prod_weekly" {
  project   = var.project_id
  database  = google_firestore_database.prod.name
  retention = "8467200s" # 14 weeks — the Firestore backup-schedule maximum.

  weekly_recurrence {
    day = "SUNDAY"
  }
}
