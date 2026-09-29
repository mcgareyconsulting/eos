#!/usr/bin/env bash
# Quarterly backup restore test: restores the newest (or a named) Firestore
# scheduled backup into a throwaway database, sanity-checks it against the
# live database by counting documents in the collections that matter, then
# tears the throwaway database back down. This is the script referenced by
# `docs/BACKUP_RUNBOOK.md` procedure (f) — the whole point of a backup
# nobody has ever restored is that you don't actually know it works.
#
#   pnpm backup:restore-test                        # print the plan, do nothing
#   pnpm backup:restore-test -- --apply              # actually run the test
#   pnpm backup:restore-test -- --apply --keep       # leave the restored DB up afterwards
#   pnpm backup:restore-test -- --backup projects/hpb-eos-prod/locations/us-east1/backups/abc123 --apply
#   pnpm backup:restore-test -- --target eos-restore-test-2 --apply
#
# Dry-run by default — pass --apply to actually restore anything. Even the
# dry run makes a couple of read-only gcloud calls (finding the newest
# backup, checking the target name is free) so the printed plan is accurate,
# not guessed.
#
# What this never does: write to, delete from, or restore over the SOURCE
# database. Every read against it is a server-side count() aggregation.
# Everything destructive here (the restore, the delete) targets ONLY
# --target, which is refused outright if it looks anything like a real
# database (see guards below).

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=hpb-eos-prod
DATABASE=hpb-eos-prod-db     # source — read-only, never modified
TARGET=eos-restore-test      # destination — created and (usually) destroyed
BACKUP=""                    # empty = auto-pick the newest backup for $DATABASE
KEEP=false
APPLY=false

# Firestore backup resource names embed a location. Source database is
# us-east1 (see docs/DEPLOY.md §3.1); used only to expand a bare --backup id
# into a full resource name. Backups discovered via `backups list` already
# carry their full name and don't need this.
LOCATION=us-east1

# Collections a restore is judged against. Keep this in sync with
# scripts/restore-test-count.ts's caller below and with the collections
# team-info.ts/delete-team.ts already treat as "real EOS data" — this list
# is deliberately broader (it includes org/identity collections those don't
# scope by team) because a restore test should catch a missing collection
# entirely, not just a miscounted one.
COLLECTIONS=(
  organizations
  users
  teams
  team_members
  rocks
  todos
  issues
  headlines
  scorecard_metrics
  scorecard_entries
  meetings
  audit_log
)
COLLECTIONS_CSV="$(IFS=,; echo "${COLLECTIONS[*]}")"

usage() {
  cat <<'USAGE'
Usage: pnpm backup:restore-test [-- options]
  --project <id>     GCP project (default: hpb-eos-prod)
  --database <id>    Source Firestore database to restore FROM (default: hpb-eos-prod-db)
  --target <id>      Throwaway database to restore INTO (default: eos-restore-test)
  --backup <name>    Backup to restore (default: newest backup for --database).
                      Accepts a full resource name
                      (projects/P/locations/L/backups/B) or a bare backup id.
  --keep             Don't delete --target after the test (default: delete it)
  --apply            Actually run the restore/count/delete. Without it: print
                      the plan and exit.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --database) DATABASE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --backup) BACKUP="$2"; shift 2 ;;
    --keep) KEEP=true; shift ;;
    --apply) APPLY=true; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift ;;  # pnpm run forwards a bare "--" on some versions; ignore it
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

command -v gcloud >/dev/null 2>&1 || { echo "gcloud not found on PATH."; exit 1; }

# --- Guards -------------------------------------------------------------
# A restore test that accidentally targets a real database is exactly the
# incident this script exists to prevent testing for.

if [[ "$TARGET" == "$DATABASE" ]]; then
  echo "Refusing: --target is the same as --database ($DATABASE)."
  exit 1
fi

if [[ "$TARGET" == *prod-db* || "$TARGET" == *sandbox-db* ]]; then
  echo "Refusing: --target '$TARGET' looks like a real database (contains 'prod-db' or 'sandbox-db')."
  echo "Pick a name that can't be mistaken for one, e.g. eos-restore-test."
  exit 1
fi

echo "Project:    $PROJECT"
echo "Source:     $DATABASE  (read-only)"
echo "Target:     $TARGET"

# --- Resolve the backup to restore --------------------------------------

if [[ -z "$BACKUP" ]]; then
  echo
  echo "No --backup given — finding the newest backup for $DATABASE..."
  BACKUPS_JSON="$(gcloud firestore backups list --project="$PROJECT" --format=json)"
  BACKUP="$(node -e '
    const backups = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const db = process.argv[1];
    const forDb = backups.filter((b) => (b.database || "").endsWith("/databases/" + db));
    if (forDb.length === 0) process.exit(1);
    forDb.sort((a, b) => new Date(b.snapshotTime) - new Date(a.snapshotTime));
    console.log(forDb[0].name);
  ' "$DATABASE" <<<"$BACKUPS_JSON")" || {
    echo "Refusing: no backups found for database '$DATABASE' in project '$PROJECT'."
    echo "Check 'gcloud firestore backups list --project=$PROJECT' and the backup schedules in terraform/firestore.tf."
    exit 1
  }
