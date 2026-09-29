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
| Weekly Firestore export → `gs://hpb-eos-prod-archive/firestore/` | I-07 (extends beyond the literal PITR/backup ask) | verified | 2026-09-27 | Function `exportFirestore` (us-east1, runs as `eos-backup@hpb-eos-prod.iam.gserviceaccount.com`); scheduler job `firebase-schedule-exportFirestore-us-east1`; first dated run `firestore/2026-09-27T1615Z/`, operation SUCCESSFUL | Cloud Scheduler HTTP job `eos-firestore-export` removed same day — its request body was a fixed string, so every run wrote the same undated prefix and the second run would have collided with the bucket's 7-yr retention policy; feeds the eventual BigQuery load — see Decisions |
| `eos-backup` granted `roles/run.invoker` on Cloud Run service `exportfirestore` (us-east1) | I-07 | verified | 2026-09-27 | `terraform/backup.tf` `google_cloud_run_v2_service_iam_member.backup_invokes_export_firestore`; `gcloud run services get-iam-policy exportfirestore --region=us-east1` | Lets `exportFirestore`'s own Scheduler job invoke it over HTTP as `eos-backup` — gen2 functions run as Cloud Run services under the hood |
| Consultant (`daniel@mcgareyconsulting.com`) granted `roles/iam.serviceAccountUser` on `eos-backup` | I-07 | verified | 2026-09-27 | `terraform/backup.tf` `google_service_account_iam_member.backup_sa_deployers` | **Temporary** deploy-time `actAs` grant so the consultant's account can deploy a function that runs as `eos-backup`; remove at hardening step 5 once deploys move to a dedicated build service account |
| Weekly Auth export (`exportAuthUsers`) → `gs://hpb-eos-prod-archive/auth/` | I-07 | verified | 2026-09-27 | Deployed 2026-09-27 (us-central1, see Notes); force-run wrote auth/2026-09-27T1600Z-users.json + summary: userCount 85, adminCount 10 | Sunday 04:00 America/Chicago (1h after the Firestore export); `firebase auth:import` format incl. `role: admin` claim; see `docs/BACKUP_RUNBOOK.md` (e) |
| Alert: export failure | I-07; Plan: item 5 (extension); I-08 | applied | 2026-09-27 | alertPolicies/9319997606588880846; channels: joe.creighton@, jessica.teichman@ | → joe.creighton@, jessica.teichman@highplainsbank.com (`terraform/variables.tf` `alert_emails`). Covers the Firestore export only — `exportAuthUsers` has no alert yet (flagged as a follow-up in its own file header); tracked as a gap, not yet a separate row |
| Alert: backup-schedule change | I-07; I-08 | applied | 2026-09-27 | alertPolicies/14200065974670063424 | Same recipients |
| Alert: database-settings change | I-07; I-08 | applied | 2026-09-27 | alertPolicies/9555402944935159782 | Same recipients |
| `scripts/restore-test.sh` + `restore-test-count.ts` (quarterly restore drill) | Plan: item 5 (verification); Inventory: Database recovery | in code | 2026-09-27 | `scripts/restore-test.sh`, `pnpm backup:restore-test` | First scheduled run 2026-10-01 — see `docs/BACKUP_RUNBOOK.md` Test log |
| `docs/BACKUP_RUNBOOK.md` (recovery procedures, RPO/RTO, test log) | I-07; Plan: item 5 | in code | 2026-09-27 | `docs/BACKUP_RUNBOOK.md` | — |
| Terraform state → `gs://hpb-eos-tfstate` (us-east1, versioned, soft-delete 7d) | I-04; Plan step 5 (partial) | verified | 2026-09-27 | bucket created by hand in Console; `terraform init -migrate-state`; objects eos/terraform/state/prod.tfstate (+ empty default.tfstate); local copies deleted | Bucket-level IAM still project-default (Editor can read state, which holds the OAuth client secret until step 5) |
| Cloud Run env vars guarded from Terraform (`ignore_changes` on container env) | I-03 | verified | 2026-09-27 | `terraform/cloud_run.tf`; plan showed 0 Cloud Run changes | First plan would have stripped SIGN_IN_ALLOWLIST + GOOGLE_OAUTH_* (set by deploy.sh). Remove the guard when env moves to Secret Manager refs |
| First restore test | Plan: item 5 (verification) | verified | 2026-09-29 | `scripts/restore-test.sh --apply --keep`: backup 32055a5c → `eos-restore-test`, PASS (11/12 exact, audit_log 2448≤2457 expected), restore 18 min | Found: Editor cannot restore or delete databases → predefined `datastore.restoreAdmin` granted to the consultant as a fallback; custom role `eosRestoreTester` in `terraform/restore_drill.tf` gated on `manage_restore_role` (needs an Owner: iam.roles.create). Restored DB inherits delete protection → role includes databases.update. Script fixed to wait for the restore operation and tolerate audit_log growth |
| Backup freshness checker `checkBackupFreshness` (daily 06:00 Central, us-east1, as eos-backup) + alerts "Backup freshness check failed" / "did not run" (metric-absence, 23.5h) | I-07; I-08 | verified | 2026-09-29 | first heartbeat ok=true (backup 23.8h, export 47.9h, auth 0.2h); policies 12635842040633774430 + freshness_failed | Built because Cloud Scheduler silently skipped the 2026-09-28 Sunday export jobs (no attempt logged); a 10-min timer test on exportAuthUsers fired correctly at 16:00Z 2026-09-29, root cause of the skip unknown |
| Alert policies: severity ERROR + operator documentation on all backup alerts | I-08 | verified | 2026-09-29 | 3 in-place updates applied | First real alert email (2026-09-27, our own failed force-run) arrived as "[No severity]" with no instructions |
| Terraform guardrails: `terraform.tfvars` committed (auto-loaded), `region` default us-east1, `prevent_destroy` on Cloud Run service + Artifact Registry | I-04; I-05 | in code | 2026-09-29 | `terraform plan` with no flags = 0 destroys | A plan run without `-var-file` on 2026-09-29 proposed destroying prod Cloud Run + the registry (region defaulted to us-central1); caught by reading the plan |
| Region drift: `exportAuthUsers` + `archiveStaleTodos` deployed to `us-central1` vs. code declaring `us-east1` (`setGlobalOptions({ region: "us-east1" })` in `functions/src/index.ts`) | I-07 | verified | 2026-09-27 | `gcloud functions list`: all four functions in us-east1; us-central1 copies + their scheduler jobs deleted on redeploy | Harmless today (both functions still work), but the deployed region doesn't match the code's stated intent; fix together rather than one-off — likely an import/registration-order issue with `setGlobalOptions` |

