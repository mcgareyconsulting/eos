# Backup & Recovery Runbook — Firestore (Phase 0)

This is the operator runbook for recovering EOS data after loss, corruption,
or a bad deploy. It covers `hpb-eos-prod`'s Firestore database
(`hpb-eos-prod-db`) and the auxiliary exports that back it up further than
Firestore's own recovery window reaches.

Every procedure below shows the **Console click-path** and the **gcloud
command**, because the client's engineer is still learning GCP and should be
able to do this either way. Console menu wording can drift between GCP
releases — if a label below doesn't match what you see, treat the gcloud
command as ground truth and copy-paste it.

**Companion docs:** `docs/OPERATIONS.md` (how the system runs day to day),
`docs/DEPLOY.md` (full deploy reference), `docs/SECURITY_AUDIT_2026-09-08.md`
§2 I-07 (the finding this closes), `docs/HARDENING_LOG.md` (tracks this
program against the audit), and especially
[`terraform/README.md` "Backups and recovery (Phase 0)"](../terraform/README.md)
— that section is the teaching material for *what each control is and why*
(PITR, delete protection, backup schedules, the archive bucket, the export
job, the alerts), each with its own Console path and gcloud command. This
runbook assumes you've read that once and is focused on *what to do when
something's actually wrong*.

---

## Purpose and objectives

Firestore is the **only** copy of live EOS data (rocks, to-dos, scorecards,
issues, meetings, the audit log, org/team/user records). Before Phase 0
there was no way to undo a bad write, a bad `pnpm team:delete`, a bug in a
server action, or an admin mistake — the only "backup" was `pnpm db:copy`
into the sandbox, which is a one-way mirror, not a recovery path. Phase 0
closes that gap with layered, GCP-native recovery:

| Objective | Target | How it's met |
|---|---|---|
| **RPO** (how much data can we lose) | **≤ 1 minute** for anything in the last **7 days**; **≤ 24 hours** beyond that, back to **14 weeks** | Point-in-time recovery (PITR) covers the last 7 days at minute granularity; daily + weekly scheduled backups cover the rest, up to Firestore's 14-week backup-schedule maximum |
| **RTO** (how long recovery takes) | **~1 hour** for a full-database recovery (measured 2026-09-29: restore of the full prod database took 18 min; add rebuild/redeploy + verification) | Restore/clone into a new database (minutes to tens of minutes depending on data size) + rebuild/redeploy the app pointed at it (a few minutes via `pnpm ship`) + verification |

**Why RTO includes a rebuild, not just a restore.** A Firestore restore or
PITR clone always creates a **new** database — you cannot restore "into"
`hpb-eos-prod-db` in place while it still exists, and Firestore backups
don't carry security rules or TTL policies with them. The app's database id
(`NEXT_PUBLIC_FIREBASE_DATABASE_ID`) is a `NEXT_PUBLIC_*` value, which
`scripts/deploy.sh` bakes into the client JS bundle **at build time** — see
`docs/OPERATIONS.md` ("The trap to know") and `docs/DEPLOY.md` §6.2. There is
no runtime override and deliberately no flag to set it live. So a real
recovery is never just "restore and you're done" — it's restore → verify →
point `.env.prod` at the new database id → `pnpm ship` (rebuild + redeploy)
→ re-deploy `firestore.rules`/`firestore.indexes.json` to the new database
(see procedure (c) below for the `firebase.json` step this needs). Procedure
(f) below (the quarterly test) exercises the restore-and-verify half of this
on a throwaway database; it deliberately does **not** repoint the app, so it
can never affect what's live.

---

## What is protected and how

