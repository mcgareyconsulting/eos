# Log retention (audit 2026-10-21, Questions for HPB #9).
#
# `_Default` holds every log that isn't an Admin Activity / System Event
# audit log: Cloud Run request and app logs, function logs, Data Access logs
# once enabled. Google's default is 30 days; bank policies usually want at
# least a year of security-relevant logs. `_Required` (Admin Activity audit
# logs) is already 400 days and locked by Google, so it isn't managed here.
#
# Google creates `_Default` with the project; this resource adopts it rather
# than creating it, and removing the resource leaves the bucket in place.
#
# NOT LOCKED. A locked retention can never be shortened or removed. Locking
# is HPB's decision (Questions for HPB #9: lock after a 30-day trial); flip
# `locked` only with that sign-off recorded in docs/HARDENING_LOG.md.
resource "google_logging_project_bucket_config" "default" {
  project        = var.project_id
  location       = "global"
  bucket_id      = "_Default"
  retention_days = var.log_retention_days
  locked         = false
}