## Gate 2 — secrets and keys

Nothing below has been applied. Operator sequence and verification:
`docs/SECRETS_RUNBOOK.md`. Design: `terraform/README.md` "Secrets (Gate 2)".
When a row reaches `applied`/`verified`, record the Cloud Run revision name
and the `gcloud run services describe` env output (refs only) as evidence.

| Item | Audit ref | Status | Date | Evidence | Notes |
|---|---|---|---|---|---|
| Secret Manager secrets `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_TASKS_PULL_SECRET`, `SIGN_IN_ALLOWLIST` (automatic replication, labels, `deletion_protection`) | I-03; Plan step 3 | in code | 2026-09-27 | `terraform/secrets.tf` `google_secret_manager_secret.runtime`; PR #55 (branch `feat/gate2-secrets-terraform`) | No secret versions in Terraform. Values are added out-of-band (`gcloud secrets versions add … --data-file=-`) so they never reach plan output or state |
| `roles/secretmanager.secretAccessor` per secret → runtime SA only | I-03 | in code | 2026-09-27 | `terraform/secrets.tf` `google_secret_manager_secret_iam_member.runtime_accessor` | Resource-scoped, no project-level grant |
| Cloud Run: 3 secrets mounted as env via `secret_key_ref` (`latest`); `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_REDIRECT_URI` as plain env declared in Terraform; env `ignore_changes` removed (Terraform owns env) | I-03 | in code | 2026-09-27 | `terraform/cloud_run.tf`, `terraform/variables.tf` | Precondition refuses to roll a revision while any secret lacks an enabled version. Needs `google_oauth_client_id` / `google_oauth_redirect_uri` in `prod.tfvars`. Image `ignore_changes` kept |
| `scripts/deploy.sh` stops pushing env (`sync_runtime_env` / `--sync-env` removed) | I-03 | in code | 2026-09-27 | `scripts/deploy.sh` | `--sync-env` now refuses with a pointer to Terraform; warns (names only) while `.env.prod` still holds secret values. Dry-run and sandbox refusal unchanged |
| KMS key ring `eos` / key `eos-tokens` (us-east1, ENCRYPT_DECRYPT, 90-day rotation, `prevent_destroy`) + `cloudkms.googleapis.com` | C-06 (prerequisite); Plan item 11 | in code | 2026-09-27 | `terraform/kms.tf`, `terraform/apis.tf` | For application-level (envelope) encryption of Google refresh tokens in the next gate. `enable_cmek` lever untouched |
| `roles/cloudkms.cryptoKeyEncrypterDecrypter` on `eos-tokens` → runtime SA only | C-06 | in code | 2026-09-27 | `terraform/kms.tf` `google_kms_crypto_key_iam_member.runtime_tokens_encrypter_decrypter` | Key-scoped, not key ring or project |
| `docs/SECRETS_RUNBOOK.md` (create → rotate → add versions → apply → verify → finish; cadence; rollback; IAM change) | I-03; C-06 | in code | 2026-09-27 | `docs/SECRETS_RUNBOOK.md` | Console path + gcloud for every step |
| Rotate the Google OAuth client secret | I-03 | planned | — | — | Operator step, not code. Exposed in Terraform output on 2026-09-27 (Cloud Run `env` is not a sensitive attribute). Also in plaintext in past revisions, the versioned state bucket, and `.env.prod`. Add new → version → apply → verify → disable/delete old (runbook steps 2, 5) |
| Purge `.env.prod` of secret values; delete pre-Gate-2 revisions carrying plaintext env | I-03 | planned | — | — | Runbook step 5, after verification |
| Runtime SA `roles/firebaseauth.admin` narrowed | I-06 | planned | — | — | Follow-up, **not** part of Gate 2. See runbook "IAM change" |