| Layer | Protects against | Retention | Where it lives |
|---|---|---|---|
| **PITR** (point-in-time recovery) | Accidental/bad writes or deletes in the last 7 days — surgical recovery (read old values, write them back) or a full clone at a timestamp | 7 days, minute granularity | `hpb-eos-prod-db` database setting (`point_in_time_recovery_enablement`), managed in `terraform/firestore.tf` |
| **Scheduled backups** (daily + weekly) | Full-database loss/corruption beyond the PITR window | 14 weeks (98 days) — Firestore's backup-schedule maximum | Firestore-managed backups on `hpb-eos-prod-db`, `terraform/firestore.tf` (`google_firestore_backup_schedule.prod_daily` / `.prod_weekly`) |
| **Weekly Firestore export** | Loss of Firestore itself (region incident, account-level issue) or need to go back further than 14 weeks; also feeds the eventual BigQuery load (`docs/ROADMAP.md`, deferred pending client conventions) | Governed by the bucket's retention policy (7 years, currently **unlocked** — see Decisions in `docs/HARDENING_LOG.md`) | `gs://hpb-eos-prod-archive/firestore/`, one dated folder per run, written by the weekly `exportFirestore` Cloud Function (`firebase-schedule-exportFirestore-us-east1`) |
| **Weekly Auth export** | Recovering Firebase Auth accounts/custom claims independent of Firestore (e.g. after a botched offboarding script or IdP issue) | Same bucket policy | `gs://hpb-eos-prod-archive/auth/<timestamp>-users.json` (firebase `auth:import` format), written by the weekly `exportAuthUsers` Cloud Function |
| **Delete protection** | A `gcloud`/Console/API call deleting the whole database outright | Always on | `hpb-eos-prod-db` and `hpb-eos-sandbox-db` database setting (`delete_protection_state`), `terraform/firestore.tf` |
| **Alerts** | Silent failure of the Firestore export or the weekly Auth export, a stale backup/export/auth-export (daily freshness check), or someone flipping a backup schedule or a database setting outside Terraform | N/A | Cloud Monitoring alert policies → `joe.creighton@highplainsbank.com`, `jessica.teichman@highplainsbank.com` |

All of the above is on **`hpb-eos-prod-db`** only — see Sandbox policy.

**Deploying the export functions:** both `exportFirestore` and
`exportAuthUsers` need `functions/.env.hpb-eos-prod` (gitignored; sets
`FIRESTORE_DATABASE_ID=hpb-eos-prod-db` and
`ARCHIVE_BUCKET=hpb-eos-prod-archive`, both non-secret) present locally
before running `firebase deploy --only functions:<name> --non-interactive`
— without it the CLI can't resolve those params non-interactively.

## Sandbox policy

`hpb-eos-sandbox-db` has **no backups, no PITR, no export, by design** — it's
a disposable, refreshable copy of prod (`pnpm db:copy --from hpb-eos-prod-db
--to hpb-eos-sandbox-db`), not a source of truth. Backing it up would mean
paying to protect data that already has a copy of record. It does get the
same **security** controls as prod: delete protection is on (so it can't be
dropped by an accidental console click — `terraform destroy` still works
deliberately, via `deletion_policy = "ABANDON"`), and it shares the same
Firestore rules, indexes, IAM, and Firebase Auth perimeter as prod (`docs/
DEPLOY.md` §3.3). If the sandbox is ever wiped or corrupted, the fix is
`pnpm db:copy`, not a restore procedure.

---

## Procedures

### (a) Check backup health

Do this any time you want to confirm the safety net is actually there —
start of the quarterly test (f), or whenever the alerts in §Alerts below fire.

**Console:**
1. PITR + delete protection: **Firestore → Databases → `hpb-eos-prod-db` →
   Disaster recovery tab**. Confirm point-in-time recovery and delete
   protection both show enabled.
2. Backup schedules and backups: **Firestore → Databases →
   `hpb-eos-prod-db` → Backups tab**. Confirm both a daily and a weekly
   schedule are listed, and that the most recent backup's timestamp is
   within the last 24 hours (daily) / 7 days (weekly).
