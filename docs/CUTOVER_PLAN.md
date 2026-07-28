# Cutover Plan — why, what was decided, and where we are

**Date:** 2026-07-27 · **Target event:** live L10 with HPB, Wed 2026-07-29 3:00 PM

This is the *decision record* for moving the EOS app out of our own GCP
project and into the client's. For the step-by-step mechanics, see
[`CUTOVER_CHECKLIST.md`](./CUTOVER_CHECKLIST.md) — this doc doesn't repeat
them. What it captures is the reasoning: why each choice was made, what was
measured rather than assumed, and what is still open.

## Why cut over at all

The working deployment lives in `hpb-eos` — **our** GCP project, on **our**
billing account. That was correct for a dress rehearsal and is wrong as a
resting place for a client's data:

- **Ownership.** The client's EOS data should live in the client's org, under
  their IAM, their audit logs, their retention.
- **Billing.** The trial bills to a personal account.
- **Review.** HPB's cloud team can only review what's in their own project.
- **It's the path to production.** Everything the real deployment needs —
  Terraform, rules, indexes, the build pipeline — gets exercised once here.

Note the naming: **`hpb-eos-prod` is "prod" in name only.** It is the
client-hosted *demo* environment today. Demo data, not high-security. That is
why this cutover can move fast and tolerate a rough first deploy.

## Scope

**In:** relocating the app, its data, and its users into `hpb-eos-prod`;
moving the code to the client's Bitbucket; pointing the build pipeline at it.

**Out:** production launch, real customer data, security-tier levers
(`terraform/levers.tf`), the audit-log Cloud Function, custom domains.

## Starting state (measured 2026-07-27, not assumed)