## Later gates (placeholders)

| Item | Audit ref | Status | Date | Evidence | Notes |
|---|---|---|---|---|---|
| Next.js framework upgrade (16.2.6 → 16.3.6), firebase 12.19, firebase-admin 14.5 (app + functions), base image digest-pinned | C-01; Plan step 3 | verified (prod rev eos-00112-ght = 38c2af4, PR #53, 2026-09-27) | 2026-09-27 | `pnpm audit --prod`: 35 (3 critical, 18 high) → 6 (0 critical, 3 high, all transitive in google-gax/protobufjs/brace-expansion, no upstream fix yet); functions `npm audit`: 1 high + 12 moderate → 3 moderate; 743/743 tests, lint + tsc + `next build` clean; zero app code changes | Branch feat/gate1-framework-upgrade. Manual sandbox pass pending before ship. Remaining 6 advisories: leave for upstream rather than override Google SDK internals |
| CI merge gate (`.github/workflows/ci.yml`): lint, typecheck, tests, `next build`, `pnpm audit --prod --audit-level=high` (required); functions build + `npm audit --omit=dev --audit-level=high`; terraform fmt/validate | Plan step 2; Scorecard #1; Scorecard #5 | in code | 2026-09-27 | PR from branch chore/ci-and-dependabot; `actionlint` clean | Audit step is required, not advisory. The 3 high transitive advisories from the Gate 1 row above (protobufjs GHSA-wcpc-wj8m-hjx6; brace-expansion GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895 — via firebase-admin → google-gax) are cleared in the same PR by a lockfile-only refresh (protobufjs 7.6.0 → 7.6.6, brace-expansion 2.1.2 → 2.1.7, 1.1.14 → 1.1.21), no overrides; `pnpm audit --prod --audit-level=high` now reports 1 moderate. Branch protection (require the three jobs) is a repo setting, not code — still to do |
| Dependabot version updates (`.github/dependabot.yml`): weekly, minor+patch grouped, for npm `/` + `/functions`, docker `/`, github-actions `/` | Plan step 2; Scorecard #1; Scorecard #5 | in code | 2026-09-27 | PR from branch chore/ci-and-dependabot | Majors of `next`/`eslint-config-next`/`react`/`react-dom`/`firebase-admin` and the `node` base image ignored (deliberate upgrades). Dependabot security alerts/updates are a repo setting — enable separately |
| Secrets moved to Secret Manager + KMS key | I-03; I-02(CMEK lever); Plan: items 11–14 | in code | 2026-09-27 | See "Gate 2 — secrets and keys" above | Tracked per item in the Gate 2 table. The CMEK lever (`enable_cmek`, Artifact Registry at-rest) is a separate decision and still OFF |
| Access-control fixes (meeting-delete leader check, `owner_id` validation) | C-02; C-03; Plan: item 1–2 (code fixes) | planned | — | — | Two HIGH/MEDIUM code findings, not infra |
| Google refresh tokens encrypted with KMS | C-06; Plan: item 11 | planned | — | — | Currently plaintext in Firestore. Key `eos-tokens` + runtime SA grant are in code (Gate 2); the app-side envelope encryption is the next gate |
| Audit trail: actor stamping on all updates/deletes | C-07; Plan: item 7 | planned | — | — | Audit-log Cloud Function itself is built but most writes carry no actor yet |
| Perimeter / LB (Cloud Armor + IAP + custom domain, drop `allUsers`) | I-01; Plan: item 13 | planned | — | — | Phase 1 per the audit's remediation table |

## Gate 3 — access control, session and headers

Branch `feat/gate3-access-auth`. Code only; nothing deployed. Test names are
`describe` › `test` in the named file. C-02 (meeting delete) is not part of
this gate and stays on the placeholder row above.

| Item | Audit ref | Status | Date | Evidence | Notes |
|---|---|---|---|---|---|
| `owner_id` checked against the team roster on to-do, issue and measurable create/update | C-03 | in code | 2026-09-27 | `lib/firebase/teams.ts:196` `requireRosterOwner`; calls at `app/(app)/teams/[teamId]/todos/actions.ts:129,382`, `issues/actions.ts:86,130`, `scorecard/actions.ts:72,151`; tests `lib/firebase/teams.test.ts` › requireRosterOwner (6) | Caller's own uid and the entity's current owner always pass. Headlines have no owner field. Rocks/milestones deliberately excluded (shared rocks have off-roster owners, `lib/rocks-share.ts`) |
| Private to-dos mutable only by owner, team leader or org admin | C-11 | in code | 2026-09-27 | `lib/todo-access.ts:24` `canMutateTodo`; `app/(app)/teams/[teamId]/todos/actions.ts:64` `requireMutableTodo`, used by toggleTodo `:284`, updateTodoMeta `:361`, toggleWeeklyFocus `:595`, deleteTodo `:618`, setTodoArchived `:648`; `firestore.rules:239` `todoMutableByMe`; tests `lib/todo-access.test.ts` › canMutateTodo (6) | Refusal is a 404 (the caller can't read the to-do either). Rules previously let any member update/delete any team to-do from the client; now mirrored. No rules emulator test harness exists — covered by the manual checklist |
| `email_verified === true` required at sign-in and in `inDomain()` | C-04 | in code | 2026-09-27 | `lib/auth-allowlist.ts:68` `signInRefusal`; `lib/firebase/session.ts:114` `createSession`; `firestore.rules:33`; tests `lib/auth-allowlist.test.ts` › signInRefusal (5), `lib/firebase/session.test.ts` › createSession (4) | Applies whether or not SIGN_IN_ALLOWLIST is set; allowlist logic unchanged. Identity Platform blocking function (audit's "better" fix) not done |
| 12-hour session, sliding renewal at half-life | C-05 | in code | 2026-09-27 | `lib/session-policy.ts:15`; `lib/firebase/session.ts:132` `renewSession`, `:172` `verifySession` (12h from `iat`, legacy 5-day cookies included); `lib/firebase/auth.ts` `getSessionRenewInMs`; `components/session-keeper.tsx:23`; `app/(app)/session-actions.ts`; tests `lib/session-policy.test.ts` › session policy (7), `lib/firebase/session.test.ts` › verifySession (3), renewSession (5) | Browser posts a fresh ID token on the first interaction past the half-life; server re-applies the sign-in perimeter, so removal from SIGN_IN_ALLOWLIST now ends a session within 12h. No per-request writes. Workspace-offboarding job (rest of C-05) not done |
| Sign-out revokes refresh tokens, then clears the cookie | C-05 | in code | 2026-09-27 | `lib/firebase/session.ts:153` `endSession`; `app/(app)/sign-out-action.ts:9`; tests `lib/firebase/session.test.ts` › endSession (3) | Revocation is per user, so signing out ends that user's sessions on every device |
| Pull-route bearer compared in constant time | C-09 | in code | 2026-09-27 | `lib/google/tasks.ts:722` `bearerMatches` (length guard + `crypto.timingSafeEqual`); `app/api/google/tasks/pull/route.ts:28`; tests `lib/google/tasks.test.ts` › bearerMatches (4) | Scheduler OIDC in place of the shared secret is Phase 2 |
| OAuth redirect URI fails closed in production | C-12 | in code | 2026-09-27 | `lib/google/tasks.ts:57` (`resolveRedirectUri`, and so `appOrigin`); tests `lib/google/tasks.test.ts` › resolveRedirectUri › "fails closed in production when unset (C-12)", "uses the env var in production when set" | Request-derived fallback kept for dev only |
| Free-text length caps (500 titles/names, 20,000 long text) | C-10 | in code | 2026-09-27 | `lib/text-limits.ts:18` `requireMaxLength`; applied in `app/(app)/teams/[teamId]/todos`, `issues`, `headlines`, `rocks` (incl. milestone titles), `meetings` (`saveMeetingNotes` `:609`), `scorecard` (measurable + group names) actions; tests `lib/text-limits.test.ts` › requireMaxLength (4) | Server-side only; no form had a counter UI. Meeting-notes textarea got `maxLength` so an autosave can't hit the error boundary |
| Security headers: HSTS, nosniff, Referrer-Policy, Permissions-Policy (COOP kept) | C-08 | in code | 2026-09-27 | `next.config.ts:47-55`; response headers confirmed with `pnpm dev` and `pnpm start` | Audit suggests moving HSTS to the load balancer in Phase 1 |
| Content-Security-Policy **report-only**, per-request nonce + theme-script hash | C-08 | in code | 2026-09-27 | `lib/csp.ts:50` `buildCsp`; `proxy.ts:12`; `app/not-found.tsx` (dynamic so it gets the nonce); tests `lib/csp.test.ts` › buildCsp (5), scriptHash / newNonce (2) | Not enforced. Local check: zero violations on /login, 404 and redirects under `pnpm dev` and `pnpm start`. Enforce after a clean report window on sandbox + prod |
| `/api/csp-report` violation sink | C-08 | in code | 2026-09-27 | `app/api/csp-report/route.ts:19`; `lib/csp-report.ts:48`; tests `lib/csp-report.test.ts` › parseCspReports (5), redactUrl (1), rateLimiter (1) | Public like /api/client-error: body cap, 60/min per instance, URLs reduced to origin+path, never echoes input. `report-uri` delivery confirmed end to end in Chromium; `report-to` needs https to verify |

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
- **The first, undated Firestore export stays in the archive bucket.** The
  removed Cloud Scheduler job's force-run wrote
  `gs://hpb-eos-prod-archive/firestore/all_namespaces/...` on 2026-09-27
  15:58Z; it can't be deleted while the bucket's retention policy holds, and
  it's a valid export in its own right — it just isn't part of the ongoing
  dated-prefix pattern the `exportFirestore` function establishes going
  forward.
- **Archive bucket is `US` multi-region, not a single region.** Firestore
  only allows exporting to a bucket in the *same* region as the database or
  the `US` multi-region — `hpb-eos-prod-db` is in `us-east1`, and exporting
  to a single other region (e.g. `us-central1`, the first location tried)
  is rejected with `INVALID_ARGUMENT` (confirmed 2026-09-27). `US`
  multi-region also gives redundancy across ≥2 US regions, which is the
  stronger DR posture for backups anyway.