3. Firestore export: **Cloud Storage → Buckets → `hpb-eos-prod-archive`** →
   `firestore/` prefix. Confirm the newest dated folder
   (`<YYYY-MM-DD>T<HHMMSS>Z/`) is within the last 7–8 days. (You can also
   check **Cloud Scheduler → Jobs →
   `firebase-schedule-exportFirestore-us-east1`** (location `us-east1`) for
   the last run's status and trigger one on-demand via ⋮ → "Force run", or
   read the run's own output under **Cloud Run functions →
   `exportFirestore` → Logs**.)
4. Auth export: same bucket, `auth/` prefix. Confirm the newest
   `<date>T<hhmm>Z-users.json` object is within the last 7–8 days.
5. Alert policies: **Monitoring → Alerting → Policies**. Confirm the three
   Phase 0 policies (export failure, backup-schedule change,
   database-settings change) are listed and enabled, each with both
   `joe.creighton@highplainsbank.com` and `jessica.teichman@highplainsbank.com`
   under **Monitoring → Alerting → Notification channels**.

**gcloud:**
```bash
gcloud firestore databases describe --database=hpb-eos-prod-db --project=hpb-eos-prod \
  --format="value(pointInTimeRecoveryEnablement,deleteProtectionState)"

gcloud firestore backups schedules list \
  --database=hpb-eos-prod-db --project=hpb-eos-prod

gcloud firestore backups list --project=hpb-eos-prod \
  --format="table(name,database,snapshotTime,state)"

gcloud storage ls gs://hpb-eos-prod-archive/firestore/ | tail -5
gcloud storage ls gs://hpb-eos-prod-archive/auth/ | tail -5

# Alert policies/notification channels are a Console-first workflow (see
# terraform/README.md §7) — this lists them, but authoring/editing is
# easiest in the Console:
gcloud alpha monitoring policies list --project=hpb-eos-prod \
  --format="table(displayName,enabled)"
```

### (b) PITR recovery to a point in time

Use this for a bad write/delete that happened in the **last 7 days**, when
you know roughly when things were still good. PITR reads/clones are always
against a **whole minute**, in the past, no earlier than the database's
`earliestVersionTime`. Two shapes:

- **Surgical** (a few documents): a stale read at a past timestamp, then
  write the recovered values back into the *live* database. No new database,
  no redeploy — see the "Work with PITR" guide linked below for the
  read-with-`readTime` pattern; there's no single gcloud one-liner for this,
  it's an application-level read + write using a Firestore client library.
- **Full clone** (whole database at a point in time): creates a **new**
  database — same redeploy consequence as any other restore (see Purpose).

**Console:** **Firestore → Databases → `hpb-eos-prod-db` → Disaster recovery
tab** (this is also where the PITR on/off toggle checked in procedure (a)
lives) → the clone-to-a-point-in-time action → choose a snapshot time within
the last 7 days and a new destination database ID → Create.

**gcloud** (full clone):
```bash
gcloud firestore databases clone \
  --source-database=hpb-eos-prod-db \
  --snapshot-time=2026-09-27T14:00:00Z \
  --destination-database=eos-recovery-20260927 \
  --project=hpb-eos-prod
```
`--snapshot-time` must be RFC3339, a whole minute, in the past. Then follow
the "repoint the app" step in procedure (c).

