# Security hardening log

Running tracker for the security-hardening program that follows from the
**EOS Security Audit (2026-09-25)** — the client-facing report delivered to
HPB as a Claude artifact
(https://claude.ai/artifact/6TjzpQvZBnkjdEV5S565gF; consultant-side copy,
not in this repo). Its sections are cited as `Scorecard #N`, `Inventory:
<row>`, `Plan step N` and `Settings: <row>`. That report builds on
`docs/SECURITY_AUDIT_2026-09-08.md`, whose code findings are cited by their
code (e.g. `C-07`, `I-07`). Every row here is one line of the report's
scorecard/inventory/plan turning from a finding into shipped, verified
infrastructure or code. This file is the answer to "what's actually done,
versus what the audit merely recommended" — read it alongside the report,
not instead of it. When a row reaches `verified`, the report gets updated to
match.

## How to update

- Add a row (or move an existing one) the moment code merges, a `terraform
  apply` runs, or a manual `gcloud`/Console change lands — don't batch it up.
- **Status** is one of: `planned` (agreed, not yet written) → `in code`
  (merged to `main`/Terraform config, not yet applied to `hpb-eos-prod`) →
  `applied` (live on `hpb-eos-prod`) → `verified` (confirmed against the
  live project — a `gcloud describe`/`list` check, the audit's §6 read-only
  inventory, or a runbook procedure like the quarterly restore test).
- **Evidence** is a link/reference someone else can check without taking
  your word for it: a PR, a `terraform plan`/`apply` output, a `gcloud
  ... describe` result, a restore-test log line, a screenshot filed
  elsewhere.
- Keep one row per discrete item, not one row per audit finding — a finding
  like I-07 spans several rows here (PITR, backups, export, alerts) because
  each ships and gets verified independently.

## Phase 0 — backups (this pass)

| Item | Audit ref | Status | Date | Evidence | Notes |
|---|---|---|---|---|---|
| PITR enabled on `hpb-eos-prod-db` | I-07 | in code | 2026-09-27 | `terraform/firestore.tf` (`point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"`) | Not yet `terraform apply`'d to prod — flip to `applied` once run, `verified` once confirmed live (Inventory: Firestore PITR state) |
| Delete protection on `hpb-eos-prod-db` and `hpb-eos-sandbox-db` | I-07 | in code | 2026-09-27 | `terraform/firestore.tf` (`delete_protection_state = "DELETE_PROTECTION_ENABLED"` on both) | Belt-and-suspenders with `prevent_destroy` + `deletion_policy = "ABANDON"` in the same file |
| Daily backup schedule, 14-week retention | I-07; Plan: item 5 | in code | 2026-09-27 | `terraform/firestore.tf` (`google_firestore_backup_schedule.prod_daily`) | Prod only — see Decisions |
| Weekly backup schedule, 14-week retention | I-07; Plan: item 5 | in code | 2026-09-27 | `terraform/firestore.tf` (`google_firestore_backup_schedule.prod_weekly`, Sunday) | Prod only |
| Archive bucket `hpb-eos-prod-archive` (Cloud Storage, us-central1, 7-yr retention policy, unlocked) | I-07 | in code | 2026-09-27 | `terraform/backup.tf` (`google_storage_bucket.archive`) | Deliberately a different region (us-central1) from the Firestore databases (us-east1); retention policy unlocked — see Decisions |
| Weekly Firestore export → `gs://hpb-eos-prod-archive/firestore/` | I-07 (extends beyond the literal PITR/backup ask) | in code | 2026-09-27 | `terraform/backup.tf` (`google_cloud_scheduler_job.firestore_export`, Sunday 03:00 America/Chicago) | Direct Cloud Scheduler → Firestore `exportDocuments` HTTP call; feeds the eventual BigQuery load — see Decisions |
| Weekly Auth export (`exportAuthUsers`) → `gs://hpb-eos-prod-archive/auth/` | I-07 | in code | 2026-09-27 | `functions/src/export-auth-users.ts`, documented in `docs/OPERATIONS.md` ("Shipped separately") | Sunday 04:00 America/Chicago (1h after the Firestore export); `firebase auth:import` format incl. `role: admin` claim; see `docs/BACKUP_RUNBOOK.md` (e) |
| Alert: export failure | I-07; Plan: item 5 (extension); I-08 | in code | 2026-09-27 | `terraform/monitoring.tf` (`google_monitoring_alert_policy.firestore_export_failed`) | → joe.creighton@, jessica.teichman@highplainsbank.com (`terraform/variables.tf` `alert_emails`). Covers the Firestore export only — `exportAuthUsers` has no alert yet (flagged as a follow-up in its own file header); tracked as a gap, not yet a separate row |
| Alert: backup-schedule change | I-07; I-08 | in code | 2026-09-27 | `terraform/monitoring.tf` (`google_monitoring_alert_policy.backup_schedule_changed`) | Same recipients |
| Alert: database-settings change | I-07; I-08 | in code | 2026-09-27 | `terraform/monitoring.tf` (`google_monitoring_alert_policy.database_settings_changed`) | Same recipients |
| `scripts/restore-test.sh` + `restore-test-count.ts` (quarterly restore drill) | Plan: item 5 (verification); Inventory: Database recovery | in code | 2026-09-27 | `scripts/restore-test.sh`, `pnpm backup:restore-test` | First scheduled run 2026-10-01 — see `docs/BACKUP_RUNBOOK.md` Test log |
| `docs/BACKUP_RUNBOOK.md` (recovery procedures, RPO/RTO, test log) | I-07; Plan: item 5 | in code | 2026-09-27 | `docs/BACKUP_RUNBOOK.md` | — |

