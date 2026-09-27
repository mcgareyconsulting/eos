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
| PITR enabled on `hpb-eos-prod-db` | I-07 | verified | 2026-09-27 | `gcloud firestore databases list`: POINT_IN_TIME_RECOVERY_ENABLED, earliestVersionTime 2026-09-27T14:32Z | Not yet `terraform apply`'d to prod — flip to `applied` once run, `verified` once confirmed live (Inventory: Firestore PITR state) |
| Delete protection on `hpb-eos-prod-db` and `hpb-eos-sandbox-db` | I-07 | verified | 2026-09-27 | `gcloud firestore databases list`: DELETE_PROTECTION_ENABLED on both | Belt-and-suspenders with `prevent_destroy` + `deletion_policy = "ABANDON"` in the same file |
| Daily backup schedule, 14-week retention | I-07; Plan: item 5 | verified | 2026-09-27 | schedule 2eb3e684-baf9-4e02-9ecf-d08a61fdff7a, retention 8467200s, dailyRecurrence | Prod only — see Decisions |
| Weekly backup schedule, 14-week retention | I-07; Plan: item 5 | verified | 2026-09-27 | schedule f8071207-aec9-4b2b-bb4a-ba12583e95fb, retention 8467200s, SUNDAY | Prod only |
| Archive bucket `hpb-eos-prod-archive` (Cloud Storage, US multi-region, Archive class, 7-yr retention policy, unlocked) | I-07 | verified | 2026-09-27 | `gcloud storage buckets describe`: location US, ARCHIVE, versioning on, PAP enforced, retention 220752000s unlocked; IAM: firestore SA objectAdmin, eos-backup + compute SA objectCreator | First applied as us-central1; Firestore rejected exports to it (`INVALID_ARGUMENT`: a us-east1 database exports only to us-east1 or the US multi-region). Replaced the same day, while empty, with a US multi-region bucket — redundant across >=2 US regions, which is the stronger DR posture anyway. Retention policy unlocked — see Decisions |
| Weekly Firestore export → `gs://hpb-eos-prod-archive/firestore/` | I-07 (extends beyond the literal PITR/backup ask) | applied | 2026-09-27 | Scheduler job eos-firestore-export force-run 2026-09-27 15:58Z: export SUCCESSFUL to gs://hpb-eos-prod-archive/firestore/all_namespaces/… — BUT prefix is undated, so the next run would collide with the retention policy; being replaced by a scheduled function with a dated prefix (see next row) | Direct Cloud Scheduler → Firestore `exportDocuments` HTTP call; feeds the eventual BigQuery load — see Decisions |
| Weekly Auth export (`exportAuthUsers`) → `gs://hpb-eos-prod-archive/auth/` | I-07 | verified | 2026-09-27 | Deployed 2026-09-27 (us-central1, see Notes); force-run wrote auth/2026-09-27T1600Z-users.json + summary: userCount 85, adminCount 10 | Sunday 04:00 America/Chicago (1h after the Firestore export); `firebase auth:import` format incl. `role: admin` claim; see `docs/BACKUP_RUNBOOK.md` (e) |
| Alert: export failure | I-07; Plan: item 5 (extension); I-08 | applied | 2026-09-27 | alertPolicies/9319997606588880846; channels: joe.creighton@, jessica.teichman@ | → joe.creighton@, jessica.teichman@highplainsbank.com (`terraform/variables.tf` `alert_emails`). Covers the Firestore export only — `exportAuthUsers` has no alert yet (flagged as a follow-up in its own file header); tracked as a gap, not yet a separate row |
| Alert: backup-schedule change | I-07; I-08 | applied | 2026-09-27 | alertPolicies/14200065974670063424 | Same recipients |
| Alert: database-settings change | I-07; I-08 | applied | 2026-09-27 | alertPolicies/9555402944935159782 | Same recipients |
| `scripts/restore-test.sh` + `restore-test-count.ts` (quarterly restore drill) | Plan: item 5 (verification); Inventory: Database recovery | in code | 2026-09-27 | `scripts/restore-test.sh`, `pnpm backup:restore-test` | First scheduled run 2026-10-01 — see `docs/BACKUP_RUNBOOK.md` Test log |
| `docs/BACKUP_RUNBOOK.md` (recovery procedures, RPO/RTO, test log) | I-07; Plan: item 5 | in code | 2026-09-27 | `docs/BACKUP_RUNBOOK.md` | — |
| Terraform state → `gs://hpb-eos-tfstate` (us-east1, versioned, soft-delete 7d) | I-04; Plan step 5 (partial) | verified | 2026-09-27 | bucket created by hand in Console; `terraform init -migrate-state`; objects eos/terraform/state/prod.tfstate (+ empty default.tfstate); local copies deleted | Bucket-level IAM still project-default (Editor can read state, which holds the OAuth client secret until step 5) |
| Cloud Run env vars guarded from Terraform (`ignore_changes` on container env) | I-03 | verified | 2026-09-27 | `terraform/cloud_run.tf`; plan showed 0 Cloud Run changes | First plan would have stripped SIGN_IN_ALLOWLIST + GOOGLE_OAUTH_* (set by deploy.sh). Remove the guard when env moves to Secret Manager refs |
| First restore test | Plan: item 5 (verification) | planned | — | — | Needs the first scheduled backup (within 24h of 2026-09-27); run `pnpm backup:restore-test --apply` |

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