**Sources:** [Firebase — Point-in-time recovery](https://firebase.google.com/docs/firestore/pitr)
(7-day retention, minute-granularity versions, the three recovery shapes —
stale read, clone, export/import at a timestamp) and
[Firestore backups documentation](https://docs.cloud.google.com/firestore/native/docs/backups)
(restore mechanics, retention limits). Verified against both 2026-09-27.

### (c) Restore from a scheduled backup into a new database, and repoint the app

Use this beyond the 7-day PITR window (up to 14 weeks back), or when you
specifically want last night's/last Sunday's backup rather than an arbitrary
minute.

**Console:** **Firestore → Databases → `hpb-eos-prod-db` → Backups tab**
(same tab where the daily/weekly schedules from `terraform/README.md` §3
show up) → find the backup by date → **Restore** → give it a new database ID
(e.g. `eos-recovery-20260927`) → Create. Wait for the operation to finish
(Firestore → **Operations**, or the notification bell).

**gcloud:**
```bash
# Find the backup
gcloud firestore backups list --project=hpb-eos-prod \
  --format="table(name,snapshotTime,state)"

# Restore it into a new database
gcloud firestore databases restore \
  --source-backup=projects/hpb-eos-prod/locations/us-east1/backups/<BACKUP_ID> \
  --destination-database=eos-recovery-20260927 \
  --project=hpb-eos-prod
```

**Then repoint the app** (this is the part that's easy to skip and doesn't
fail loudly if you do — see Purpose):

1. **Verify the restored database first** — spot-check a few collections
   (`gcloud firestore documents list ...` or reuse
   `scripts/restore-test-count.ts --project hpb-eos-prod --database
   eos-recovery-20260927 --collections rocks,todos,teams`) before cutting
   the app over to it.
2. Deploy rules + indexes to the new database. `firebase.json#firestore`
   only lists `hpb-eos-prod-db` and `hpb-eos-sandbox-db` (`docs/DEPLOY.md`
   §3.2) — temporarily point one of those entries' `"database"` value at
   the new database id, run:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes --project hpb-eos-prod
   ```
   then **revert** the `firebase.json` edit before committing anything
   (same pattern `docs/DEPLOY.md` §3.2 already documents for a one-off
   deploy elsewhere).
3. Update `.env.prod`: set `NEXT_PUBLIC_FIREBASE_DATABASE_ID` to the new
   database id.
4. Rebuild and redeploy:
   ```bash
   pnpm ship
   ```
   (`scripts/deploy.sh` bakes the new database id into the image; there is
   no way to do this without a rebuild — see Purpose.)
5. Smoke-test sign-in and a page load against the new database before
   telling anyone it's back.
6. Once confirmed good, decide whether to keep the old `hpb-eos-prod-db`
   around (read-only, for forensics) or delete it later — don't delete it
   same-day.

### (d) Import from the archive bucket export

Last resort — use this if Firestore backups/PITR are unavailable or you need
data older than 14 weeks (bounded by whatever's still in the bucket).

**Console:** there is no Console button for `firestore import`; browse the
bucket to find the export folder (**Cloud Storage** → `hpb-eos-prod-archive`
→ `firestore/`), then run the gcloud command below — imports are
CLI/API-only.

**gcloud:**
```bash
# Find the export folder (each weekly run writes its own timestamped prefix)
gcloud storage ls gs://hpb-eos-prod-archive/firestore/

# Target database must already exist — create it first if importing into a
# brand-new recovery database (it does NOT get created for you, unlike
# `databases restore`/`clone`):
gcloud firestore databases create --database=eos-recovery-import \
  --location=us-east1 --type=firestore-native --project=hpb-eos-prod

gcloud firestore import gs://hpb-eos-prod-archive/firestore/<EXPORT_FOLDER>/ \
  --database=eos-recovery-import --project=hpb-eos-prod
```
Exports, like backups, don't carry security rules or TTL policies — follow
the same "repoint the app" steps as procedure (c) once the import lands and
is verified.

### (e) Re-import Auth users

Use this if Firebase Auth accounts/claims are lost or corrupted independent
of Firestore (Firestore data and Auth accounts recover on separate tracks).

**Console:** none — the Firebase Console's **Authentication → Users** screen
only adds/edits one user at a time, which doesn't scale to a bulk restore.
This is CLI-only.

**gcloud / firebase CLI:**
```bash
gcloud storage ls gs://hpb-eos-prod-archive/auth/ | tail -5
gcloud storage cp gs://hpb-eos-prod-archive/auth/<TIMESTAMP>-users.json /tmp/users.json

firebase auth:import /tmp/users.json --project hpb-eos-prod
```
Sign-in here is Google OAuth only (no passwords), so no `--hash-algo`/
`--hash-key` flags are needed for this export — those only matter if the
export ever contains password-hash users. Custom claims (`role: "admin"`,
etc.) are included in `exportAuthUsers`'s output and restored by this
import.

### (f) Quarterly restore test

`scripts/restore-test.sh` (registered as `pnpm backup:restore-test`)
automates the "restore a real backup and check the counts" half of
procedure (c) against a throwaway database, then deletes it — this never
touches or repoints the live app.

```bash
pnpm backup:restore-test                  # print the plan, do nothing
pnpm backup:restore-test -- --apply       # restore the newest backup, count, compare, clean up
```

It prints a PASS/FAIL and a ready-to-paste row for the Test log table below.
Run it quarterly, and log the result even on a FAIL (that's exactly the
signal this test exists to catch). See `scripts/README.md` for the full flag
list.

---

## Test log

| Date | Backup used | Result | Tester |
|---|---|---|---|
| 2026-09-29 | `32055a5c-dfc8-467a-96ef-d3a0a185a8b6` (snapshot 2026-09-28T16:19Z) | PASS — 11/12 collections identical; `audit_log` 2448 restored vs 2457 prod = rows written after the snapshot (expected). Restore took 18 min. Scratch DB kept for a client demo; delete needs an Owner (or the custom role) because the restore inherits delete protection | Daniel McGarey (consultant) |

Append a row (via the script's printed output) after every run of
`pnpm backup:restore-test -- --apply`, whether it passes or fails.

---

## Alerts

Three Cloud Monitoring alert policies (Phase 0) email
`joe.creighton@highplainsbank.com` and `jessica.teichman@highplainsbank.com`:

| Alert | Fires when | What to do |
|---|---|---|
| **Export failure** | The weekly Firestore export (`ExportDocuments`) call, made by the `exportFirestore` Cloud Function, errors | Check **Cloud Run functions → `exportFirestore` → Logs** for the error (the function throws on failure, so it shows up as a Cloud Functions error, not a silent miss), fix the underlying cause (quota, permissions, bucket), then trigger a fresh export via the Scheduler job's "Force run" action or `gcloud scheduler jobs run firebase-schedule-exportFirestore-us-east1 --location=us-east1`; this is the one alert that should page an engineer same-day — until it's fixed, the Firestore-export layer in the table above is stale. |
| **Auth export failure** | The weekly `exportAuthUsers` Cloud Function errors (any ERROR-severity log line from its Cloud Run service) | Check **Cloud Run functions → `exportAuthUsers` → Logs**, fix the cause, then force-run `firebase-schedule-exportAuthUsers-us-east1` in Cloud Scheduler (or `gcloud scheduler jobs run firebase-schedule-exportAuthUsers-us-east1 --location=us-east1`). Lower urgency than a Firestore export failure: the Auth directory changes slowly and the previous week's file is still valid for a restore |
| **Backup-schedule change** | `hpb-eos-prod-db`'s daily/weekly backup schedule is created, modified, or deleted outside Terraform | Compare against `terraform/firestore.tf` — if nobody ran `terraform apply` deliberately, treat as a possible unauthorized change and check Cloud Audit Logs for who made it |
| **Database-settings change** | PITR, delete protection, or another `hpb-eos-prod-db` setting changes outside Terraform | Same as above — reconcile against `terraform/firestore.tf`; re-apply Terraform to restore the intended state if the change was accidental or unauthorized |

None of these three alerts means data has already been lost — they mean the
safety net moved without anyone asking it to. Treat a real data-loss
incident (documents actually missing/corrupted) as a recovery job (procedures
(b)–(e)), separate from responding to one of these alerts.