## Later gates (placeholders)

| Item | Audit ref | Status | Date | Evidence | Notes |
|---|---|---|---|---|---|
| Next.js framework upgrade (16.2.6 → 16.2.11+) | C-01; Plan: item 1 | planned | — | — | `pnpm audit --prod` baseline is in the audit doc itself |
| Secrets moved to Secret Manager + CMEK key | I-03; I-02(CMEK lever); Plan: items 11–14 | planned | — | — | Currently plain Cloud Run env vars in a laptop `.env.prod` |
| Access-control fixes (meeting-delete leader check, `owner_id` validation) | C-02; C-03; Plan: item 1–2 (code fixes) | planned | — | — | Two HIGH/MEDIUM code findings, not infra |
| Google refresh tokens encrypted with KMS | C-06; Plan: item 11 | planned | — | — | Currently plaintext in Firestore |
| Audit trail: actor stamping on all updates/deletes | C-07; Plan: item 7 | planned | — | — | Audit-log Cloud Function itself is built but most writes carry no actor yet |
| Perimeter / LB (Cloud Armor + IAP + custom domain, drop `allUsers`) | I-01; Plan: item 13 | planned | — | — | Phase 1 per the audit's remediation table |

## Decisions

- **Sandbox (`hpb-eos-sandbox-db`) is not backed up, by design.** It's a
  refreshable copy of prod (`pnpm db:copy`), not a source of truth — see
  `docs/BACKUP_RUNBOOK.md` Sandbox policy. It does get the same delete
  protection and security controls as prod.
- **Archive bucket retention policy is unlocked** until the client confirms
  the 7-year figure and locking is appropriate for their compliance posture.
  Locking a Cloud Storage retention policy is irreversible (you can extend
  it, never shorten or remove it) — do not lock without an explicit client
  sign-off recorded here first.
- **Alert recipients are `joe.creighton@highplainsbank.com` and
  `jessica.teichman@highplainsbank.com`** until the client names a
  distribution list or on-call rotation instead of two named individuals.
- **BigQuery load of the Firestore export is deferred** until the client's
  Jack Henry → BigQuery migration conventions arrive (`docs/ROADMAP.md`
  Pass 10). The weekly export exists now so the data isn't lost while that
  decision is pending — it just isn't being loaded anywhere yet.
