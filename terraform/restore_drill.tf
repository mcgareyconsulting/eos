# Quarterly restore drill (scripts/restore-test.sh, docs/BACKUP_RUNBOOK.md).
#
# The drill restores the newest backup into a scratch database, counts, and
# deletes the scratch database. Neither Editor nor the predefined
# datastore.restoreAdmin role can do all of that (Editor lacks
# backups.restoreDatabase and databases.create/delete; restoreAdmin lacks
# delete), and the only predefined roles with databases.delete are
# datastore.owner / firebase.admin — far broader than a drill needs. So: a
# custom role with exactly the drill's permissions, granted to the operators
# who run it. Discovered on the first drill, 2026-09-29.
variable "manage_restore_role" {
  description = "Create the eosRestoreTester custom role. Needs iam.roles.create (Role Administrator / Owner), which the consultant account lacks — an HPB Owner applies with -var=manage_restore_role=true once; until then operators get the predefined datastore.restoreAdmin (restore + create scratch DB, but NOT delete)."
  type        = bool
  default     = false
}

resource "google_project_iam_custom_role" "restore_tester" {
  count = var.manage_restore_role ? 1 : 0

  project     = var.project_id
  role_id     = "eosRestoreTester"
  title       = "EOS restore drill operator"
  description = "Restore a Firestore backup into a scratch database and delete that database afterwards. Used for the quarterly restore test only."
  permissions = [
    "datastore.backups.get",
    "datastore.backups.list",
    "datastore.backups.restoreDatabase",
    "datastore.databases.create",
    "datastore.databases.delete",
    "datastore.databases.update", # a restored DB inherits delete protection; must clear it first
    "datastore.databases.getMetadata",
    "datastore.databases.list",
  ]
}

variable "restore_drill_operators" {
  description = "Principals allowed to run the quarterly restore drill (custom role eosRestoreTester). Today the consultant; hand to an HPB operator when one is named."
  type        = list(string)
  default     = ["user:daniel@mcgareyconsulting.com"]
}

resource "google_project_iam_member" "restore_drill_operators" {
  for_each = var.manage_restore_role ? toset(var.restore_drill_operators) : toset([])

  project = var.project_id
  role    = google_project_iam_custom_role.restore_tester[0].id
  member  = each.value
}

# Fallback until the custom role exists: predefined restoreAdmin lets an
# operator restore into a scratch database but not delete it afterwards
# (deletion then needs an Owner, or the custom role above).
resource "google_project_iam_member" "restore_drill_operators_fallback" {
  for_each = var.manage_restore_role ? toset([]) : toset(var.restore_drill_operators)

  project = var.project_id
  role    = "roles/datastore.restoreAdmin"
  member  = each.value
}