elif [[ "$BACKUP" != */backups/* ]]; then
  # Bare id passed — expand it into a full resource name.
  BACKUP="projects/${PROJECT}/locations/${LOCATION}/backups/${BACKUP}"
fi

echo "Backup:     $BACKUP"

# --- Guard: target must not already exist -------------------------------

if gcloud firestore databases describe --database="$TARGET" --project="$PROJECT" >/dev/null 2>&1; then
  echo
  echo "Refusing: database '$TARGET' already exists in $PROJECT."
  echo "Delete it first (gcloud firestore databases delete --database=$TARGET --project=$PROJECT --quiet)"
  echo "or pick a different --target name."
  exit 1
fi

echo
echo "Plan:"
echo "  1. gcloud firestore databases restore --source-backup=$BACKUP --destination-database=$TARGET --project=$PROJECT"
echo "  2. Count [${COLLECTIONS_CSV}] in both '$DATABASE' and '$TARGET' via scripts/restore-test-count.ts"
echo "  3. Print PASS if every count matches, FAIL otherwise (exit code follows)"
if $KEEP; then
  echo "  4. --keep passed: leave '$TARGET' in place"
else
  echo "  4. gcloud firestore databases delete --database=$TARGET --project=$PROJECT --quiet"
fi

if ! $APPLY; then
  echo
  echo "Dry run — nothing restored. Re-run with --apply to actually run the test."
  exit 0
fi

# --- 1. Restore -----------------------------------------------------------

echo
echo "Restoring... (this can take several minutes for a database of any size)"
gcloud firestore databases restore \
  --source-backup="$BACKUP" \
  --destination-database="$TARGET" \
  --project="$PROJECT"
# `databases restore` returns once the database exists; the data restore keeps
# running in the background and the database refuses queries until it
# finishes (FAILED_PRECONDITION "undergoing a restore"). Poll the database's
# sourceInfo until it reports COMPLETED (18 min for prod on 2026-09-29).
echo "Waiting for the restore operation to complete..."
for _ in $(seq 1 90); do
  progress="$(gcloud firestore databases describe --database="$TARGET" --project="$PROJECT" --format='value(sourceInfo.progress)' 2>/dev/null || true)"
  case "$progress" in
    COMPLETED|"") break ;;
    IN_PROGRESS) sleep 20 ;;
    *) echo "Restore ended in state: $progress"; exit 1 ;;
  esac
done
echo "Restore complete: $TARGET"

# --- 2. Count both sides ---------------------------------------------------
# Counts are aggregation queries (Admin SDK .count()), not full reads — cheap
# and, on the source side, strictly read-only.

echo
echo "Counting collections..."
SRC_JSON="$(pnpm exec tsx scripts/restore-test-count.ts \
  --project "$PROJECT" --database "$DATABASE" --collections "$COLLECTIONS_CSV")"
DST_JSON="$(pnpm exec tsx scripts/restore-test-count.ts \
  --project "$PROJECT" --database "$TARGET" --collections "$COLLECTIONS_CSV")"

# --- 3. Compare + report ----------------------------------------------------

RESULT="$(node -e '
  const src = JSON.parse(process.argv[1]).counts;
  const dst = JSON.parse(process.argv[2]).counts;
  const cols = process.argv[3].split(",");
  let pass = true;
  console.log("");
  console.log(
    "  " + "collection".padEnd(22) + "source".padStart(10) + "target".padStart(10) + "  ",
  );
  for (const c of cols) {
    const s = src[c] ?? 0;
    const d = dst[c] ?? 0;
    // audit_log only grows: rows written to prod after the backup
    // snapshot are expected to be missing from the restore. Any other
    // collection must match exactly.
    const ok = c === "audit_log" ? d <= s : s === d;
    if (!ok) pass = false;
    console.log(
      "  " + c.padEnd(22) + String(s).padStart(10) + String(d).padStart(10) +
        (ok ? (s === d ? "" : "  (rows since snapshot)") : "  <-- mismatch"),
    );
  }
  console.log("");
  console.log(pass ? "PASS" : "FAIL");
' "$SRC_JSON" "$DST_JSON" "$COLLECTIONS_CSV")"

echo "$RESULT"
PASS_FAIL="$(echo "$RESULT" | tail -1)"

echo
echo "Note: counts are compared against the CURRENT source database, not the"
echo "backup's snapshot time. A mismatch can mean the restore is broken, OR it"
echo "can just mean prod has taken writes since the backup was taken — check"
echo "the backup's snapshotTime against how recently the mismatched rows changed"
echo "before treating a FAIL as a broken backup."

# --- 4. Clean up -------------------------------------------------------

if $KEEP; then
  echo
  echo "--keep passed: '$TARGET' left in place. Remember to delete it later:"
  echo "  gcloud firestore databases delete --database=$TARGET --project=$PROJECT --quiet"
else
  echo
  echo "Deleting '$TARGET'..."
  gcloud firestore databases delete --database="$TARGET" --project="$PROJECT" --quiet
  echo "Deleted."
fi

echo
echo "Elapsed: ${SECONDS}s"

TESTER="$(git config user.name 2>/dev/null || echo "${USER:-unknown}")"
TODAY="$(date +%F)"
echo
echo "Test log entry — paste into docs/BACKUP_RUNBOOK.md's test log table:"
echo "| $TODAY | $BACKUP | $PASS_FAIL | $TESTER |"

[[ "$PASS_FAIL" == "PASS" ]]
