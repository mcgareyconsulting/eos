---
project: HPB
updated: 2026-08-11
verified: main @ 902b37f  # prod runs 90ec7cb — see Deployment truth
config:                       # inputs to derived math — store inputs, never results
  horizon:
    - 2026-11-02 HPB Q3 rocks close (client target, stated in the 7/29 L10)
  effort_midpoints: {S: 0.5, M: 3, L: 7.5, XL: 15}
queue:                        # agent-maintained, set by agreement in session
  # Single cross-workstream queue. `next` is ordered and is the only ordering
  # that counts; `awaiting` is gated on someone else, not on capacity.
  now: F4
  next: [F5, QW1, N18, F3, N3, N2, P3-2, N4]
  awaiting: [N1, P3-1, N10, F2, B1, P3-5]
---

# HPB · ROADMAP

**Status authority for the High Plains Bank EOS platform.** This file
supersedes `docs/ROADMAP.md` (the Pass 10–18 working roadmap, last updated
2026-08-10); it is retained for reasoning only — all state changes land here.
`docs/L10_GAPS.md` (pre-demo L10 audit remainder) and
`docs/AUDIT_2026-08-04_PR11-18.md` (code audit of PRs #11–#18) are sources,
not authorities. Cutover mechanics live in `docs/CUTOVER_CHECKLIST.md` /
`docs/CUTOVER_PLAN.md`; team-management ops in `docs/TEAM_MGMT_OPS.md`.
The merged client-feedback priority list is agent-local on the consultant
machine (`~/.local/share/mcgarey-agents/eos/CLIENT_FEEDBACK_PRIORITY.md`) and
is a working aid, never an authority.

**Deployment truth as of 2026-08-11:** **prod ≠ main.** Cloud Run (service
`eos`, `hpb-eos-prod`, us-east1) runs `90ec7cb` — the F1 ship (PR #22
quick wins + PR #24 team management), confirmed by the operator; prior rev
`eos-00042-pvp` superseded and the new revision id was never captured.
`main` has since moved to `902b37f`, adding **PR #26** (settings/profile +
Google Tasks completion) and **PR #27** (custom agendas). Those three
tracker items are sandbox-proven and **invisible to the client until F5
ships**. F1 `done`; F5 opened.

## Queue — the single ordering

One queue, spanning all workstreams. Before this consolidation (2026-08-11)
ordering lived in three places with three ID schemes; product/feedback items
had bodies here but appeared in no queue, so their priority existed only in
the agent-local aid. **`queue.next` in the front matter is now the only
ordering that counts.** Items not in `queue` are backlog, not forgotten —
absence from the queue is a statement about sequencing, not about validity.

**`now` / `next` = consultant capacity.** Ordered by deadline pressure, then
by cost-to-close, then by size:

| # | Item | Effort | Why here |
|---|---|---|---|
| now | **F4** | S | `archived_at: null` backfill has a hard date — the Monday sweep runs 2026-08-17 and skipped legacy imports again on 08-10 |
| 1 | **F5** | S | Prod lags `main` by two feature PRs; three tracker items are built but invisible to the client |
| 2 | **QW1** | S | Prod spot-check + Open question 6 promotes nine shipped items to `verified` |
| 3 | **N18** | S | In-progress; an owed deliverable to Joe, not a build |
| 4 | **F3** | S–M | Unblocked by F1. Live credentials that should not exist (Vercel SA key, `GEMINI_API_KEY`, break-glass gmail) in front of a bank security review |
| 5 | **N3** | M | No deps; migration integrity before broader rollout |
| 6 | **N2** | M | Sandbox-runnable; makes N1-class validation repeatable |
| 7 | **P3-2** | M | Largest tracker row with no external gate |
| 8 | **N4** | L | Design precedes build; absorbs N13 |

**`awaiting` = gated on someone else.** These do not consume capacity and
must not be read as "next up": **N1** (Steph's time) · **P3-1** (Joe, Open
question 3) · **N10** (Cloud Storage bucket — rides with F2) · **F2**
(security-tier selection + IAM resolution) · **B1**, **P3-5** (client
BigQuery conventions).

**Reconciled 2026-08-11** against `origin/main`: **U1**, **P1-7** (PR #26)
and **P2-1** (PR #27) left the queue as `shipped` — all three now wait on
**F5** to reach `verified`. The queue built earlier that day was authored
against `90ec7cb` while the remote was five commits ahead; re-verify
`queue` against `origin/main`, not local `main`, whenever the two differ.

**ID reconciliation** with the agent-local aid
(`CLIENT_FEEDBACK_PRIORITY.md`, which keeps its own P0–P3 / D-series
scheme): `P3-1`, `P2-1`, `P1-7` are the same items in both. Divergent:
this file's **U1** is its **P3-4**; its **P3-3** (headline FYI category) is
shipped inside **QW1**; its D-series is the Resolved log here. On conflict,
this file wins.

**Tier key (workstreams — the project's forcing logic):**

| Tier | Workstream |
|---|---|
| W0 | Foundation & perimeter — GCP infra, deploy path, security lockdown; a bank security review sits on these |
| W1 | Data warehouse — BigQuery pipeline + audit log; gated on client conventions |
| W2 | Team management & tenancy — live on prod; N1 client validation before broad rollout |
| W3 | Product — client-feedback features (Passes 13–18) |
| W4 | Integrations & platform ops |

**Redaction:** HPB staff first names already in the record (Joe, Steph /
Stephanie, Jenna, Jessica, Cora, Brian) may appear. No bank-customer data,
no account data, and no credentials/keys are ever committed to this file.
Consultant identity `daniel@mcgareyconsulting.com` may appear (it is in the
repo already).

**Effort key:** S = under a day · M = 2–4 days · L = 1–2 weeks · XL = 3+
weeks. Each item states its effort letter in its Now paragraph. **Fit is
derived, not stored:** sum open item efforts via `config.effort_midpoints`
against `config.horizon`. No total is recorded here — recompute at render;
do not trust remembered totals.

---

## Workstream 0 — Foundation & perimeter

### F1 · Ship merged main to Cloud Run prod
*W0 · done · due — · deps — · owner daniel · src roadmap-prior#resume-here · upd 2026-08-10*

Effort S. **Done.** Merged `main` (PR #22 quick wins + PR #24 team
management) is on Cloud Run prod (`eos` / `hpb-eos-prod` / us-east1).
Operator confirmed prod shows current teams infra (Members tabs,
multi-team surface). Prior rev `eos-00042-pvp` superseded. Unblocks N1
(Steph admin test) and prod verification of P2-7 / QW1. Optional ops
hygiene: capture the live revision name and re-confirm
`SIGN_IN_ALLOWLIST` + rules deploy were part of the ship if not already
logged.

**Trail**
- 2026-08-10 · note · src roadmap-prior#resume-here — "App UI still needs a Cloud Run ship for prod users to see Members tabs / create-team; local sandbox already has it"
- 2026-08-10 · note · src roadmap-prior#resume-here — live rev recorded as `eos-00042-pvp`, built before the PR #22 / #24 merges
- 2026-08-10 · done · src operator — prod confirmed: current teams infra live; F1 closed; queue.now → N1

### F5 · Ship PR #26 + #27 to Cloud Run prod
*W0 · not-started · due — · deps — · owner daniel · src pr#26,pr#27 · upd 2026-08-11*

Effort S. Prod is `90ec7cb` (the F1 ship). `main` has since taken **PR #26**
(settings/profile + Google Tasks completion pull) and **PR #27** (custom
agendas) — three client-tracker items the client cannot see. Same shape as
F1. Extra steps this time: deploy `firestore.rules` (PR #27 added agenda
rules), and each user must **Connect Google Tasks once on the live URL**
because sandbox tokens do not carry to `hpb-eos-prod-db`. Gates U1, P1-7,
P2-1 reaching `verified`. Capture the revision id this time.

**Trail**
- 2026-08-11 · note · src pr#26,pr#27 — merged to origin/main; prod still on the F1 revision

### F2 · Go-live infra gap — monitoring, backups, staging, security levers
*W0 · not-started · due — · deps — · owner daniel · src gcp-setup#day-2-ops · upd 2026-08-10*

Effort M. `docs/CLIENT_GCP_SETUP.md` promises the client Tier-0 baseline
monitoring, budget alerts, scheduled Firestore exports, and a staging
service — **none of which exist in `terraform/` yet** (flagged 2026-07-13,
still true). Also outstanding: `terraform fmt -check` + `validate` were
never re-run after the CMEK/iam edits (run before first apply), and the
Tier 1 security levers (`enable_cloud_armor` / `enable_cmek` /
`enable_pitr` / `enable_data_access_logs`) stay off until HPB picks a tier
(Owed, row 2). Build these before calling the deployment go-live-ready.
Terraform's ability to manage IAM in `hpb-eos-prod` depends on how the IAM
request was resolved (Open question 4).

**Trail**
- 2026-07-13 · note · src roadmap-prior#pass-10 — CLIENT_GCP_SETUP expanded with day-2 ops sections; doc now promises monitoring/budget alerts/exports/staging that terraform/ does not implement
- 2026-07-27 · note · src cutover-plan#status — terraform apply against hpb-eos-prod partial: APIs, runtime SA, AR repo, Cloud Run created; all 8 IAM bindings denied (roles/editor cannot set IAM policy); ask sent as HPB_IAM_REQUEST.md

### F3 · Trial decommission + credential retirement
*W0 · not-started · due — · deps F1 · owner daniel · src roadmap-prior#pass-10 · upd 2026-08-10*

Effort S–M. Pass 10 (2026-07-01) named three credentials that must not
survive to production, none yet confirmed retired: the service-account key
in the retired Vercel demo's env vars (rotate), the old `GEMINI_API_KEY`
(revoke in AI Studio — the Gemini assistant was removed from the app), and
the hardcoded break-glass gmail in `firestore.rules` (retirement plan
required — a personal gmail with full admin will not survive a bank
security review; `inDomain()` now names `daniel@mcgareyconsulting.com`).
Then the trial project teardown per `cutover-checklist` §12: export/delete
`hpb-eos` Firestore data, revoke the trial OAuth client + secrets, delete
the Cloud Run service, unlink billing. Do this only **after** the client
project is confirmed working (hence deps F1).

**Trail**
- 2026-07-01 · decision · src roadmap-prior#pass-10 — no Vercel anywhere; Vercel demo retires at cutover, rotate its SA key; revoke GEMINI_API_KEY; break-glass gmail needs a retirement plan
- 2026-07-27 · note · src cutover-checklist#12 — decommission steps written; explicitly sequenced after client project confirmed working

### F4 · Archive model + rules hardening — audit follow-through
*W0 · in-progress · due — · deps — · owner daniel · src audit-2026-08-04#medium · upd 2026-08-10*

Effort S–M remaining. The 2026-08-04 audit's triage items 1–6 are **merged**
(PR #19): H1 merge-script guards, H2 Home private-todo leak, M12/M13 date +
in-query caps, M9/M10/M11 contract fixes, M1-partial (private todos excluded
from Finish-time archiving, by design), M2 worker scan filters, M4 rules
tightening (archive/audit stamps frozen for member writes,
`rock_status_updates` pins `user_id`). Outstanding operator work: (a)
one-time backfill of `archived_at: null` on pre-2026-08-04 imported
todos/issues/headlines — Firestore `== null` does not match missing fields,
so legacy imports are invisible to the Monday sweep until this runs; (b)
confirm the tightened `firestore.rules` are deployed to prod (folded into
F1 — **F1 done 2026-08-10**; treat rules as live unless an ops re-check
disagrees); (c) `L10_GAPS` red item still open — rules allow direct client
update/delete of meeting docs, so the server-side meeting guards are
advisory against a devtools user; (d) audit M3/M5–M8/M14 + L-tail remain
unfixed (M5's archived-rocks Timestamp serialization may have been mooted by
PR #22's rock-archive work — verify, don't assume).

**Trail**
- 2026-07-29 · note · src l10-gaps#data-infra-hygiene — red flag: Firestore rules allow direct client update/delete of meeting docs; tighten to read-only for clients
- 2026-08-04 · build · src pr#19 — audit triage 1–6 fixed and merged: H1, H2, M9–M13, M1 partial, M2, M4; tests 182 passing
- 2026-08-04 · note · src audit-2026-08-04#fixes-applied — operator TODO recorded: archived_at backfill required before the next Monday sweep matters; rules need a deploy for M4 to take effect
- 2026-08-10 · note · src F1 — prod ship closed; rules deploy assumed with F1 (spot-check if Monday sweep or tenancy misbehaves)

---

## Workstream 1 — Data warehouse

Direction decided 2026-07-01 and unchanged since: Firestore stays the live
system of record; BigQuery is the non-real-time consolidation warehouse fed
by a nightly batch worker (Cloud Scheduler → Cloud Run job → date-partitioned
load jobs), with an append-only `audit_log` collection (server-side `onWrite`
trigger — Option 2, because only the trigger guarantees no write path
bypasses it) closing the intra-day-churn gap. Pass 11 made BigQuery
**two-way** in principle (export for consolidation + import for
scorecard/insights), which raises the urgency of the client's conventions.

### B1 · Nightly BigQuery batch worker
*W1 · blocked · due — · deps — · owner daniel · src roadmap-prior#pass-10 · upd 2026-08-10 · blocked-on client BigQuery/data-compliance conventions since 2026-07-01*

Effort M once unblocked. Everything decidable without the client is decided:
nightly cadence; date-partitioned append snapshots (not overwrite); all nine
domain collections + `audit_log`, skipping ephemeral presence state;
per-table shape = stable scalar columns + `snapshot_date` partition + `raw`
JSON column for schema drift. A commented worker skeleton exists in
`terraform/scheduler.tf`. **Cannot build the schema**: it must conform to
HPB's BigQuery conventions from their Jack Henry → BigQuery migration
(dataset naming, region, partitioning, PII handling, retention, reader
access) — Owed, row 1. Explicit ask: HPB data team sends the conventions
doc, or a 30-minute session with whoever owns the Jack Henry warehouse.

**Trail**
- 2026-07-01 · decision · src roadmap-prior#pass-10 — Firestore live SoT, BQ downstream; nightly batch, not streaming; snapshots append with snapshot_date; audit log closes the delete/churn gap
- 2026-07-01 · decision · src roadmap-prior#pass-10 — collections list decided in principle (nine domain collections + audit_log); build schema-agnostic until conventions arrive
- 2026-07-13 · note · src roadmap-prior#pass-11 — Pass 11 makes BQ two-way (warehouse-fed scorecard ask); client conventions now more urgent

### B2 · Audit-log Cloud Function — built, not deployed
*W1 · built · due — · deps — · owner daniel · src roadmap-prior#pass-10 · upd 2026-08-10*

Effort S–M to deploy and prove. Built 2026-07-01: `functions/` gen2
`onDocumentWrittenWithAuthContext` trigger, audit_log loop guard, presence
excluded, admin-read/never-client-write rules block, deploy section in
`docs/DEPLOY.md`. **Silent-failure trap before deploying** (verified against
source 2026-07-27): both triggers in `functions/src/index.ts` pass no
`database` option, so as-is they listen on `(default)` while the data lives
in `hpb-eos-prod-db` — deploy would report green and capture zero events.
Add `database: "hpb-eos-prod-db"` to both, deploy, then **prove capture**
(edit a doc, see the `audit_log` row) — deploy success alone is not
evidence. The Insights dashboard ask (Pass 11) reads on this change history,
so the sooner it runs, the more history exists.

**Trail**
- 2026-07-01 · decision · src roadmap-prior#pass-10 — capture point Option 2: server-side onWrite trigger; only the trigger guarantees all three write paths are captured — for a bank, "the audit log cannot be bypassed" is the property that matters
- 2026-07-01 · build · src roadmap-prior#pass-10 — trigger + rules + deploy docs built; not deployed
- 2026-07-27 · note · src cutover-checklist#8 — database-pinning trap documented: triggers listen on (default) unless `database` is set; code change required before deploy

### P3-5 · Warehouse-fed scorecard trends
*W1 · blocked · due — · deps B1 · owner both · src roadmap-prior#pass-11 · upd 2026-08-10 · blocked-on client BigQuery conventions since 2026-07-13*

Effort L. Scorecard metrics fed **from** the warehouse (Looker Studio / BQ
into the app) — reverses the original one-way EOS→BQ design, so it needs a
scoping conversation, and it cannot start before B1's conventions and pipe
exist. In-app Scorecard trend lines deliberately read from Firestore, not
BQ (decided 2026-07-01 — don't couple a live feature to nightly lag); this
item is only the warehouse-sourced metrics. Explicit ask: same as B1, plus
a scoping session on which metrics HPB wants warehouse-sourced.

**Trail**
- 2026-07-01 · decision · src roadmap-prior#pass-10 — in-app trend lines read Firestore, not BigQuery; BQ is for cross-source consolidation
- 2026-07-13 · note · src roadmap-prior#pass-11 — client asks for scorecard fed from the warehouse; scoping conversation needed
- 2026-08-04 · note · src feedback-2026-08-04#to-come — reported to client as "blocked on client BigQuery conventions"

---

## Workstream 2 — Team management & tenancy

### P2-7 · Members — cross-team privacy + admin role model
*W2 · shipped · due — · deps — · owner daniel · src tracker-2026-08-03#9 · upd 2026-08-10*

Merged to main 2026-08-10 (PR #24), exercised on sandbox, **live on Cloud
Run** (F1 done). Product model decided: soft directory, hard data —
everyone signed in sees all teams + rosters; rocks/issues/scorecard/L10
require team membership or org admin; no cross-team issue leakage for
non-admins (Jenna's Pass 14 #9 concern). Roles: org `admin` (Identity
Platform custom claim) + per-team `leader`|`member`, multi-team with
different roles supported. Admin = god mode on team data + create teams,
not auto-rostered. Invite = pre-provision (no app email); self-serve
`/join` request list retired (`team_join_requests` create denied in rules).
Code: `requireTeamAccess`/`requireTeamLeader`/`requireAdmin`, Members
This-team|All-teams tabs, admin New-team, `/directory` redirect,
`pnpm admin:set-role` script. Ops runbook: `docs/TEAM_MGMT_OPS.md`.
Remaining: N1 client walkthrough to promote to `verified`. Stretch still
open, not in scope here: CSV directory import, private-team flag, ninety
Owner/Implementer roles (see N6 and Resolved-log context).

**Trail**
- 2026-07-30 · transcript · src tracker-2026-08-03#9 — Jenna: multi-team org; needs admin testing; "employee issues must not leak across individuals/teams"
- 2026-08-10 · decision · src roadmap-prior#resume-here — soft directory / hard data model; admin claim + leader/member; invite-only, /join retired
- 2026-08-10 · pr · src pr#24 — team management merged to main; sandbox-exercised; prod deploy pending
- 2026-08-10 · done · src F1 — prod ship confirmed; teams infra live; N1 still gates `verified`

### N1 · Steph as admin + new-team onboarding test
*W2 · not-started · due — · deps P2-7,F1 · owner both · src roadmap-prior#pass-18 · upd 2026-08-10*

Effort S. Grant `role: "admin"` to Steph (`pnpm admin:set-role`, sign
out/in after claim); walk create team → invite leader → Done → leader
invites members. Confirm directory soft-read + hard data isolation from a
real client account. This is `queue.now` — the validation gate for P2-7
reaching `verified`. Ops notes: `docs/TEAM_MGMT_OPS.md`. F1 is live; needs
Steph's time (client side).

**Trail**
- 2026-08-03 · transcript · src tracker-2026-08-03#13 — Steph: wants admin testing when ready
- 2026-08-10 · note · src roadmap-prior#pass-18 — captured as next-work item 1
- 2026-08-10 · note · src F1 — prod unblocked; promoted to queue.now

### N2 · Multi-team stress-testing setup
*W2 · not-started · due — · deps P2-7 · owner daniel · src roadmap-prior#pass-18 · upd 2026-08-10*

Effort M. Multi-team multi-user scenario covering admin/leader/member;
concurrent L10 + standalone edits; the allowlist + membership matrix.
Deliverable includes documenting how to spin the scenario up (sandbox seed
/ import) so it is repeatable. Sandbox-runnable, so it does not wait on F1.

**Trail**
- 2026-08-10 · note · src roadmap-prior#pass-18 — captured as next-work item 2

### N3 · Verify ESD team migration data
*W2 · not-started · due — · deps — · owner daniel · src roadmap-prior#pass-18 · upd 2026-08-10*

Effort M. Double-check the Enterprise Systems & Data import against the
live ninety export: owners, metrics, rocks, roster integrity — on sandbox
first, then prod if discrepancies surface. Decided: do **not** migrate
historical attachments/links from ninety (none expected in the import; N10
is forward-only).

**Trail**
- 2026-08-10 · note · src roadmap-prior#pass-18 — captured as next-work item 3; attachments excluded from migration scope

---

## Workstream 3 — Product (client feedback, Passes 13–18)

### QW1 · Pass 18 quick-win batch (PR #22)
*W3 · shipped · due — · deps F1 · owner daniel · src roadmap-prior#pass-18 · upd 2026-08-10*

Merged to main 2026-08-10; **on the live revision** (F1 done). Nine
Pass 18 list items in one batch: **#5** sidebar collapse/expand (icon rail,
localStorage, team-initials button); **#7** manual rock archive/restore
(same `archived_at` as the Monday sweep; restore clears `completed_at` so
the sweep doesn't instantly re-archive); **#8** confirm before every delete
(audit found 6 unguarded deletes — headline, issue, rock, todo, metric,
comment — all now use `ConfirmSubmitForm`; reversible archives stay
confirm-free by convention); **#9** leader-only L10 transport
(start/advance/jump/end require leader server-side via `requireTeamLeader`,
admin bypass; transport hidden for members; peek unchanged); **#11**
headline edit after create / during L10 + General/FYI category incl.
CSV-import mapping (also closes Pass 14 #14); **#12** due-soon milestones
hide under done/cancelled/archived rocks (`lib/milestone-visibility.ts`,
applied on Home); **#14** headlines layout grouped by owner with a
secondary Cascading section (`lib/headlines.ts`, tested); **#16**
post-Finish exit — investigation found exit-to-recap already shipped
pre-demo; real gap fixed: recap now offers inline "Rate this meeting"
until the viewer has rated; **#17** department-rocks-first ordering
extracted to `lib/l10/rock-order.ts` and locked with tests. Remaining
effort S: spot-verify on prod, then promote to `verified`.

**Trail**
- 2026-08-05 · transcript · src roadmap-prior#pass-18 — items 9, 11, 12, 14, 16, 17 decided from the ESD L10 transcript (Steph, Joe, Cora asks)
- 2026-08-10 · pr · src pr#22 — nine quick wins merged to main in batched commits
- 2026-08-10 · note · src roadmap-prior#last-updated — live Cloud Run revision predates the merge; client has not seen these
- 2026-08-10 · note · src F1 — prod ship confirmed; batch is live; `verified` still wants a spot-check

### N4 · Multi-team surface + shared rocks (design first)
*W3 · not-started · due — · deps P2-7 · owner daniel · src roadmap-prior#pass-18 · upd 2026-08-10*

Effort L (design M, then build). How a user on several teams sees Home +
tabs (per-team sections vs unified feed vs sticky filter). **Shared rocks
are in product scope** (decided 2026-08-10): a rock has a parent team
(canonical home) and can be shared/visible on other teams the owner belongs
to — Steph's example: rock originated on IT Systems & Security, shared into
ESD. Also milestone assignees on another team's rock (Cora / leadership
"My 90" pattern). Privacy stays hard on non-shared team data (P2-7).
Absorbs N13 (personal Home): Home should prioritize **my**
todos/rocks/milestones, not a dump of everyone's items. Design before
build.

**Trail**
- 2026-08-05 · transcript · src roadmap-prior#pass-18 — Cora: Home is a dump of everyone's items; wants My-90-like personal priority
- 2026-08-10 · decision · src roadmap-prior#pass-18 — shared rocks in scope: parent team + share/visibility on other teams; milestone assignees cross-team
- 2026-08-10 · decision · src roadmap-prior#pass-18 — N13 folded into this item; design precedes build

### N13 · Personal Home (My 90–like)
*W3 · dissolved · due — · deps — · owner daniel · src roadmap-prior#pass-18 · upd 2026-08-10*

Dissolved into **N4** (2026-08-10): the personal-Home ask is one lens of
the multi-team Home design and will be decided there, not separately.
Block retained one cycle per protocol, then moves to the Resolved log.

**Trail**
- 2026-08-05 · transcript · src roadmap-prior#pass-18 — Cora: Home should prioritize my items, not everyone's on the team
- 2026-08-10 · decision · src roadmap-prior#pass-18 — fold into multi-team Home story (N4)

### N6 · Better import functionality
*W3 · not-started · due — · deps — · owner daniel · src roadmap-prior#pass-18 · upd 2026-08-10*

Effort M. Beyond the current CSV/xlsx import: clearer mapping, validation,
dry-run, re-import, error report. Ties in the Pass 11 CSV directory-import
ask (the remaining P2-7 stretch). Attachments are out of import scope
(decided with N3/N10). Current import docs: `docs/CSV_IMPORT.md`. Note
from the audit era: import payloads now write explicit `archived_at: null`
(PR #19), so re-imports can't un-archive — preserve that in any rework.

**Trail**
- 2026-07-13 · note · src roadmap-prior#pass-11 — CSV user import named in Pass 11 directory/admin asks
- 2026-08-10 · note · src roadmap-prior#pass-18 — captured as next-work item 6; attachments excluded

### N10 · Attachments + links on entities (forward only)
*W3 · not-started · due — · deps — · owner daniel · src roadmap-prior#pass-18 · upd 2026-08-10*

Effort L. Rocks/issues/todos/headlines accept file attachments and/or
hyperlinks. **No data migration** of ninety attachments (decided
2026-08-10). Needs a Cloud Storage bucket, which is absent from the
Terraform footprint / backups / security tiers — an infra follow-up that
belongs with F2's go-live work, plus a security review of the upload path
(bank client). Client already said links to Google Docs are an acceptable
substitute for binary attachments (Jenna, Pass 14 #6), so links can ship
ahead of binaries. Linkify/rich-text remains P3-2.

**Trail**
- 2026-07-30 · transcript · src tracker-2026-08-03#6 — Jenna: attachments optional; links to Google Docs OK instead
- 2026-07-13 · note · src roadmap-prior#pass-11 — attachments imply a Cloud Storage bucket not in the Terraform footprint
- 2026-08-10 · decision · src roadmap-prior#pass-18 — forward only; no ninety attachment migration

### N15 · Meeting notes UX
*W3 · not-started · due — · deps — · owner daniel · src roadmap-prior#pass-18 · upd 2026-08-10*

Effort M. Clarify personal notes vs recap; fix save/visibility/possible
overwrite at conclude. Adjacent `l10-gaps` context to read before starting:
recap is a live view masquerading as a historical record (denormalized
recap snapshot at conclude is the proper fix) and per-segment durations are
never persisted.

**Trail**
- 2026-08-10 · note · src roadmap-prior#pass-18 — captured as next-work item 15

### N18 · Scorecard trend-status write-up for Joe
*W3 · in-progress · due — · deps — · owner daniel · src roadmap-prior#pass-18 · upd 2026-08-10*

Effort S. No product change — report the **current** rules for client
review. The write-up exists in the superseded roadmap (Pass 18 box, sourced
from `lib/scorecard.ts` `trendStatus()` + unit tests): per-cell compare to
goal with direction gte/lte/eq; lookback = last 3 **populated** periods
(empty weeks skipped, ninety-Trends-style); ok = 0 misses, watch = ≥1 miss
but not a strict majority (ties → at-risk), off = strict majority miss;
no-goal metrics count as on-track for the pill. The pill does **not** use
the visible 13-week hit rate — Joe's live example (his 1-of-N vs Steph's
2-of-N under goal) should be re-checked against that split when sharing.
Remaining: deliver to Joe. Known cosmetic contradiction to mention or fix
first: goal-less metrics show an On-track pill next to "0/13 hit" (audit
M14).

**Trail**
- 2026-08-04 · note · src audit-2026-08-04#medium — M14: goal-less metrics render On-track next to 0/13 hit — contradictory status to resolve or footnote
- 2026-08-05 · transcript · src roadmap-prior#pass-18 — Joe asks how on-track/at-risk/off-track is decided; docs-only response agreed
- 2026-08-10 · note · src roadmap-prior#pass-18 — rules table written against lib/scorecard.ts + tests; delivery pending

### P2-1 · Custom meeting agendas
*W3 · shipped · due — · deps F5 · owner daniel · src roadmap-prior#pass-11 · upd 2026-08-11*

**Core shipped PR #27** (`feature/agenda`): `lib/l10/agenda.ts` (+190 lines
of tests) with two built-in presets (**Level 10**, **L10 Condensed**),
per-team custom agendas in Firestore with an editor
(`agendas.tsx` / `agenda-editor.tsx` / `agendas-panel.tsx`), agenda
**selected at meeting start** (`start-meeting-picker`), and a
`MeetingAgendaSnapshot` stamped onto the meeting so a later agenda edit
cannot rewrite history. Rules updated. This closes the client's stated ask
(≥4 formats via the editor + pick-at-start, Jenna #8 / Stephanie Pass 13
#8). **Verified not built** — reopen as P2-1b only if asked: scheduled /
recurring meetings, push-an-agenda-to-all-teams, and shipped presets beyond
the two L10 variants (Quarterly / Annual / 1-on-1 / Focus Day / Vision
Building are user-creatable, not preset). Sandbox state; **not on prod** —
gated on F5. Original scope below.

Effort XL — the biggest single build item, and the client has re-confirmed
it three times (Pass 11 config doc; Stephanie in live use, Pass 13 #8;
Jenna, Pass 14 #8 "≥4 agenda formats now, more later, select at meeting
start"). Scope from Pass 11: multiple templates (L10, L10 Condensed,
Quarterly, Annual, 1-on-1, Focus Day, Vision Building), per-team agenda
editor (rename/reorder/durations/custom + tool sections, push-to-all-teams),
scheduled/recurring meetings, archive-on-close semantics. Joe is surveying
1-on-1 tool demand org-wide — if real, it feeds the template list.

**Trail**
- 2026-07-13 · note · src roadmap-prior#pass-11 — full scope captured from the ninety.io config doc; flagged biggest single build item
- 2026-07-29 · transcript · src roadmap-prior#pass-13 — Stephanie re-confirmed flexible templates in live use
- 2026-07-30 · transcript · src tracker-2026-08-03#8 — Jenna: ≥4 agenda formats now, select agenda at meeting start

### P3-1 · Calculated measurables + cross-team share-up
*W3 · not-started · due — · deps — · owner daniel · src tracker-2026-08-03#11 · upd 2026-08-10*

Effort L. The top-value open scorecard ask, with concrete requirements from
Brian (tracker update 2026-08-10): per-branch direct-input metrics
(Bennett/Flagler/Keenesburg/Longmont/Wiggins Teller Transactions, each
owned by its BSM) roll up to a Leadership "Total Teller Transactions" =
sum. Requirements: (a) metric kind = `calculated` with a formula over
sibling metric ids, (b) cross-team share-up (branch team → leadership
team), (c) **versioned formula** — editing membership (e.g. adding a
branch) must not rewrite or drop prior periods. Scope carefully: live
(Firestore) vs warehouse (P3-5) is a real fork. Jessica said Transformation
uses share-up — confirm with Joe (Open question 3).

**Trail**
- 2026-07-30 · transcript · src tracker-2026-08-03#11 — Jessica: calculated measurables from other metrics; share-up to other teams; confirm with Joe
- 2026-08-10 · note · src tracker-2026-08-03#11 — Brian's detail: sum-of-branches → leadership, editable formula, history preserved — the only new content in the 08-10 tracker re-read

### P3-2 · Rich text / links across descriptions
*W3 · not-started · due — · deps — · owner daniel · src tracker-2026-08-03#15 · upd 2026-08-10*

Effort M. Hyperlinks + rich text (bullets, bold) in headlines, issue
descriptions, rock descriptions, comments (Steph #15/#22, Jenna #6 echo).
Comments already linkify URLs (Pass 16 P2-5, React-element rendering,
`https?://` only — audit-verified no XSS); this item is the full editor.
Related to N10 (links on entities) — keep the two write paths coherent.

**Trail**
- 2026-08-03 · transcript · src tracker-2026-08-03#15 — Steph: hyperlinks + rich text in headlines
- 2026-08-04 · note · src audit-2026-08-04#verified-sound — existing linkify verified safe (React elements, https-only)

### U1 · Integrations nav → Settings
*W3 · shipped · due — · deps F5 · owner daniel · src tracker-2026-08-03#17 · upd 2026-08-11*

Effort S. **Shipped PR #26** (`feature/settings-profile`). `/settings`
holds profile (name/email), the Google Tasks connector and Sign out;
sidebar gear → Settings with the collapsed rail showing an initials
avatar; `/integrations` (and the OAuth callback) redirect to `/settings`.
Sandbox-proven; **not on prod** — gated on F5.

**Trail**
- 2026-08-03 · transcript · src tracker-2026-08-03#17 — Steph: Integrations belongs under Settings / profile

### G1 · Recap attribution via source_meeting_id
*W3 · not-started · due — · deps — · owner daniel · src l10-gaps#recap · upd 2026-08-10*

Effort S–M. Recap membership is a `created_at` time-window guess: a
standalone create during a live meeting counts as "created in this
meeting", and anything captured a minute after Finish is missed. In-meeting
creation paths (inline to-do form, Drop-to-Issues) have written
`source_meeting_id` since 2026-07-29, so data accumulates. Work: switch
recap membership to `source_meeting_id == meeting.id`, time window only as
legacy fallback; never attribute standalone creates mid-meeting via time
alone. Guard: `addIssue` stores client-supplied `source_meeting_id`
unvalidated (audit L5) — validate it in the same change or the attribution
can be poisoned. Rocks/headlines in-meeting creates don't carry the field
yet.

**Trail**
- 2026-07-29 · note · src l10-gaps#recap — gap identified; source_meeting_id started accumulating from in-meeting paths that night
- 2026-08-04 · note · src roadmap-prior#pass-18 — edge case reconfirmed during Session D cleanup: standalone creates during a live L10 still mis-attributed
- 2026-08-04 · note · src audit-2026-08-04#low — L5: source_meeting_id accepted unvalidated on addIssue

### G2 · L10 meeting polish backlog (L10_GAPS remainder)
*W3 · parked · due — · deps — · owner daniel · src l10-gaps#deferred · upd 2026-08-10*

Effort M–L if taken whole. Parked bundle of the surviving `l10-gaps`
yellows: in-meeting issue solve → to-do affordance (the natural "solved;
Tom owns the follow-up" beat — a compose job now that the inline to-do form
exists); per-row Drop-to-Issues (component exists as dead code); round-robin
stages not following the speaker on To-Dos/Headlines; read-mostly To-Dos
segment; Back resetting segment clock + speaker round (needs per-segment
elapsed persistence — same storage work as per-segment durations, do
together); stale-vote edge on long-term rows; recap snapshot
denormalization (shared with N15); meetings-list unbounded N+1 query.
**Re-check trigger:** the next L10-focused session, or the first client
complaint touching any of these. Read `docs/L10_GAPS.md` before any L10
work — that instruction predates this file and stands.

**Trail**
- 2026-07-29 · note · src l10-gaps#deferred — gaps catalogued the night before the demo; too big or too product-shaped to fix then
- 2026-08-10 · decision · src — — bundled and parked; individual items promote out when picked up

---

## Workstream 4 — Integrations & platform ops

### P1-7 · Google Tasks two-way sync
*W4 · shipped · due — · deps F5 · owner daniel · src tracker-2026-08-03#10 · upd 2026-08-11*

**Shipped PR #26** (`feature/settings-profile`) — **completion only**.
Google → EOS sets `completed_at` when a mirrored task is completed in
Google; title/due/uncomplete from Google are ignored (EOS stays source of
truth for fields). Pull runs on Settings / To-Dos load and the **Sync
Google Tasks** button; `POST /api/google/tasks/pull` (Bearer secret)
exists but **no Cloud Scheduler is required for the pilot**. Residual:
milestones still never mirror (Open question 2 stays open), To-Dos UI is
not live so a Sync/refresh is needed after a pull, and prod requires each
user to **Connect once on the live URL** — sandbox tokens do not carry to
`hpb-eos-prod-db`. Original framing below.

Effort M–L. Today is one-way push (`lib/google/tasks.ts`); Steph completed
a task in Google Tasks and it did not complete in EOS — the client expects
Tasks→EOS completion sync, which elevates the Pass 11 phase-1 ask to
**two-way is required**. Per-user OAuth + token storage already exist
(`google_tasks_connections/{uid}`, admin SDK only). Known coherence gaps to
resolve in the same effort: milestones never mirror to Tasks on create
(Pass 17 known gap), `updateRockWithMilestones` bypasses the mirror on
edit/delete (audit M6), and archiving an incomplete todo orphans its live
task (audit L11) — whether milestones should mirror at all is a product
decision (Open question 2). Prod deploy needs its own OAuth client in the
client's project (cutover-checklist §9 — never reuse the trial's).

**Trail**
- 2026-07-13 · note · src roadmap-prior#pass-11 — Google Tasks sync is the client's only flagged phase-1 integration
- 2026-07-30 · transcript · src tracker-2026-08-03#10 — Steph: Tasks complete → EOS complete not working; two-way expected
- 2026-08-04 · note · src audit-2026-08-04#medium — M6/L11: milestone edits and archive path bypass the Tasks mirror

### P1-2 · Access ops — allowlist + membership
*W4 · in-progress · due — · deps — · owner daniel · src roadmap-prior#pass-13 · upd 2026-08-10*

Effort S, standing item. Keep `SIGN_IN_ALLOWLIST` (local `.env.local` +
Cloud Run service env) covering the HPB domain + operator primary email —
which after the Google alias conversion is `daniel@mcgareyconsulting.com`
(token email is primary, not alias-only). Membership provisioning is now
invite-only through P2-7. Background: the dual-auth desync (session cookie
vs client Firebase Auth) was the root of the Pass 13 access failures;
`LiveAuthBanner` + dual sign-out shipped 2026-08-03, ops half remains
standing. Reminder: deleting an Auth user re-keys uid — re-seed or
re-invite memberships for that person.

**Trail**
- 2026-07-29 · transcript · src roadmap-prior#pass-13 — system-access failures during the live client L10
- 2026-08-03 · build · src roadmap-prior#pass-13 — dual-auth desync diagnosed; LiveAuthBanner + dual sign-out shipped; remainder is ops
- 2026-08-10 · note · src roadmap-prior#resume-here — operator primary email now daniel@mcgareyconsulting.com after alias conversion

### N19 · Bitbucket migration + security docs
*W4 · not-started · due — · deps — · owner daniel · src roadmap-prior#pass-18 · upd 2026-08-10*

Effort M. Move repo hosting to the client's Bitbucket; ship README +
security docs (perimeter, allowlist, rules, IAM, no-secrets-in-repo,
consultant access model). Coordinate `docs/DEPLOY.md`,
`docs/CLIENT_GCP_SETUP.md`, `docs/TEAM_MGMT_OPS.md`. Groundwork from the
cutover plan stands: fresh initial commit (only `CLAUDE.md`/`AGENTS.md`
withheld; history scanned 2026-07-27 — no credentials anywhere, no rewrite
needed); the Cloud Build trigger must carry all eight `_NEXT_PUBLIC_*`
substitutions plus `_REGION=us-east1` and `_TAG=$SHORT_SHA` or the
Dockerfile fail-fast guard kills every build. From-us prerequisites:
workspace/repo name, SSH key or app password, two Cloud Build access
tokens + webhook secret in Secret Manager.

**Trail**
- 2026-07-27 · decision · src cutover-plan#bitbucket — fresh initial commit, docs/ ships, history verified credential-free
- 2026-08-10 · note · src roadmap-prior#pass-18 — captured as next-work item 19 with the security-docs deliverable attached

---

## Blocked

- **B1 · Nightly BigQuery batch worker** — blocked-on client
  BigQuery/data-compliance conventions since 2026-07-01. **Ask:** HPB data
  team sends the Jack Henry warehouse conventions (dataset naming, region,
  partitioning, PII, retention, reader access), or 30 minutes with its
  owner.
- **P3-5 · Warehouse-fed scorecard trends** — blocked-on client BigQuery
  conventions since 2026-07-13 (and structurally on B1). **Ask:** same
  conventions, plus a scoping session on which metrics HPB wants
  warehouse-sourced.

## Owed

| Owed | Blocks | Since |
|---|---|---|
| BigQuery/data-compliance conventions from the Jack Henry migration (naming, region, partitioning, PII, retention, reader access) | B1, P3-5 | 2026-07-01 |
| Security-tier selection from the Pass 10 levers menu (Tier 0 / 1 / 2) | F2 | 2026-07-01 |
| IAM resolution per `docs/HPB_IAM_REQUEST.md` (Option A grant or Option B bindings) — confirmation of which was applied | F2, F3 | 2026-07-27 |
| Joe's confirmation that Transformation actually uses scorecard share-up | P3-1 | 2026-07-30 |
| Steph's time for the admin/new-team walkthrough (F1 live) | N1 | 2026-08-10 |

## Open questions

1. **Vote-credit reset at meeting conclude** — shipped 2026-07-29 as a
   semantics change (credits rank one meeting's Issues hour; between
   meetings the tab ranks by priority/status only). Needs a deliberate yes
   from the client, not just silence. Gates G2 (one-line revert exists in
   `endMeeting`). **Answers:** Joe/Steph.
2. **Should milestones mirror to Google Tasks at all?** They never have
   (create gap is pre-existing; edit/delete gaps are audit M6/L11), and it
   collides with Steph's two-way ask. Product decision before P1-7 builds.
   **Answers:** Steph + daniel.
3. **Does the Transformation team use share-up?** Jessica said to confirm
   with Joe. Shapes P3-1 scope (live vs warehouse fork). **Answers:** Joe.
4. **How was the IAM request resolved?** The app serves publicly, so the
   critical bindings evidently exist, but no doc records whether HPB chose
   Option A (temporary consultant IAM rights → Terraform manages bindings)
   or Option B (bank-applied) — this decides whether F2's Terraform can
   manage IAM in `hpb-eos-prod` or must document around it. Gates F2, F3.
   **Answers:** HPB cloud admin + daniel.
5. **Are the PR #19 rules tightening and the `archived_at` backfill live on
   prod?** F1 (done 2026-08-10) was meant to include the rules deploy —
   treat rules as live unless re-check fails. **Still open:** one-time
   `archived_at: null` backfill before the next Monday sweep matters.
   Gates F4. **Answers:** daniel (ops check).
6. **Did PR #22's rock-archive work resolve audit M5** (archived rocks tab
   passing a raw admin-SDK Timestamp to the client) **and the L1
   archive-filter landmines** (L10 rocks segment + due-soon milestones
   never filter `archived_at`)? Verify against main before calling the
   rock-archive path sound. Gates QW1 verification. **Answers:** daniel.

## Resolved

*Append-only log. Entry shape: `- date · ID · terminal-status — text` —
distinct from Trail entries, which carry a layer + src.*

- 2026-07-01 · Q-cadence · answered — BQ run cadence: nightly; cost delta vs weekly is noise, day-resolution snapshots + audit log close the churn gap
- 2026-07-01 · Q-capture · answered — audit-log capture point: Option 2 server-side onWrite trigger; only the trigger guarantees no write path is missed
- 2026-07-13 · Q-sso · answered — SSO/identity-provider risk retired: heavy Google Workspace integration asks confirm HPB is a Workspace shop
- 2026-07-30 · P13-1 · closed — rock off-track comment save bug: capture-phase scroll listener wiped the draft; fixed (ignore in-panel scroll, reposition, flip-above + max-height)
- 2026-08-03 · P13-3 · closed — scorecard 30-metric `in` cliff: chunked loads server + live; L10 compact defaults to configured sort_order
- 2026-08-03 · P0 · closed — Pass 15 P0 batch: form double-submit pending state, milestone-date edit path, status-dropdown viewport clip, todo +7d default due, status-comment discoverability
- 2026-08-03 · P1-1 · closed — sidebar team switcher over all memberships (Steph #13)
- 2026-08-03 · P1-3 · closed — scorecard interval tabs via metric `interval` model (weekly/monthly/quarterly/annual measurables, not rollups)
- 2026-08-04 · P2-3 · closed — headlines: discuss checkbox + selective archive at meeting end (PR #14)
- 2026-08-04 · P2-4 · closed — issues short-term/long-term tabs + move between them, on tab and L10 (PR #14)
- 2026-08-04 · P2-5 · closed — comments on issue/rock detail with safe linkify (PR #14)
- 2026-08-04 · P2-6 · closed — date semantics: free-text quarter, rock due optional and null-when-cleared, milestone dates empty by default (PR #14; edit-mode regression M9 re-fixed in PR #19)
- 2026-08-04 · P17 · closed — Rocks & Milestones redesign merged (PR #16): one RockModal create+edit with batched milestones, redesigned row, two-column status popover with measured placement, L10 segment shares RockRow; milestones always tickable by design
- 2026-08-04 · P1-6 · closed — vote credits UI + archive contract for todos/headlines/issues incl. Monday worker (PR #17)
- 2026-08-04 · AUD-16 · closed — audit triage items 1–6 fixed and merged (PR #19): H1 merge-script guards, H2 Home privacy leak, M12/M13, M9/M10/M11, M1-partial/M2/M4, +tests (182 passing)
- 2026-08-10 · Q-home15 · answered — "Home breaks over 15 teams" was stale: fixed 2026-08-04 (`b8df118`, chunked queries, per-status equality); regression tests added 2026-08-10 (`lib/firestore-in.test.ts`)
- 2026-08-10 · Q-tracker · answered — 2026-08-10 tracker re-read: only new content vs the 08-03 copy is Brian's calculated-measurable detail on P3-1; all other 22 rows already triaged
- 2026-08-10 · F1 · done — ship merged main (PR #22 + #24) to Cloud Run prod; operator confirmed current teams infra live; supersedes `eos-00042-pvp`
- 2026-08-11 · U1 · closed — Integrations → Settings/profile shipped (PR #26); `/integrations` redirects; awaits F5 for prod
- 2026-08-11 · P1-7 · closed — Google Tasks two-way **completion** shipped (PR #26): pull on Settings/To-Dos load + Sync button, no Scheduler for pilot; milestones still unmirrored (Open question 2 stays open)
- 2026-08-11 · P2-1 · closed — custom agendas core shipped (PR #27): 2 built-in presets, per-team editor, pick-at-start, agenda snapshot on meeting; scheduled/recurring + push-to-all-teams not built
- 2026-08-11 · Q-queues · answered — three parallel queues (root front matter W2-only, agent-local P0–P3 aid, docs/ROADMAP.md numbered lists) consolidated into one cross-workstream `queue.next`; docs/ROADMAP.md banner-superseded; `queue.now` N1 → F4 because N1 is gated on Steph's calendar and a client-gated `now` stalls the queue

## Sources

| Slug | Path | Role |
|---|---|---|
| roadmap-prior | docs/ROADMAP.md | Superseded working roadmap (Passes 10–18); anchors are its section names (`#pass-10` … `#pass-18`, `#resume-here`, `#last-updated`); retained for reasoning |
| audit-2026-08-04 | docs/AUDIT_2026-08-04_PR11-18.md | Code audit of PRs #11–#18 at main=05c7f7f; anchors `#high` `#medium` `#low` `#verified-sound` `#fixes-applied` |
| l10-gaps | docs/L10_GAPS.md | Pre-demo L10 audit remainder (2026-07-29); anchors `#recap` `#deferred` `#data-infra-hygiene` |
| cutover-plan | docs/CUTOVER_PLAN.md | Cutover decision record (2026-07-27); anchors `#status` `#bitbucket` |
| cutover-checklist | docs/CUTOVER_CHECKLIST.md | Cutover procedure; anchors are its § numbers (`#8`, `#9`, `#12`) |
| gcp-setup | docs/CLIENT_GCP_SETUP.md | Client onboarding checklist + commitments (monitoring/backups/staging promises) |
| team-mgmt-ops | docs/TEAM_MGMT_OPS.md | Team-management ops runbook (P2-7, N1) |
| feedback-2026-08-04 | docs/feedback/HPB_Feedback_Roadmap_Progress_2026-08-04.pdf | Client-facing progress snapshot vs the 08-03 tracker |
| tracker-2026-08-03 | Daniel_Tool_Feedback_Tracker.xlsx (client-held; not a repo artifact — verbatim triage retained in docs/ROADMAP.md Pass 14 log; anchors are its row numbers) | Structured client feedback, 22 items, Jenna/Steph/Jessica; re-read 2026-08-10 |
| iam-request | docs/HPB_IAM_REQUEST.md | IAM ask to HPB's GCP admin (2026-07-27) |

`src pr#NN` refs resolve to pull requests on the project's GitHub origin
(`mcgareyconsulting`); the Bitbucket move (N19) will change that home.
