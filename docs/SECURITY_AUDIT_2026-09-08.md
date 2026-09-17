# Security audit — code + GCP infrastructure as code (2026-09-08)

**Scope.** Static review of the full repository (Next.js app, server
actions, API routes, `proxy.ts`, `firestore.rules`, Cloud Functions,
Terraform, Cloud Build, Dockerfile, operator scripts, deploy docs) plus the
production facts recorded in `docs/` and the local Terraform state resource
list. **No live GCP resources were inspected** — every infra finding below
is "as coded/documented"; a read-only `gcloud` inventory is queued as the
last step (see §6) and will confirm or correct the live state.

**Companion:** `TARGET_ARCHITECTURE.md` (where we're going).
**Prior audit:** `SECURITY_AUDIT_2026-08-31.md` — reconciled in §5.

## Executive summary

The application code is in good shape: every server action is guarded,
cross-team access is blocked by a consistent `requireTeamDoc` check, there
are no client-side Firestore writes, no XSS sinks, no secrets in the repo,
and sessions are HttpOnly cookies verified with revocation checks. Two code
defects need fixing (a member can delete any meeting; an unvalidated
`owner_id` can push tasks into another user's Google account), and the
framework itself is nine advisories behind.

The infrastructure is where the gap is, and it is a *design* gap, not a
bug: the app is a public Cloud Run URL whose only gate is sign-in inside the
app; secrets are plain environment variables; Terraform state is on a
laptop; the deploy identity is the Compute Engine default service account;
every Tier-1 lever (PITR, backups, CMEK, Data Access logs, Cloud Armor) is
off; and the consultant's personal account is hardcoded into the security
rules and may still hold IAM-admin on the production project. None of that
is hidden — the docs say so — but it is the opposite of the VPC-centric
posture leadership now wants.

| Severity | Code | Infra |
| --- | --- | --- |
| High | 2 | 3 |
| Medium | 5 | 6 |
| Low | 6 | 3 |

---

## 1. Code findings

### C-01 — Next.js 16.2.6 carries nine published advisories, fixed in 16.2.11 (HIGH)

`pnpm audit --prod` (2026-09-08): 31 advisories total (1 critical, 17 high,
12 moderate, 1 low). The ones that matter for this app:

- **GHSA-6gpp-xcg3-4w24** Middleware/Proxy bypass in App Router (high).
  `proxy.ts` is only a cookie-presence gate and every page/route re-verifies
  the session, so impact is contained — but the gate we rely on for
  redirect hygiene is bypassable.
- **GHSA-m99w-x7hq-7vfj** DoS via Server Actions (high); GHSA-89xv-2m56-2m9x
  / GHSA-p9j2-gv94-2wf4 SSRF in Server Actions / rewrites (high);
  GHSA-955p-x3mx-jcvp unauthenticated disclosure of Server Function
  endpoints (moderate); two cache-confusion advisories (moderate).
- Transitive: `@grpc/grpc-js` (server crash on malformed message, high),
  `protobufjs` (DoS, high), `form-data` (CRLF injection, high),
  `websocket-driver` (critical, via `firebase-tools` devDependency — not in
  the runtime image), `postcss`/`nanoid`/`browserslist` (build-time).
- `functions/`: `npm audit --omit=dev` reports 13 (1 high) in the
  `firebase-admin` → `@google-cloud/*` chain.

**Fix:** `pnpm up next@^16.2.11 eslint-config-next@^16.2.11`, then
`pnpm up --latest firebase-admin firebase` and re-run audit; bump
`functions/` deps the same way. Add `pnpm audit --prod --audit-level=high`
to the build so this cannot drift again.

### C-02 — Any team member can delete any meeting, including a live one (HIGH)

`app/(app)/teams/[teamId]/meetings/actions.ts:540` — `deleteMeeting` uses
`requireTeamAccess` (any member) while `startMeeting`, `advanceSegment` and
`endMeeting` correctly use `requireTeamLeader`. It batch-deletes the meeting
and its `effectiveness_scores`. The trash icon in `meetings-list.tsx:170` is
also shown to every member. `firestore.rules` mirrors this: `meetings`
`allow delete` is membership-only, even for concluded meetings.

**Fix:** `requireTeamLeader(teamId)` in `deleteMeeting`; hide the control
for non-leaders; in rules, `allow delete: if admin() || isLeader(...)`.

### C-03 — Unvalidated `owner_id` pushes tasks into another user's Google account (MEDIUM)

`todos/actions.ts:46` (`addTodo`) and `:144` (`updateTodoMeta`) take
`owner_id` as a raw string with no roster check and pass it to
`upsertTaskForTodo(owner_id, …)` (`lib/google/tasks.ts:430`), which loads
`google_tasks_connections/{owner_id}` and writes a task into that person's
real Google Tasks list. Any member who knows a uid (rosters are readable
org-wide) can create tasks in a colleague's Google account. The same
unchecked pattern exists for issues, rocks, milestones and scorecard
metrics (display-only impact there).

**Fix:** validate `owner_id` against `getTeamMembers(teamId)` before use —
the pattern already exists in `import/actions.ts:164` and `setMeetingDriver`.

### C-04 — Sign-in perimeter never checks `email_verified` (MEDIUM, reopened)

`lib/firebase/session.ts` and `inDomain()` in `firestore.rules` gate on the
email string only. Safe while Google is the only provider; the moment SSO
work (roadmap N52) adds a provider, `anyone@highplainsbank.com` unverified
gets in. **Fix:** require `decoded.email_verified === true` in
`createSession` and `request.auth.token.email_verified == true` in rules.
Better: enforce both in an Identity Platform blocking function (see
architecture §4), which also stops token minting for outside accounts.

### C-05 — Session lifecycle: 5-day cookie, no revoke on sign-out, no offboarding hook (MEDIUM)

`session.ts:7` sets a 5-day session with no idle timeout; `signOut` only
deletes the cookie (`sign-out-action.ts`), so a captured cookie stays valid
for the remainder of the 5 days. Removing someone from `SIGN_IN_ALLOWLIST`
or suspending their Workspace account does not end an existing session —
`checkRevoked` only sees Firebase-side revocation, which nothing triggers.
For a bank, session length should match policy (typically 8–12 h) and
offboarding must terminate access. **Fix:** shorten `expiresIn`; call
`auth.revokeRefreshTokens(uid)` on sign-out; add a nightly job (or
Directory push) that disables Firebase users no longer active in Workspace.

### C-06 — Google refresh tokens stored in plaintext in Firestore (MEDIUM)

`lib/google/tasks.ts:198-214` writes `refresh_token`/`access_token` to
`google_tasks_connections/{uid}`. Rules deny clients, the audit trigger now
excludes the collection (prior H1, fixed), but anyone with `datastore.user`
or Firestore viewer on the project — the runtime SA, the consultant, any
future operator — can read every user's Google refresh token. **Fix:**
encrypt the refresh token with a Cloud KMS key before storage (envelope
encryption, ~30 lines) or store it in Secret Manager per user; the file's
own header already lists this as the hardening step.

### C-07 — Most updates carry no actor, so the audit log can't say who changed what (MEDIUM)

The Cloud Function audit trigger records `actor_uid` only for client-SDK
writes; every server action is an Admin SDK write and lands with
`auth_type: service_account`. Creates mostly stamp `created_by`/`user_id`,
but `updateIssueMeta`, `updateHeadline`, `updateTodoMeta`, `setEntry`,
`updateMetric`, `setMemberRole`, `setMeetingDriver`, `saveMeetingNotes`,
`setIssueStatus`, `setRockArchived`, `setTodoArchived` and the delete
actions write nothing. For a bank audit trail this is the difference
between "someone changed the scorecard" and "Jane changed it at 14:02".
**Fix:** a `stamp(uid)` helper merged into every `update`/`set`
(`updated_by`, `updated_at`), and `deleted_by` written before deletes (or
soft-delete). The function then surfaces `after.updated_by` as the actor.

### C-08 — No security headers beyond COOP (LOW)

`next.config.ts` sets only `Cross-Origin-Opener-Policy`. Missing:
`Strict-Transport-Security`, `Content-Security-Policy` (at least
`frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`,
`Referrer-Policy`, `Permissions-Policy`. The app can be framed
(clickjacking) and has no script-source policy. **Fix:** add the header set
in `next.config.ts` now; move HSTS to the load balancer in Phase 1.

### C-09 — Scheduler pull route: static shared bearer on a public path, non-constant-time compare (LOW)

`app/api/google/tasks/pull/route.ts:29` compares with `!==`; the route is
public (exempted in `proxy.ts`) and the secret is a plain env var. **Fix:**
`crypto.timingSafeEqual` now; replace the secret with Cloud Scheduler OIDC
and verify the ID token's audience/issuer (Phase 2).

### C-10 — Uncapped free-text fields (LOW)

`saveMeetingNotes` (`meetings/actions.ts:463`), headline title/body, issue
title/description, metric/group names have no length cap; comments are
capped at 4000. Storage/UI abuse only. **Fix:** apply the comment cap
pattern.

### C-11 — "Private" to-dos are private to read, not to edit (LOW)

`toggleTodo`/`updateTodoMeta`/`deleteTodo`/`setTodoArchived` check team
membership only; rules match. Any member who knows the id can modify or
delete a colleague's private to-do. Deliberate today; flagging because
users will read "Private" as stronger than it is. **Fix:** owner-or-leader
check on mutation when `visibility == "private"`.

### C-12 — OAuth redirect URI falls back to request-derived origin (LOW)

`lib/google/tasks.ts:47-64`: when `GOOGLE_OAUTH_REDIRECT_URI` is unset the
callback and post-callback redirect are built from the request host. Safe
when the env var is set (documented as required on Cloud Run). **Fix:**
throw in production if unset, so a misconfigured deploy fails closed.

### C-13 — `FIREBASE_SERVICE_ACCOUNT_JSON` code path invites key export (LOW)

`lib/firebase/admin.ts:16` and two scripts accept a pasted SA key. The
Terraform README says "no exported keys anywhere"; the code says otherwise.
**Fix:** delete the path; ADC only. Enforce with org policy.

### C-14 — Housekeeping (INFO)

- `pullCompletionsForAllConnected` has no per-run user/time bound.
- `/api/client-error` rate limit is per instance (60/min each).
- `archiveStaleTodos` is pinned to `us-central1` while the database and the
  audit triggers are `us-east1` — operational, not security.
- Cloud Functions gen2 run as the Compute Engine default SA unless
  `serviceAccount` is set; the code sets none. See I-05.

---

## 2. Infrastructure findings (as coded and documented)

### I-01 — The app is a public internet service with sign-in as its only gate (HIGH)

`terraform/cloud_run.tf`: `ingress = "INGRESS_TRAFFIC_ALL"` and
`allUsers → roles/run.invoker`; `cloudbuild.yaml` deploys
`--allow-unauthenticated`. No load balancer, Cloud Armor, IAP, custom
domain, or VPC exists (`terraform/README.md` "TODO: Build load_balancer.tf";
`CUTOVER_CHECKLIST.md` custom-domain step unchecked). Separately, the
Firebase web API key lets *any* Google account mint an ID token for the
project, so Firestore is reachable from the internet with `firestore.rules`
as the only barrier. This is the documented MVP trade-off
(`HPB_IAM_REQUEST.md`), and it is what leadership is asking to change.
**Fix:** Phases 1–2 of `TARGET_ARCHITECTURE.md`; blocking function for
Identity Platform.

### I-02 — Consultant personal account: hardcoded in rules, possibly IAM-admin on prod, retirement not done (HIGH)

- `firestore.rules` `inDomain()` hardcodes `daniel@mcgareyconsulting.com`.
- `HPB_IAM_REQUEST.md` Option A asked for `projectIamAdmin`,
  `serviceAccountAdmin`, `run.admin` on `hpb-eos-prod` for that account,
  "revoke after cutover". `ROADMAP.md` open question 4 says which option
  was applied was never confirmed; workstream F3 (break-glass retirement,
  Vercel SA-key rotation, `GEMINI_API_KEY` revocation) is `not-started`.
- The account also holds `roles/editor`.

A personal Gmail with IAM-admin on a bank's production project will not
pass a security review. **Fix:** confirm and revoke the temporary grants;
replace the hardcoded email with a claim-based check; rotate/revoke the
Vercel key and Gemini key and record evidence; move consultant access to an
HPB-issued account or time-boxed IAM.

### I-03 — Secrets are plain Cloud Run env vars, held in a laptop `.env.prod` (HIGH)

`scripts/deploy.sh` pushes `GOOGLE_OAUTH_CLIENT_SECRET` (and the docs push
`GOOGLE_TASKS_PULL_SECRET`, `SIGN_IN_ALLOWLIST`) with
`--update-env-vars`. They are readable by anyone with `run.viewer`, appear
in every revision, in Terraform plan/state, and live in `.env.prod` on the
consultant's machine. `secretmanager.googleapis.com` is enabled and
`CUTOVER_CHECKLIST.md` §9 describes Secret Manager, but nothing uses it.
**Fix:** create the secrets in Secret Manager, grant the runtime SA
`secretAccessor` per secret, mount by reference (`--set-secrets`), delete
the env-var copies, purge `.env.prod` of secret values.

### I-04 — Terraform state is local, unlocked, unversioned, and contains prod attributes (MEDIUM)

`terraform/versions.tf` backend block is commented out; two state files
exist on disk (`terraform.tfstate`, `terraform.tfstate.d/prod/`) with the
full prod resource graph, including Cloud Run env values. **Fix:** GCS
backend with versioning and CMEK, `prevent_destroy` on the bucket, then
`terraform init -migrate-state`; shred the local copies.

### I-05 — Deploy identity is the Compute Engine default SA; deploys run from a laptop; no supply-chain controls (MEDIUM)

`iam.tf` grants `run.admin`, `artifactregistry.writer`,
`iam.serviceAccountUser` to `<project-number>-compute@`, which normally also
carries project Editor. Cloud Functions gen2 run as the same SA by default.
No Cloud Build trigger exists (roadmap N19); every deploy is `pnpm ship`
under whoever's `gcloud` credentials. No vulnerability scanning, no Binary
Authorization, images also tagged `latest`, base image `node:22-alpine` not
digest-pinned. **Fix:** dedicated `eos-build` and `eos-functions` SAs;
Bitbucket → Cloud Build via Workload Identity Federation; enable Artifact
Analysis; pin digests; Binary Authorization in Phase 2.

### I-06 — Runtime SA holds `roles/firebaseauth.admin` (MEDIUM)

Needed for `createSessionCookie`, but it is full Identity Platform admin:
a compromised app instance can create users, set custom claims (including
`role: admin`), and mint sessions for anyone. **Fix:** evaluate a custom
role limited to session-cookie creation and user lookup; if the API
requires the full role, treat this as a reason IAP must front the app
(compromise requires a second gate) and alert on `SetAccountInfo`/
`setCustomUserClaims` in audit logs.

### I-07 — No PITR, no scheduled backups, no CMEK, no Data Access logs, no delete protection (MEDIUM)

All four Terraform levers default OFF and the roadmap "Owed" table shows
the client never picked a tier. `CLIENT_GCP_SETUP.md` promises scheduled
backups, monitoring, and budget alerts as "Tier 0, on by default"; none
exist in `terraform/` (roadmap F2 `not-started`). A bad deploy or a
malicious admin can destroy the database with no recovery path. **Fix:**
turn on PITR and a daily backup schedule this week (cheap), CMEK and Data
Access logs in Phase 3; correct the client-facing doc.

### I-08 — No org policies, no SCC, no alerting (MEDIUM)

`iam.disableServiceAccountKeyCreation` is commented out;
`iam.allowedPolicyMemberDomains` is `allValues: ALLOW`
(`HPB_IAM_REQUEST.md`). No log-based alerts on IAM changes, no uptime
check, no budget alert, no SCC routing documented. **Fix:** architecture §7
policy set; SCC Standard on; alert on IAM policy changes, SA key creation,
Cloud Run IAM changes, Firestore database delete.

### I-09 — Identity Platform accepts any Google account; API key unrestricted (MEDIUM)

No blocking function, no `hd` enforcement at the provider. Outside accounts
can create Firebase users (enumeration, token minting, Firestore probing).
The web API key is printed in `CUTOVER_CHECKLIST.md:173` (public by design)
with no documented HTTP-referrer or API restriction. **Fix:** `beforeSignIn`
blocking function enforcing `hd` + `email_verified` and stamping `hpb: true`;
restrict the key to the app's origins and to Identity Toolkit; enable
email-enumeration protection.

### I-10 — Cloud Functions ingress and identity unspecified (LOW)

`functions/src/index.ts` sets region only; gen2 functions default to public
ingress on their Cloud Run service (Eventarc-triggered, so no HTTP surface
today) and the default compute SA. **Fix:** `ingressSettings:
ALLOW_INTERNAL_ONLY`, `serviceAccount: eos-functions@…`.

### I-11 — Documentation contradicts practice (LOW)

`README.md:35` "HPB SSO only — no external allowlist" vs `README.md:104`
allowlist with consultant; `CUTOVER_CHECKLIST.md` §9 Secret Manager vs
env-var practice; `CLIENT_GCP_SETUP.md` Tier 0 claims. A bank reviewer
reading the docs will find them more secure than the deployment. **Fix:**
reconcile in the F8 docs pass; keep one "as-deployed" page.

### I-12 — Two prod-like environments, one open (LOW)

The consultant's trial project `hpb-eos` (open sign-in, `(default)` DB) is
still live as a fallback (`CUTOVER_PLAN.md:220`). If it still holds any
real HPB data it is an unprotected copy. **Fix:** confirm it holds only
demo data, then delete or lock it down.

---

## 3. Verified good

- Every server action resolves a guard before touching Firestore; 58 actions
  tabulated, all `requireTeamAccess`/`requireTeamLeader`/`requireAdmin`/
  `requireFirebaseUser`. `requireTeamDoc` blocks cross-team id smuggling on
  every id-taking mutation.
- Zero client-side Firestore writes; the client SDK is read-only
  (`onSnapshot`), so `firestore.rules` is defense-in-depth, not the primary
  gate. Rules are default-deny with server-owned stamp freezes.
- No `dangerouslySetInnerHTML` on user content; rich text renders from an
  AST with an `http(s)`/`mailto` href allowlist; `setMeetLink` allowlists
  `meet.google.com`; login `next` param is validated against open redirect.
- OAuth CSRF state is server-side, uid-bound, 10-minute TTL, delete-on-read.
  Token refresh distinguishes permanent (`invalid_grant`) from transient
  failures.
- Session cookie: HttpOnly, Secure in prod, SameSite=Lax, verified with
  `checkRevoked`; allowlist enforced on the Google-attested email, at one
  chokepoint.
- No secrets tracked in git (history grep for private keys, OAuth secrets:
  clean; only public Firebase web keys). `.gcloudignore`/`.dockerignore`
  exclude env files, tfstate, docs, scripts from the build upload and image.
- Container: multi-stage, standalone output, non-root user, telemetry off,
  build fails fast on missing config.
- Operator scripts: dry-run by default, explicit `--apply`/`--yes`,
  `.env.local` defaults to sandbox, `copy-db` refuses non-sandbox targets.
- Prior audit fixes confirmed in code: H1 (audit log excludes token
  collections), M1 (`issue_votes` client writes denied), M3 (`maxOutputLength`
  on inflate), M4 (`importTeamFile` leader-gated), L4 (`tmp-dupes.ts` gone).

## 4. Prioritised remediation

| # | Action | Findings | Effort |
| --- | --- | --- | --- |
| 1 | Upgrade Next.js ≥16.2.11 and firebase-admin chain; add audit gate to build | C-01 | ½ day |
| 2 | `deleteMeeting` → leader; `owner_id` roster validation; rules delete → leader | C-02, C-03 | ½ day |
| 3 | Secret Manager for OAuth secret / pull secret / allowlist; purge env vars and `.env.prod` | I-03 | ½ day |
| 4 | Terraform state → GCS (versioned, CMEK) | I-04 | ¼ day |
| 5 | Enable Firestore PITR + daily backup schedule + delete protection | I-07 | ¼ day |
| 6 | `email_verified` check; session TTL 8–12 h; revoke on sign-out; offboarding job | C-04, C-05 | 1 day |
| 7 | Actor stamping helper across all updates/deletes | C-07 | 1 day |
| 8 | Security headers; timing-safe compare; fail-closed redirect URI; length caps | C-08, C-09, C-10, C-12 | ½ day |
| 9 | Confirm/revoke consultant IAM grants; rotate Vercel key; revoke Gemini key; record evidence | I-02 | ½ day + HPB admin |
| 10 | API key restrictions; blocking function; replace hardcoded rules email with claim | I-09, I-02 | 1 day |
| 11 | Encrypt Google refresh tokens with KMS | C-06 | ½ day |
| 12 | Dedicated build/functions SAs; WIF for Bitbucket; Cloud Build trigger; scanning; digest pins | I-05, I-10 | 2 days |
| 13 | LB + Cloud Armor + IAP + custom domain; ingress internal; drop `allUsers` | I-01 | Phase 1 |
| 14 | VPC egress, PGA/restricted VIP, org policies, VPC-SC, CMEK, Data Access logs, SCC, alerts | I-01, I-07, I-08 | Phases 2–3 |

Items 1–8 are code/config changes we can ship without HPB involvement.
Items 9–14 need HPB's cloud admin for IAM, org policy, and DNS.

## 5. Reconciliation with the 2026-08-31 audit

| Prior | Status now |
| --- | --- |
| H1 audit log captures OAuth tokens | Fixed (verified `AUDIT_EXCLUDED_COLLECTIONS`) |
| M1 `issue_votes` client writes | Fixed (verified `allow write: if false`) |
| M2 `email_verified` | Still open → **C-04** |
| M3 XLSX zip bomb | Fixed (verified `maxOutputLength`) |
| M4 import member-accessible | Fixed (verified `requireTeamLeader`) |
| L1 timing-safe compare | Still open → **C-09** |
| L2 pull fallback ignores ownership | Still open; superseded by **C-03** (same root cause: unvalidated `owner_id`) |
| L3 invite overwrites profile | Still open (unchanged) |
| L4 housekeeping | `tmp-dupes.ts` removed; per-instance rate limit and rules/allowlist drift noted in C-14 |

## 6. Next step: read-only live inventory (needs your OK)

A script is prepared that runs only `describe`/`list`/`get-iam-policy`
commands against `hpb-eos-prod` (env var *names* only, no values). It will
confirm: effective org policies, project IAM (who actually has what),
exported SA keys, Cloud Run ingress/SA/env names, Firestore PITR/backup/
delete-protection/CMEK state, Cloud Functions SA and ingress, Scheduler
jobs, Cloud Build triggers, Artifact Registry scanning, audit-log config,
API-key restrictions, Identity Platform provider config, any VPC/LB/Armor/
IAP resources, Secret Manager contents (names), enabled APIs, and active
SCC findings. Findings I-01…I-12 will be re-graded from "as documented" to
"as deployed" once it runs.