| | `hpb-eos` (trial, ours) | `hpb-eos-prod` (client's) |
| --- | --- | --- |
| Cloud Run | `eos`, live at `eos-h2pbllpgzq-uc.a.run.app` | **none** |
| Firestore | `(default)`, **nam5** multi-region | `hpb-eos-prod-db`, **us-east1** |
| Firestore contents | Enterprise Systems & Data (real import) + stale Executive Team | stale seeded "Demo Team" |
| Auth users | 4 | 1 (`joe.creighton@highplainsbank.com`) |
| Google sign-in | enabled, unrestricted | **enabled**, own OAuth client |
| Artifact Registry | `eos` | none |
| Runtime SA | `eos-runtime@hpb-eos` | none |
| Secret Manager API | enabled | **disabled** (Terraform enables it) |
| Terraform state | `default` workspace, 8 resources | `prod` workspace |

## Decisions, and why

### Cloud Run goes in us-east1, not the us-central1 default

Prod's Firestore is pinned to **us-east1**, and a Firestore location is
permanent. Every page render performs several sequential admin-SDK reads, so
a cross-country hop compounds per request. **A Cloud Run service's region
cannot be changed in place** — fixing it later means a new service, a new
URL, and re-doing OAuth redirect URIs and authorized domains. Cheap now,
expensive later.

The trial gets away with us-central1 only because its database is `nam5`
multi-region, which already includes us-central1.

### Terraform runs in an isolated `prod` workspace

`terraform/terraform.tfstate` holds the **trial's** 8 resources. Applying
against `hpb-eos-prod` with that same state would plan to *replace* the
trial's Cloud Run service and Artifact Registry — destroying the very
environment we intend to keep as Wednesday's fallback.

A `prod` workspace gives that project its own state file. Verified: the
prod plan is **22 to add, 0 to change, 0 to destroy**. The trial state was
also backed up before the workspace was created.

### Cloud Build deploy permissions granted through Terraform

`grant_cloudbuild_deploy_permissions` defaults OFF so the bank's cloud team
opts in deliberately. Turned **on** here: the pipeline has to work
end-to-end, and the grants are then visible in code for their review rather
than applied by hand and undocumented.

### Deploy the current build first, fix bugs after

Prod has no users and no shared URL, so a rough first deploy costs nothing.
Deploying known code isolates the variable: a failure is infrastructure, not
new code. Fixes land immediately afterward — ideally through the Bitbucket
trigger, which makes them the pipeline's real test.

### Infra before the Bitbucket trigger

The trigger's job is to deploy *to* Cloud Run, the Artifact Registry repo,
and the runtime SA, so those must exist first. Pushing the **code** to
Bitbucket has no such dependency and can happen in parallel.

### Bitbucket gets a fresh initial commit

Only `CLAUDE.md` and `AGENTS.md` are withheld; all of `docs/` ships. A
`git rm` would leave both files readable in all 68 prior commits, so the
client's repo starts from a single "Initial import" of the current tree.
Our local copy and the GitHub repo are untouched.

The repo was scanned before this decision: `.env*` and `.firebase/` are
gitignored and **no credentials appear anywhere in history**, so no history
rewrite is required.

### Sign-in on prod: `@highplainsbank.com` **plus** one Gmail — needs code

Firebase's Google provider restriction accepts **a single domain**. It
cannot express "this domain or this one address."

Worse, there is currently **no server-side check at all**:
`createSession()` (`lib/firebase/session.ts`) exchanges an ID token for a
session cookie without inspecting the email. The client-side `hd` parameter
only pre-filters the account chooser, and `inDomain()` in `firestore.rules`
governs only client-SDK reads — every page render uses the admin SDK and
bypasses rules. As it stands, any Google account reaching the URL gets a
valid session.

Decision: enforce an **env-driven allowlist in `createSession()`** (the one
chokepoint every session passes through) and align `inDomain()` to match.
This contradicts the README's current claim that there is no email
allowlist, so that gets updated in the same change.

The cleaner long-term answer is HPB issuing us an `@highplainsbank.com`
account, after which the restriction is a plain single domain and the
allowlist disappears.

## What does not migrate

Nothing copies between projects automatically. The two are separate identity
and data pools.

| | Migrates? |
| --- | --- |
| App image / infra | Rebuilt from this repo |
| Firestore data | **No** — re-imported from source files |
| Auth users and uids | **No** — Joe is `hTxdf5…` on prod, `9fGZ…` on trial |
| Sessions | No — everyone signs in again |
| Placeholder members (`import-*`) | No — recreated by the import |
| Rules and the 10 composite indexes | No — deployed separately, and they build **async** |
| Authorized domains, OAuth client, secrets | No — per project |
| The URL | **Changes** |

Indexes are the classic cutover trap: queries fail until they finish
building, so deploy them early, before the data import.

## The four tracks

**A — GCP infra.** Terraform (`prod` workspace, us-east1) → rules and the 10
indexes → one manual `gcloud builds submit` → add the new URL to authorized
domains. *Gate: the app loads and sign-in works.*

**B — Bitbucket.** Create workspace and empty repo → push the clean export →
enable Secret Manager, store both access tokens plus a webhook secret →
`gcloud builds connections create bitbucket-cloud`, then repository, then a
trigger on `main`. *Gate: a push deploys by itself.*

The trigger must carry all eight `_NEXT_PUBLIC_*` substitutions, or the
Dockerfile's fail-fast guard on empty build args kills every build. Also
`_REGION=us-east1` (the file defaults to us-central1) and `_TAG=$SHORT_SHA`
— which is populated on triggered builds and empty on manual ones, the
opposite of the manual case.

**C — Bug fixes.** The sign-in allowlist; rocks missing from the L10 view
(the quarter-string mismatch, below); the meetings list not being realtime;
"Issues" instead of "IDS"; removing the inaccurate % bar. Independent of A
and B.

**D — Data and users.** Delete prod's stale Demo Team → re-import
rocks/milestones/scorecard/to-dos → create Auth accounts → alias owners onto
them → set leaders. Needs real email addresses.

### Two findings that shaped the ordering

**Rocks don't appear in the live L10.** `segment-rocks.tsx` filters
`r.quarter === currentQuarter()` — an exact string match against
`"2026-Q3"`. Imported rocks carry the client's own `"Q2 FY 2026"` label
(preserved deliberately, since a fiscal quarter is not a calendar one), so
nothing matches and the segment renders empty. The Rocks *tab* doesn't
filter by quarter, which is why it looks correct there.

**Nobody can approve a join request.** The only `leader` on the team is a
synthetic `import-*` placeholder with no Auth account. Real users signing in
land on `/join`, request access, and wait forever — and `members/page.tsx`
only *queries* pending requests when the viewer is a leader, so the request
is invisible rather than merely un-actionable. A real human must hold the
leader role before any live sign-in test.

## Status

- [x] Trial state backed up; isolated `prod` workspace created
- [x] Prod plan reviewed — 22 add, 0 change, 0 destroy — saved to `terraform/prod.tfplan`
- [x] `terraform apply` — **partial** (2026-07-27): all 11 APIs, runtime SA,
      AR repo, and the Cloud Run service created; **all 8 IAM bindings
      denied** — our identity is `roles/editor` on the client's project,
      which cannot set IAM policy. Ask sent: `HPB_IAM_REQUEST.md` (two
      options; Domain Restricted Sharing verified NOT enforced —
      `allValues: ALLOW` — so the `allUsers` binding is permitted). Re-run
      `terraform apply` (fresh plan, `prod` workspace) once resolved —
      only the missing bindings will be created.
- [ ] Rules + indexes deployed to `hpb-eos-prod-db`
- [ ] First manual build and deploy (us-east1)
- [ ] New URL added to authorized domains
- [ ] Bitbucket repo, push, connection, trigger
- [ ] Track C fixes
- [ ] Track D data and users

## Open items

From us: Bitbucket workspace and repo name; SSH key registered with
Bitbucket (or an app password); the two Cloud Build access tokens; email
addresses for Steph Benes, Cora Ravenkamp, and Jessica Teichman; whether
Google Tasks ships to prod.

If Tasks does ship, it needs **its own** OAuth client. Reusing Firebase's
is what broke all trial sign-in previously.

## Rollback

The trial is never modified and stays live at its current URL throughout. If
prod misbehaves, Wednesday runs on the trial and cutover moves to Thursday.

**Go/no-go: Tuesday evening.** Prod green and seeded → demo in the client's
own cloud. Otherwise → demo on the trial, cut over after.
