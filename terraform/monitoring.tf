# Phase 0 backups: alerting on backup/DR-relevant events. See README.md
# "Backups and recovery (Phase 0)".

resource "google_monitoring_notification_channel" "email" {
  for_each = toset(var.alert_emails)

  project      = var.project_id
  display_name = "EOS backup alerts: ${each.value}"
  type         = "email"

  labels = {
    email_address = each.value
  }

  depends_on = [google_project_service.required]
}

locals {
  notification_channels = [for c in google_monitoring_notification_channel.email : c.id]
}

# Alert 1: a Firestore exportDocuments call failed (weekly backup did not
# complete). Catches both an explicit error severity and a nonzero status
# code on the operation.
resource "google_monitoring_alert_policy" "firestore_export_failed" {
  project      = var.project_id
  severity     = "ERROR"
  display_name = "Firestore export (backup) failed"
  combiner     = "OR"

  conditions {
    display_name = "ExportDocuments error"

    condition_matched_log {
      filter = <<-EOT
        protoPayload.methodName="google.firestore.admin.v1.FirestoreAdmin.ExportDocuments"
        AND (severity>=ERROR OR protoPayload.status.code!=0)
      EOT
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      **What happened:** the weekly Firestore export of `hpb-eos-prod-db` to the archive bucket reported an error.

      **Impact:** the long-term archive is missing this week's copy. Daily Firestore backups (14-week retention) and point-in-time recovery are unaffected.

      **What to do:** open Cloud Run functions → `exportFirestore` → Logs for the error; fix the cause (permissions, bucket, quota); re-run via Cloud Scheduler → `firebase-schedule-exportFirestore-us-east1` → Force run. Runbook: docs/BACKUP_RUNBOOK.md, alert table.
    EOT
  }

  notification_channels = local.notification_channels

  alert_strategy {
    notification_rate_limit {
      period = "3600s"
    }
    auto_close = "604800s"
  }

  depends_on = [google_project_service.required]
}

# Alert 2: someone created, updated, or deleted a Firestore backup schedule
# outside of (or in addition to) this Terraform module — a signal that the
# managed backup cadence in firestore.tf may no longer match reality.
resource "google_monitoring_alert_policy" "backup_schedule_changed" {
  project      = var.project_id
  severity     = "ERROR"
  display_name = "Firestore backup schedule changed"
  combiner     = "OR"

  conditions {
    display_name = "BackupSchedule create/update/delete"

    condition_matched_log {
      filter = <<-EOT
        protoPayload.methodName=~"google.firestore.admin.v1.FirestoreAdmin.(Create|Update|Delete)BackupSchedule"
      EOT
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      **What happened:** a Firestore backup schedule on `hpb-eos-prod` was created, changed or deleted.

      **Expected only** during an approved Terraform apply (terraform/firestore.tf). Anything else is unplanned.

      **What to do:** Firestore → Databases → `hpb-eos-prod-db` → Disaster Recovery: confirm a daily and a weekly schedule exist with 14-week retention. If not, run `terraform plan` from the repo to see the drift, and check Logging for the principal who made the change.
    EOT
  }

  notification_channels = local.notification_channels

  alert_strategy {
    notification_rate_limit {
      period = "3600s"
    }
    auto_close = "604800s"
  }

  depends_on = [google_project_service.required]
}

# Alert 3: a Firestore database's settings were changed or the database
# itself was deleted — covers PITR/delete-protection being flipped outside
# Terraform, and the (should-be-impossible, given delete protection) case of
# a database deletion.
resource "google_monitoring_alert_policy" "database_settings_changed" {
  project      = var.project_id
  severity     = "ERROR"
  display_name = "Firestore database settings changed"
  combiner     = "OR"

  conditions {
    display_name = "UpdateDatabase / DeleteDatabase"

    condition_matched_log {
      filter = <<-EOT
        protoPayload.methodName="google.firestore.admin.v1.FirestoreAdmin.UpdateDatabase"
        OR protoPayload.methodName="google.firestore.admin.v1.FirestoreAdmin.DeleteDatabase"
      EOT
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      **What happened:** a Firestore database in `hpb-eos-prod` had its settings updated, or a database was deleted.

      **Expected only** during an approved Terraform apply. Point-in-time recovery and delete protection must stay enabled on `hpb-eos-prod-db`.

      **What to do:** Firestore → Databases → `hpb-eos-prod-db` → Disaster Recovery: confirm PITR is Enabled and delete protection is on. Check Logging (`protoPayload.methodName="google.firestore.admin.v1.FirestoreAdmin.UpdateDatabase"`) for who made the change.
    EOT
  }

  notification_channels = local.notification_channels

  alert_strategy {
    notification_rate_limit {
      period = "3600s"
    }
    auto_close = "604800s"
  }

  depends_on = [google_project_service.required]
}

# Alert 4: the weekly Auth export function errored. `exportAuthUsers`
# (functions/src/export-auth-users.ts) throws on any failure, which Cloud
# Run logs at ERROR under the function's service name. The freshness
# checker below would also notice an 8-day-old auth export, but this fires
# the same day.
resource "google_monitoring_alert_policy" "auth_export_failed" {
  project      = var.project_id
  severity     = "ERROR"
  display_name = "Auth export (backup) failed"
  combiner     = "OR"

  conditions {
    display_name = "exportAuthUsers error"

    condition_matched_log {
      filter = <<-EOT
        resource.type="cloud_run_revision"
        AND resource.labels.service_name="exportauthusers"
        AND severity>=ERROR
      EOT
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      **What happened:** the weekly export of Firebase Auth users (uids, emails, the `role: admin` claim) to the archive bucket reported an error.

      **Impact:** the long-term archive is missing this week's copy of the user directory. Sign-in and Firestore data are unaffected.

      **What to do:** open Cloud Run functions → `exportAuthUsers` → Logs for the error; fix the cause (permissions, bucket, quota); re-run via Cloud Scheduler → `firebase-schedule-exportAuthUsers-us-east1` → Force run. Runbook: docs/BACKUP_RUNBOOK.md, alert table.
    EOT
  }

  notification_channels = local.notification_channels

  alert_strategy {
    notification_rate_limit {
      period = "3600s"
    }
    auto_close = "604800s"
  }

  depends_on = [google_project_service.required]
}

# --- Backup freshness (daily checker + heartbeat) ---------------------------
#
# `checkBackupFreshness` (functions/src/check-backup-freshness.ts) runs daily
# and logs one `backup_freshness` line: ok=false (at ERROR) when the newest
# backup/export/auth-export is older than its threshold. Two policies:
#   1. the line says stale  -> "Backup freshness check failed"
#   2. the line never comes -> "Backup freshness check did not run"
# The second is a metric-absence condition on a log-based metric; Monitoring
# caps absence windows at 23.5h, which is why the checker is daily rather
# than alerting directly on "no export in 8 days".

resource "google_logging_metric" "backup_freshness_heartbeat" {
  project = var.project_id
  name    = "eos_backup_freshness_heartbeat"
  filter  = <<-EOT
    resource.type="cloud_run_revision"
    AND resource.labels.service_name="checkbackupfreshness"
    AND jsonPayload.event="backup_freshness"
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "backup_freshness_failed" {
  project      = var.project_id
  display_name = "Backup freshness check failed"
  combiner     = "OR"
  severity     = "ERROR"

  conditions {
    display_name = "backup_freshness ok=false"

    condition_matched_log {
      filter = <<-EOT
        resource.type="cloud_run_revision"
        AND resource.labels.service_name="checkbackupfreshness"
        AND jsonPayload.event="backup_freshness"
        AND jsonPayload.ok=false
      EOT
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      **What happened:** the daily backup freshness check found the newest Firestore backup older than 2 days, or the newest weekly Firestore export or Auth export older than 8 days — or it could not read one of them.

      **Impact:** a scheduled protection is not producing copies. Data is still live; recovery options are ageing.

      **What to do:** Cloud Run functions → `checkBackupFreshness` → Logs shows which of `backup` / `export` / `auth` is stale. For a missed export, force-run the matching job in Cloud Scheduler (`firebase-schedule-exportFirestore-us-east1`, `firebase-schedule-exportAuthUsers-us-east1`). For a missed backup, check the schedules under Firestore → Disaster Recovery. Runbook: docs/BACKUP_RUNBOOK.md.
    EOT
  }

  notification_channels = local.notification_channels

  alert_strategy {
    notification_rate_limit {
      period = "3600s"
    }
    auto_close = "604800s"
  }

  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "backup_freshness_absent" {
  project      = var.project_id
  display_name = "Backup freshness check did not run"
  combiner     = "OR"
  severity     = "ERROR"

  conditions {
    display_name = "No backup_freshness heartbeat for 23.5h"

    condition_absent {
      filter   = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.backup_freshness_heartbeat.name}\" AND resource.type=\"cloud_run_revision\""
      duration = "84600s"

      aggregations {
        alignment_period   = "3600s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      **What happened:** the daily `checkBackupFreshness` function has not logged its heartbeat in 23.5 hours. Either Cloud Scheduler did not fire it (this happened silently on 2026-09-28 for the Sunday export jobs) or the function is failing before it logs.

      **What to do:** Cloud Scheduler → `firebase-schedule-checkBackupFreshness-us-east1`: check Last run and State, then Force run. Cloud Run functions → `checkBackupFreshness` → Logs for errors. If Scheduler is skipping runs, that is the incident to chase, since the export jobs share the same mechanism.
    EOT
  }

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "604800s"
  }

  depends_on = [google_project_service.required]
}
