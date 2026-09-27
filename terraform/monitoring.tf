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

  notification_channels = local.notification_channels

  alert_strategy {
    notification_rate_limit {
      period = "3600s"
    }
    auto_close = "604800s"
  }

  depends_on = [google_project_service.required]
}
