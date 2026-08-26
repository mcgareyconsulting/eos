---
project: HPB
updated: 2026-08-26
verified: main @ 4498653  # prod still runs 98bb30b (rev eos-00046-nxv) — main is ~13 days ahead; see Deployment truth
config:                       # inputs to derived math — store inputs, never results
  horizon:
    - 2026-11-02 HPB Q3 rocks close (client target, stated in the 7/29 L10)
  effort_midpoints: {S: 0.5, M: 3, L: 7.5, XL: 15}
queue:                        # agent-maintained, set by agreement in session
  # Single cross-workstream queue. `next` is ordered and is the only ordering
  # that counts; `awaiting` is gated on someone else, not on capacity.
  now: SHIP2   # prod is 13 days behind main; N23 + N32 are built and still live-broken for the client
  next: [F4, QW1, N18, F3, N3, N2, N24, N4]
  awaiting: [P3-1, N10, F2, B1, P3-5]
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

**Deployment truth as of 2026-08-12 (F5 shipped):** **prod = main code.**
Cloud Run (service `eos`, `hpb-eos-prod`, us-east1) runs revision
**`eos-00046-nxv`**, image tag **`98bb30b`** — current `main` code
(commits after `98bb30b` are roadmap-only). The F5 ship delivered PRs
#25–#29 (settings/profile + Google Tasks completion, custom agendas,
My-Home board + multi-team, rich text) and the `firestore.rules` deploy
(#27 agenda rules). F1 and F5 `done`. **Known-broken on prod:** the Rocks
Archived tab (**N23**) — the fix did not exist when F5 shipped, and the
Monday sweep (2026-08-17) will create the first archived rocks that
trigger it. N23 now needs its own small ship before the sweep.

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
| now | **SHIP2** | S | Prod is 13 days / 10 PRs behind `main`. **N23** (Archived tab crashes) and **N32** (ratings rewritable after conclude) are *built* and still broken for the client — the remaining work is the ship, not the fix. Needs three deploys: image, `firestore.rules`, Cloud Functions |
| 1 | **F4** | S | `archived_at: null` backfill. Now sequenced *after* SHIP2 so the Archived tab is fixed before legacy rows become sweepable. The 08-17 sweep has already run once without it |
| 2 | **QW1** | S | Prod spot-check + Open question 6 — covers the F5 payload (U1, P1-7, P2-1, P3-2 → `verified`) and now the SHIP2 payload, plus the sign-in/OAuth negative test |
| 3 | **N18** | S | In-progress; an owed deliverable to Joe, not a build |
| 4 | **F3** | S–M | Unblocked by F1. Live credentials that should not exist (Vercel SA key, `GEMINI_API_KEY`, break-glass gmail) in front of a bank security review |
| 5 | **N3** | M | No deps; migration integrity before broader rollout |
| 6 | **N2** | M | Sandbox-runnable; makes N1-class validation repeatable |
| 7 | **N24** | S–M | Cross-tab coherence (add-{item} + Active \| Archived); frames N21/N22 rather than racing them |

**`awaiting` = gated on someone else.** These do not consume capacity and
must not be read as "next up": **P3-1** (Joe, Open question 3) · **N10**
(Cloud Storage bucket — rides with F2) · **F2** (security-tier selection +
IAM resolution) · **B1**, **P3-5** (client BigQuery conventions). **N1 left
`awaiting` in Pass 21** — Steph's onboarding walkthrough ran 2026-08-18;
remaining N1 work is a leftover admin-dropdown confirm, not client calendar.
**N4** stays at the tail of `next`; **N20** still rides with it. Sharing
was tested on a second team today and failed (Steph rock) — that is now a
live repro on an already-queued item, not a new queue row.

**Reconciled 2026-08-11** against `origin/main`: **U1**, **P1-7** (PR #26)
and **P2-1** (PR #27) left the queue as `shipped` — all three now wait on
**F5** to reach `verified`. The queue built earlier that day was authored
against `90ec7cb` while the remote was five commits ahead; re-verify
`queue` against `origin/main`, not local `main`, whenever the two differ.

**Reconciled 2026-08-12** against `origin/main` @ `98bb30b`. The 08-11 warning
above went unheeded and the file drifted again: **PR #28**
(`feature/multi-team`) had merged and appeared nowhere here, so the single most
expensive queue row (**N4**, effort L, `not-started`, "design precedes build")
was in fact largely built. Corrected: N4 → `in-progress` with the shipped /
remaining split stated; **N13** → Resolved (its personal-Home ask shipped
inside #28); **P3-2** → `shipped` (PR #29 merged mid-reconciliation, so it left the queue
the same way U1/P1-7/P2-1 did); F5 re-scoped to **five** merge PRs — the file
had also never recorded **#25**, citing only #26 for settings/profile.
**Ordering is deliberately unchanged** — statuses are reconciliation, priority
is a session decision. One new item (**N20**) is recorded as backlog rather
than queued for the same reason. Lesson worth keeping: verify against
`origin/main` **before** starting work, not only when publishing it.

**Session 2026-08-12 (later):** daniel reported the Rocks **Archived** tab
broken on `main` — recorded as **N23** (audit M5 confirmed live, no longer
latent) and queued ahead of F5 so the fix rides the prod ship. **N24**
(add-{item} + Active | Archived coherence across all entity tabs) recorded
per the same session and queued at the tail. Git housekeeping: this file's
08-12 reconciliation had been living only on `chore/roadmap-reconcile-0812`
while `main` still held the stale 08-11 copy — merged to `main` this session;
the roadmap authority is only an authority when it's on `main`.

**Session 2026-08-12 (consolidation):** daniel: *"stable, clean version —
too many things in flight."* PR #30 conflict resolved and merged; then a
parallel uncommitted variant of the same rocks work was found in the main
checkout — it kept the owner+type model but removed the sharing read
surfaces. Decision: that variant wins (`feat/rocks-owner-type-simplify`),
because no second team exists. The N23 archive fix and the L10 archived-rock
filter ride the same branch. **N4 → `awaiting` a second team; N20 rides
with it.** Rock model going forward: `owner_id` person always required +
`rock_type` (individual / team / company) — two data points.

**Session 2026-08-12 (live L10 — Pass 19):** daniel ran a live L10 with the
team and returned feedback (transcript backup to follow — re-verify the
garbled fragments against it; trails cite `l10-2026-08-12`). Recorded:
**N25** (meeting presence confirmation) · **N26** (headlines collapse by
default + check-off after sharing) · **N27** (leader-driven meeting
sync with off-sync opt-out) · **N28** (scorecard metric-expand
styling/scroll) · **N29** (milestones become a two-week reminder — own-only
on To-Dos, team-wide two-column in the L10) · **N30** (demark comments made
during live discussion) · **N31** (issue-discussion notification — internal,
not email, short term). **N24 extended:** the missing Active | Archived
views in the L10 were hit live — client wants them in both modes, so the
in-meeting surfaces are now explicitly in N24's scope. **QW1 picks up** the
agenda-scoping verification (created agendas belong to the team, not an
individual; staff permissions to see agendas in the Meetings tab). **N4
green-lit** with a concrete cross-team model (milestone-assignment pulls the
rock headline + only that milestone into a "Shared with you" section) —
moved from `awaiting` to the queue tail; re-prioritize in session. Owed
follow-ups: Steph onboarding meeting (rides N1), Jessica API/data-upload
documentation (rides N6). New items land as backlog; ordering above is
otherwise unchanged.

**Session 2026-08-15 (Pass 20) — transcript backup reconciled.** The Gemini
notes + full transcript for the 2026-08-12 L10 arrived and every Pass 19
entry was checked against them. **Pass 19's source was also recovered** —
daniel's dictated post-meeting notes, thought lost to a machine shutdown,
survive verbatim in the 2026-08-12 session log (22:20Z, ~4k chars) and are
preserved at `docs/feedback/l10-2026-08-12-notes.md`. Checked line by line,
**Pass 19 is a faithful transcription of that dictation** — nothing was
invented and nothing was dropped. What Pass 20 adds is the corroborating
half: which asks the room actually voiced, in whose words, and what the
meeting contains that daniel's dictation did not reach. His handwritten
notes are still off-machine and land 2026-08-17; a third reconciliation is
owed but is now expected to be small. **Corrections:** N4's garbled
fragment probably resolved (dictation garble, not a lost ask) and its "only
way" clause reconciled against its own green-light clause — rock→team
sharing and milestone-assignee pull-in are **both** in play; N26's
check-off applies to **all** headlines, not just org-level ones; N28
re-attributed from the client to daniel's own observation; N29 carries a
live tension with what Jessica said on the transcript.
**New from the record:** **N32** (post-meeting rating still editable —
client-reported bug with an integrity angle), **N33** (agenda side panel →
modal), **N34** (departmental vs individual marker on rocks/milestones).
Smaller asks folded into existing items: per-team toggle for
milestones-on-To-Dos (N29), default agendas on every new team (P2-1),
dedicated discussion-notes field vs comments (N30), Steph's email-fan-out
research (N31). Owed follow-ups added: Joe checks dark mode, Brian moves
off the ESD team, Steph's Meetings-tab privileges (QW1). **Queue changed by
agreement:** N32 enters at position 2 as an urgent fix and ships with N23 —
the only Pass 19/20 item to be queued rather than land as backlog.

**Session 2026-08-18 (Pass 21) — Steph onboarding + import walkthrough.**
N1's client-time gate opened: new-team onboarding was **solid**, in-app
import was **decent**, new-team + adding members was **not**. Findings
land on existing items where they already lived, plus two new backlog
rows. **N1 → `in-progress`**, leaves `awaiting` (Steph's calendar is no
longer the block); leftover verify is whether an **admin** sees every team
in the sidebar dropdown. **N6** absorbs the import cluster: milestone
sheet ignored when importing a rocks workbook (in-app `kind=rocks` never
sets `inputs.milestones` — ninety's two-sheet xlsx is CLI-only for that
half); Preview/dry-run shows filename + write counts, not a row-level
"what will land" (this *is* Jessica's existing N6 dry-run/mapping ask,
confirmed live); department filter is a free-text box defaulting to ESD
— want the **active team** as the default and a **team dropdown** to
import into another team instead of typing a name; unmatched owner
(fired employee came up today) should import as **No Owner** and append
the old name to the description, not skip / placeholder; headlines still
CLI-only — in-app headlines import needed, plus a confirm on archived-row
import (the `includeArchived` checkbox exists; client wants the contract
stated). **N4** sharing was tested on the new second team and **did not
work** (Steph rock). Label rule from the same session: anything shared
across teams lists at the **bottom** as **Shared By {First Last}** of the
item's actual person owner (not the source team name). Company-rock
behavior: the Leadership team (still to be added) uses **company** rocks
instead of team/department rocks — `rock_type: company` already exists
in the model but the create form folded it into Team on 08-12. **N35**
(new): company-wide people CSV (first, last, email) then add-to-team via
dropdown; add-member modal must search the existing directory instead of
re-typing. **N38** (new): deactivate user — block login, keep data, gray
out owned items (the correct alternative to Auth-delete, which re-keys
uid and orphans memberships — P1-2). **Queue unchanged** except N1
leaving `awaiting`; new items land as backlog.

**Session 2026-08-24 (Pass 22) — two live L10s on 2026-08-19 (IT + ESD).**
The client ran a full L10 in the tool on **two** teams the same day, with
Gemini notes + transcripts for both. Seven asks came back; four were built
and shipped this session (`64b11d9`, `3ded811`), two were corroborations of
existing items, and one turned out to be **already built**.

Built: **N39** (headline edit modal went invisible when the cursor left the
viewport) · **N41** (room-wide vote tally) · **N42** (speaker round wraps) ·
and **N26**'s check-off half, which was the week's blocking workflow bug.

Two findings worth more than the fixes:

1. **N26 was never a data-model problem.** Cascading headlines are already
   fanned out **one doc per team** (`importDocId("headline", teamId, …)`),
   so "mark it off for my team only" was a *guard to drop*, not a schema to
   design. Pass 19/20 had left this open as "per-team or per-user — decide";
   the data had already decided. Edit/delete stay blocked, `discussed` and
   `archived` do not.
2. **N39 was a CSS containment bug, not an event handler.** A full sweep
   found **zero** pointer-leave / blur-close handlers in the repo at HEAD or
   at the prod commit — nothing could close a dialog. The modal was rendered
   *inside* the row's `opacity-0 group-hover:opacity-100` action cluster, and
   `opacity` applies to the whole subtree including `position: fixed`
   children. It never closed; it went transparent, and came back with the
   typed text intact. Its `fixed inset-0` backdrop is a DOM descendant of the
   row, which is why hovering anywhere on the page held it open and only
   leaving the window dropped it — exactly what Ryan described. Portalling to
   `<body>` fixes the class of bug, not just the instance; **only headlines**
   nested a modal that way (every other surface puts `opacity-0` on the
   button and renders its modal as a sibling).

**N40 (scorecard categories) is already built and was not found.** Metrics
already carry a `group` field with an inline editor and grouped header rows.
It is labelled **"Section"**, not "category", and the affordance is a small
grey "No section" link. The reason Steph concluded it did not exist: the L10
**suppresses sections by design** — `scorecard-panel.tsx` forces `flatList`
whenever a speaking order is present ("L10 speaking order must not be
reshuffled by section groups"), and she was driving the meeting. So the tab
half is naming/discoverability; the L10 half is a genuine ordering conflict
(90 groups by category in-meeting, we sort by speaker) and needs a decision.

**Scope decision (daniel, this session):** speaker wrap is **one behaviour
across the board, Segue included** — no per-stage flag. The earlier
"everything except Segue" reading is retired. Segue keeps its round-done
marker; it just no longer dead-ends. The old inert-at-the-ends contract in
`stepSpeakerIndex` is deliberately replaced, and its tests rewritten.

**Not queued, deliberately:** N29 and N34 both gained a second independent
witness (below) but no new scope, so neither moved. **Queue unchanged** this
session — everything built was S-sized and rode outside it.

**ID reconciliation** with the agent-local aid
(`CLIENT_FEEDBACK_PRIORITY.md`, which keeps its own P0–P3 / D-series
scheme): `P3-1`, `P2-1`, `P1-7` are the same items in both. Divergent:
this file's **U1** is its **P3-4**; its **P3-3** (headline FYI category) is
shipped inside **QW1**; its D-series is the Resolved log here. On conflict,
this file wins.

**Session 2026-08-26 (Pass 23) — drift check, one reversal, one polish batch.**
Started as a status question and turned into a reconciliation. Three items
(**N29**, **N34**, **N43**) had shipped in `004f22e` on 08-24 and still read
`not-started`; **N23** and **N32** had been built on 08-19 and were still
sitting in `queue.next` as if they were work. They were not — the work was the
**ship**, which is now its own item (**SHIP2**) and `queue.now`. This is the
third consecutive pass to find the same class of drift; the pattern is that
*building* an item updates the code and *nothing* updates the file until
someone asks a status question.

**N32 verified end-to-end** rather than taken from the trail: predicate
(`lib/l10/ratings.ts`), server action (`meetings/actions.ts:506`), rules
(`firestore.rules:271`) and UI (`conclude-review.tsx:206`) all present on
`origin/main`. Built, merged, and **not on prod** — which is the whole point
of SHIP2.

**One decision reversed.** **N42** goes back to wrap-everywhere-**but**-Segue,
undoing the 08-24 consistency call. Checking the sources settled it: Ryan's
ask never mentions Segue, Steph's does ("for headlines or for segue, we would
only go through once"), and the exception lived in daniel's own notes. Nothing
shipped under the retired reading, so no client saw it either way. **N40's
naming re-raised and re-closed:** stays **Group** — Steph says "category", but
ninety's export column says "Group Name", and one word across UI, schema and
source file wins the tie.

**Recorded as N44:** four screen-review polish fixes shipped the same session
(Done-divider drop, headlines rounded-corner clip, scorecard group break,
import page widened). Note the headlines corner bug is **N39's shape again** —
a child painting over the box its parent drew. Two instances now; worth a
sweep for tinted headers leading rounded lists rather than waiting for a third.

**Tier key (workstreams — the project's forcing logic):**

| Tier | Workstream |
|---|---|
| W0 | Foundation & perimeter — GCP infra, deploy path, security lockdown; a bank security review sits on these |
| W1 | Data warehouse — BigQuery pipeline + audit log; gated on client conventions |
| W2 | Team management & tenancy — live on prod; N1 client validation before broad rollout |
| W3 | Product — client-feedback features (Passes 13–20) |
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

### F5 · Ship main (#25–#29) to Cloud Run prod
*W0 · done · due — · deps — · owner daniel · src pr#25,pr#26,pr#27,pr#28,pr#29 · upd 2026-08-12*

Effort S. Prod is `90ec7cb` (the F1 ship). `main` is `98bb30b` and has since
taken **#25 + #26** (settings/profile + Google Tasks completion pull),
**#27** (custom agendas), **#28** (My-Home board + shared-rock read path +
HPB restyle) and **#29** (rich text across descriptions) — five client-tracker
items the client cannot see. Same shape as F1. Extra steps this
time: deploy `firestore.rules` (PR #27 added agenda rules), and each user must
**Connect Google Tasks once on the live URL** because sandbox tokens do not
carry to `hpb-eos-prod-db`. **#28 and #29 need no rules or index deploy** — verified
2026-08-12: neither changed `firestore.rules` or `firestore.indexes.json`, and
#28's one new query (`rocks where shared_team_ids array-contains`) is
equality-only, so Firestore serves it from merged single-field indexes.

⚠ **Sign-in landmine — read before shipping.** F5 puts the Google Tasks
connector (#25/#26) on prod for the first time. `docs/CUTOVER_PLAN.md` is
explicit: Tasks needs **its own** OAuth client in the client's project, and
*"reusing Firebase's is what broke all trial sign-in previously"*
(cutover-checklist §9; P1-7 carries the same warning). This failure mode takes
out **sign-in for everyone**, not just Tasks, so shipping F5 shortly before a
live L10 risks the meeting itself. Either provision the prod OAuth client and
sign-in-test first (including the negative test: a non-HPB, non-allowlisted
account must be **rejected**), or ship F5 *after* the meeting. Rollback per the
cutover plan is to run the session on the trial URL.

Gates U1, P1-7, P2-1 and P3-2 reaching `verified` — F5 is now done, so those
four move to QW1's prod spot-check. Revision id captured: **`eos-00046-nxv`**.

**Trail**
- 2026-08-11 · note · src pr#26,pr#27 — merged to origin/main; prod still on the F1 revision
- 2026-08-12 · note · src pr#28,pr#29 — #28 and #29 also merged; prod still on the F1 revision, now five merge PRs behind. No rules/index deploy needed for #28 or #29 (checked); #27's agenda rules still are.
- 2026-08-12 · risk · src cutover-plan#open-items — the OAuth-client collision that broke all trial sign-in was recorded only in docs/CUTOVER_PLAN.md and P1-7, never on F5 — the item that would trigger it. Folded in above.
- 2026-08-12 · ship · src session-2026-08-12 — daniel: F5 cleared on prod, `firestore.rules` deployed. Confirmed via gcloud: rev `eos-00046-nxv`, image `98bb30b`, 100% traffic. Shipped **without** the N23 archive-tab fix (item opened the same day); N23 needs its own mini-ship before the 08-17 sweep. Sign-in/OAuth landmine above not yet explicitly re-tested — fold the sign-in check (incl. the negative test) into QW1's prod spot-check.

### SHIP2 · Ship main (#30–#39 + 08-26 polish) to Cloud Run prod
*W0 · not-started · due — · deps — · owner daniel · src session-2026-08-26 · upd 2026-08-26*

Effort S. **Prod is `98bb30b` (2026-08-12); `main` is `4498653`.** Thirteen
days and ten merge PRs of client-visible work sit unshipped, including two
bugs the client has already hit and one they reported twice:

- **N23** — Rocks **Archived** tab crashes on any archived rock. The Monday
  sweep has run since (08-17), so the crash is reachable on prod today.
- **N32** — meeting ratings stay rewritable after conclude. Steph reported it
  twice; Joe named the integrity angle.

Also riding: **N26** (headline collapse + per-team check-off), **N39**,
**N41**, **N42** (now wrap-everywhere-but-Segue), **N40** (scorecard groups),
**N29**, **N34**, **N43**, **N24**'s L10 Active|Archived slice, **N6**
(import overhaul), **N4** shared-rock surfaces, and **N44** (08-26 polish).

**Three deploys, not one** — `pnpm ship` covers only the image + runtime env:

1. **App image** — `pnpm ship` (dry-run first; tag = short commit).
2. **`firestore.rules`** — 65 changed lines since prod: N32's conclude freeze
   (`ended_at == null` on meeting update), `scorecard_groups` (N40), and the
   shared-rock read path (partial N20). *Without this the rating lock is
   server-action-only.* `firebase deploy --only firestore:rules --project
   hpb-eos-prod`.
3. **Cloud Functions** — `functions/src/todos-archive.ts` dropped the
   `broadcast` exclusion for N26. *Without this the Monday sweep never
   archives a cascaded headline a team checked off.* Deploy needs the
   `database` option (already wired, `functions/src/index.ts:122`).

Carries the same ⚠ **sign-in landmine** as F5 — the OAuth-client collision was
never explicitly re-tested after F5. Do the negative test (a non-HPB,
non-allowlisted account must be rejected) and do not ship shortly before a
live L10. **F4's `archived_at` backfill should follow the ship**, not precede
it, so the Archived tab is already fixed when legacy rows become sweepable.

**Trail**
- 2026-08-26 · note · src session-2026-08-26 — recorded after a drift check: the front matter still queued N23 and N32 as work when both had been built on 08-19 and merged. The remaining work was never the fix, it was the ship — so the ship became the queue item instead of hiding behind two `in-progress` rows

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
*W0 · in-progress · due — · deps — · owner daniel · src audit-2026-08-04#medium · upd 2026-08-19*

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
disagrees); (c) `L10_GAPS` red item **partial** — N32 froze client **updates** on
concluded meetings (`ended_at != null`); delete of a finished meeting
is still member-writable; (d) audit M3/M6–M8/M14 + L-tail remain
unfixed. M5 is **N23**. Backfill script: `scripts/backfill-archived-at.ts`
(dry-run default; `--apply` to write).

**Trail**
- 2026-07-29 · note · src l10-gaps#data-infra-hygiene — red flag: Firestore rules allow direct client update/delete of meeting docs; tighten to read-only for clients
- 2026-08-04 · build · src pr#19 — audit triage 1–6 fixed and merged: H1, H2, M9–M13, M1 partial, M2, M4; tests 182 passing
- 2026-08-04 · note · src audit-2026-08-04#fixes-applied — operator TODO recorded: archived_at backfill required before the next Monday sweep matters; rules need a deploy for M4 to take effect
- 2026-08-10 · note · src F1 — prod ship closed; rules deploy assumed with F1 (spot-check if Monday sweep or tenancy misbehaves)
- 2026-08-19 · build · src session-2026-08-19 — `scripts/backfill-archived-at.ts` (todos/issues/headlines; dry-run default). Monday sweep 08-17 has already run; still worth applying so the next Monday sees legacy imports. N32 also froze client updates on concluded meeting docs (partial close of (c)).

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
Remaining: N1 leftover confirm (admin sees every team in the sidebar
dropdown) before promoting to `verified`. Stretch extracted: company
people CSV + add-from-directory is **N35**; private-team flag and ninety
Owner/Implementer roles stay out of scope here.

**Trail**
- 2026-07-30 · transcript · src tracker-2026-08-03#9 — Jenna: multi-team org; needs admin testing; "employee issues must not leak across individuals/teams"
- 2026-08-10 · decision · src roadmap-prior#resume-here — soft directory / hard data model; admin claim + leader/member; invite-only, /join retired
- 2026-08-15 · client · src l10-2026-08-12-transcript — daniel walked the built model live (All Teams visible to everyone as a directory with rosters; leaders add/remove their own members; only global admin creates teams) and it drew no objection — the model holds against client review
- 2026-08-10 · pr · src pr#24 — team management merged to main; sandbox-exercised; prod deploy pending
- 2026-08-10 · done · src F1 — prod ship confirmed; teams infra live; N1 still gates `verified`
- 2026-08-18 · client · src onboarding-2026-08-18 — Steph walkthrough ran (N1). New-team onboarding solid; adding members not. Directory CSV stretch pulled to N35. Admin-sees-all-teams dropdown still to confirm before `verified`

### N1 · Steph as admin + new-team onboarding test
*W2 · in-progress · due — · deps P2-7,F1 · owner both · src roadmap-prior#pass-18 · upd 2026-08-18*

Effort S remaining. The walkthrough **ran 2026-08-18**. Verdict: new-team
onboarding was solid; in-app import was decent (findings on **N6**);
new-team + adding members was not (extracted to **N35**). Cross-team
share was exercised on the new second team and failed (**N4**). Leaves
`awaiting` — Steph's calendar is no longer the block.

**Still open before P2-7 → `verified`:** confirm an **org admin** sees
**every team** in the sidebar team dropdown, not only teams they belong
to. That was the original "god mode on team data" promise and was not
explicitly checked today.

Ops notes: `docs/TEAM_MGMT_OPS.md`. `pnpm accounts:create` is still not
sandboxed. Deleting an Auth user still re-keys uid (P1-2) — the client
path for leavers is now **N38** (deactivate), not delete. Leadership
team is still to be added (company rocks live there — see N4).

**Trail**
- 2026-08-03 · transcript · src tracker-2026-08-03#13 — Steph: wants admin testing when ready
- 2026-08-10 · note · src roadmap-prior#pass-18 — captured as next-work item 1
- 2026-08-10 · note · src F1 — prod unblocked; promoted to queue.now
- 2026-08-12 · note · src session-2026-08-12 — flagged as the item behind today's L10 new-team/new-member test; confirmed runnable on prod (PR #24 is live) and therefore not gated on F5
- 2026-08-12 · followup · src l10-2026-08-12 — daniel to schedule a separate onboarding meeting with Steph; the walkthrough this item waits on now has a concrete vehicle
- 2026-08-18 · client · src onboarding-2026-08-18 — walkthrough ran. Onboarding solid; import decent; add-members not. Admin-dropdown confirm still owed. Findings → N4 / N6 / N35 / N38

### N2 · Multi-team stress-testing setup
*W2 · not-started · due — · deps P2-7 · owner daniel · src roadmap-prior#pass-18 · upd 2026-08-15*

Effort M. Multi-team multi-user scenario covering admin/leader/member;
concurrent L10 + standalone edits; the allowlist + membership matrix.
Deliverable includes documenting how to spin the scenario up (sandbox seed
/ import) so it is repeatable. Sandbox-runnable, so it does not wait on F1.

**Trail**
- 2026-08-10 · note · src roadmap-prior#pass-18 — captured as next-work item 2
- 2026-08-15 · followup · src l10-2026-08-12-transcript — daniel owes Brian's move off the ESD team ("we'll get Brian on a different team here soon"); his no-goal scorecard rows surfaced in the ESD L10 and confused the room. A one-off, but it is also the first real membership move — use it as the N2 scenario's first step rather than doing it by hand and learning nothing
- 2026-08-18 · note · src onboarding-2026-08-18 — a second team now exists (N1 walkthrough). Leadership team is still to be added (company rocks — N4). Use both in the stress scenario rather than inventing sandbox-only teams

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

### N20 · Shared-rock grant is ungoverned in rules
*W2 · not-started · due — · deps N4 · owner daniel · src pr#28 · upd 2026-08-12*

Effort S. Found while reconciling PR #28 (2026-08-12). The shared-rock read
path ships, but `shared_team_ids` is absent from `firestore.rules`, and the
rocks block is broad:
`allow read, update, delete: if admin() || isMember(resource.data.team_id)`.
Two consequences, neither yet reachable because the share **writer** does not
exist (N4) — which is the window to fix it:

1. **The grant is unvalidated.** Any member of a rock's parent team could set
   `shared_team_ids` to *any* team id, including teams they do not belong to,
   exposing that rock on those members' Home. P2-7's promise is "privacy
   stays hard on non-shared team data" — but nothing constrains who may move
   a rock across that line.
2. **Rules and server disagree.** Home reads via the Admin SDK
   (`getUserTeamsFirebase` → `getAdminDb`), which bypasses rules, so a guest
   member sees a shared-in rock that the client SDK would refuse them
   (`read: isMember(resource.data.team_id)` covers only the parent team). Any
   future client-side/live view of shared rocks will silently disagree with
   Home until rules model the share.

Fix shape (decide with N4): rules validate the writer is a member of both the
parent team and each team being shared into, freeze `shared_team_ids` against
non-owner edits the way `todos` freezes its stamps (M4 precedent), and extend
the rocks read rule to `isMember(team_id) || isMemberOfAny(shared_team_ids)`
so the client path matches Home.

**Trail**
- 2026-08-12 · note · src pr#28 — read path merged with no rules coverage; recorded as backlog, not queued, since the writer that makes it reachable is unbuilt
- 2026-08-12 · decision · src session-2026-08-12 — daniel: N20 valid, but no second team exists, so sharing is deferred; the PR #30 writer stays (inert with one team), the read surfaces come out. Fix these rules before any sharing surface returns — see N4 consolidation.
- 2026-08-18 · note · src onboarding-2026-08-18 — second team now exists and a share was attempted (failed — N4). N20 is reachable the moment the writer is used again; do not ship share without these rules.
- 2026-08-19 · decision · src session-2026-08-19 — share-down overrules "writer must sit on the guest team". Parent-team member (or admin) may share into any org team. Guest read rule (`listSharedToMe`) is the N20 remaining piece and is in `firestore.rules`.

### N35 · Directory: company people CSV + add-member from directory
*W2 · not-started · due — · deps P2-7 · owner daniel · src onboarding-2026-08-18 · upd 2026-08-18*

Effort M. The Pass 11 / P2-7 stretch, now concrete from Steph's
onboarding session. New-team onboarding was solid; **adding members was
not** — every person had to be typed in (first, last, email) even when
they already exist in the org directory.

Two surfaces, one directory:

1. **Company CSV import** of people, then assign to a team from a
   dropdown. Format: **first, last, email**. This is org-directory
   provisioning, not entity import (N6). Creates/updates user docs +
   Auth-ready accounts the same way today's add-member path does;
   membership is a second step (the dropdown), not implied by the file.
2. **Add-member modal searches the existing directory.** When adding
   someone to a team, pick/search a person who is already in the org
   (typeahead on name or email) instead of re-entering first/last/email.
   Creating a brand-new person stays available for true newcomers.

Do not collapse this into N6 — different payload, different permissions
(org admin vs team leader), and the CSV is people not rocks.

**Trail**
- 2026-07-13 · note · src roadmap-prior#pass-11 — CSV user import named in directory/admin asks
- 2026-08-10 · note · src P2-7 — stretch left open: CSV directory import
- 2026-08-18 · request · src onboarding-2026-08-18 — Steph: company CSV (first, last, email) then add-to-team dropdown; add-member modal should pull/search the existing directory

### N38 · Deactivate user (soft-delete)
*W2 · not-started · due — · deps P2-7 · owner daniel · src onboarding-2026-08-18 · upd 2026-08-18*

Effort M. Fired / departed employees came up on the 2026-08-18 import
(unmatched owner — N6 #4). Today's only lever is deleting the Auth user,
which **re-keys the uid and orphans memberships** (P1-2). Wrong tool.

**Deactivate** = block sign-in (allowlist / Auth disable / a
`deactivated_at` flag the session and rules both honor) and **keep the
data**. Owned rocks, todos, issues, headlines, scorecard rows stay put,
rendered with a grayed-out / former-member treatment so the history is
readable and nothing silently retitles to "No Owner" unless an import
or a later reassign says so. Reactivate is in scope (clear the flag,
sign-in works again). Hard-delete stays an operator script, not an
in-app button.

Pairs with N6's unmatched-owner rule (import a leaver's rows as No
Owner + name in the description) and with N35 (directory is the list
deactivate acts on).

**Trail**
- 2026-08-10 · note · src P1-2 — deleting an Auth user re-keys uid and orphans memberships
- 2026-08-18 · request · src onboarding-2026-08-18 — deactivate blocks login, retains data, gray-out owned items

## Workstream 3 — Product (client feedback, Passes 13–21)

### QW1 · Pass 18 quick-win batch (PR #22)
*W3 · shipped · due — · deps F1 · owner daniel · src roadmap-prior#pass-18 · upd 2026-08-15*

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

Added 2026-08-12 (live L10): the verification sweep also confirms **agenda
scoping** — created agendas (P2-1, PR #27) are assigned to the **team**, not
to the individual who created them, and staff (non-leader) permissions show
agendas in the Meetings tab as expected. Client flagged both as
double-checks, not observed bugs.

**Trail**
- 2026-08-05 · transcript · src roadmap-prior#pass-18 — items 9, 11, 12, 14, 16, 17 decided from the ESD L10 transcript (Steph, Joe, Cora asks)
- 2026-08-10 · pr · src pr#22 — nine quick wins merged to main in batched commits
- 2026-08-10 · note · src roadmap-prior#last-updated — live Cloud Run revision predates the merge; client has not seen these
- 2026-08-10 · note · src F1 — prod ship confirmed; batch is live; `verified` still wants a spot-check
- 2026-08-12 · request · src l10-2026-08-12 — daniel: double-check agendas are team-assigned (not individual) and staff can see agendas in the Meetings tab
- 2026-08-15 · client · src l10-2026-08-12-transcript — the concrete symptom: Steph's Meetings tab shows "join live meeting" but not the agenda surface Joe reached ("I don't think I got to where Joe was able to get to"); daniel: "I'll double check that". Check against her actual role, not the leader role

### N4 · Multi-team surface + shared rocks
*W3 · in-progress · due — · deps P2-7 · owner daniel · src roadmap-prior#pass-18 · upd 2026-08-19*

**Core shipped PR #28** (`feature/multi-team`), discovered by reconciliation
2026-08-12 — this item was still marked `not-started` while its build sat on
`main`. Shipped: `lib/home-board.ts` ("My Home board selection rules", +232
lines of tests) filtering to the **viewer's own** to-dos / rocks /
milestones, which is N13's ask and Cora's complaint answered; Home reading
across all membership teams with per-team labels; the shared-rock **read**
path (`rocks where shared_team_ids array-contains <my team>`, status filtered
in memory to avoid needing a composite index); and an HPB-brand restyle of
Home, rocks rows/detail, status badges and the comment composer.

**Steph model refine (2026-08-12):**
1. Rocks are **always owned by a person**. A department/team rock is still
   person-owned — e.g. **Joe owns the EOS deployment rock for ESD** (team
   priority, Joe accountable). Individual vs department is type/scope, not
   “unowned.”
2. **Share rocks with teams**, not with individuals. People see a rock via
   team membership (parent or `shared_team_ids`), not person-level rock share.
3. **Milestones may cross teams** (person assignees elsewhere). That is
   milestone assignment, separate from rock↔team sharing.

**Build (PR #30, merged 2026-08-12):** modal separates **Type**
(individual/department/company) from **Owner** (person required); optional
**Share with teams** → `shared_team_ids`; guest Rocks list + L10 show shared-in
rocks (read-only, “from {team}” badge). Legacy `owner_id: null` still sorts
into Department. Firestore rules: guest teams may **read** shared rocks.

**Consolidation (2026-08-12, `feat/rocks-owner-type-simplify`):** daniel:
*no second team exists yet, so we are not sharing across teams* — the durable
model is **two data points on every rock: a person `owner_id` (required) and
a `rock_type` flag (individual vs team/company)**. That model stays. The
shared-in **read surfaces** (guest Rocks list, L10 shared-in rocks) were
removed again on this branch; the modal's share picker remains but is inert
with one team. **N4 moves to `awaiting` — gated on a second team existing.**
N20 rides with it and stays unreachable until then.

**Green-lit + spec clarified (2026-08-12 live L10).** The client wants the
share function on rocks turned on, and resolved the surface design:

1. **Two mechanisms, not one.** Pass 19 read daniel's "the only way to
   assign a rock or milestone to a user across a different team is to
   assign that specific milestone" as the whole model, but the same
   dictation also says "we want to green light the share function on
   rocks" — two clauses, two gestures. The transcript settles which is
   which:
   **(a) explicit rock→team share** — at creation or via rock edit, assign
   the rock to another team as a whole and it lands at the bottom of that
   team's Rocks page. Steph confirmed this is how 90 works today and how she
   uses it ("you can share the rock with other teams and you can share with
   multiple teams"), so the `shared_team_ids` picker is *validated*, not
   superseded. **(b) milestone-assignee pull-in** — assigning someone a
   milestone pulls the parent rock along as a headliner plus **only that
   milestone**, never the rock's other milestones. Build both; (b) is the
   default that makes (a) safe to leave narrow.
2. **"Shared with you" section** at the bottom of the Rocks page shows
   rocks shared in from other teams this way, **team-specific only**.
3. Worked example — and note it is **live 90 behavior, demonstrated in the
   meeting, not a hypothetical**: Cora was assigned one milestone ("work
   with Jessica and Kora") on Carissa's "Moody's reporting" rock. Cora sees
   that milestone and can click through to the rock's description, but
   cannot see the rock's other three milestones — she did not even know
   they existed. Steph confirmed four milestones total. Both daniel and
   Steph endorsed this as the right **default**: "a better starting place
   than everybody can kind of see everything."
4. **The restriction to actually design around** (Steph, 00:57–00:58 — not
   captured in Pass 19): she can only share *up or across*, never *down*.
   To get a rock in front of both ESD and leadership she must create it on
   the lower team and share it up; she **cannot create a rock on the
   leadership team and share it down**, because the other members have no
   access to the leadership team. She reads it as a permissions
   restriction. This is the concrete failure the share model has to fix —
   design it before reinstating surfaces.
5. Steph also separated two things the word "sharing" was covering:
   **visibility** ("just understanding what other teams' rocks are") vs
   **participation** ("rocks that other people are a part of"). The
   milestone-assignee path serves the second; the first may want a lighter
   read-only surface. Open.

**Garbled fragment — probably resolved (Pass 20).** The Pass 19 flag —
"personal plus business best, some nice header" — is garble in *daniel's
dictation*, not in the meeting record, so the transcript can only offer a
candidate rather than a decode. The strong candidate is Steph naming the
*label*, which would make it a wording note rather than a separate ask: "as long as we had a distinction, it's like there's Steph's
rocks and then here's ... shared with you, or like shared rocks, or
something like that ... some kind of distinction would be helpful." The
"Shared with you" section in point 2 already carries it. Flag cleared.

**Built 2026-08-19 (read surfaces + share-down).** The 08-18 fail was the
guest Rocks/L10 list never querying `shared_team_ids array-contains`.
Writer already persisted. Fix: guest Rocks tab and L10 show shared-in
rocks at the **bottom** as **Shared by {First Last}** of the person
owner; guest row is read-only (`from {parent team}`). Share picker
lists **every org team** (not only memberships) so Leadership can share
*down* into ESD. Server accepts any org team id. Guest milestone/status
reads allowed when the parent rock is shared to the viewer (rules).

**Remaining:**
- Milestone-assignee pull-in (rock headline + **only** that milestone)
  is not this path — still to build.
- **Company rocks on the Leadership team.** Leadership (still to be
  added) uses `rock_type: company` instead of team/department. The field
  already exists; the 08-12 form folded Company into Team
  (`ROCK_KIND_OPTIONS` is Individual | Team only, `toFormRockType`
  remaps company → department). Re-offer Company on Leadership (and
  only there, unless the client says otherwise).
- Migrate legacy `owner_id: null` rocks.
- The original tab question beyond Home (per-team sections vs unified feed vs
  sticky filter) is still open for the non-Home surfaces.

**Shared rocks are in product scope** (decided 2026-08-10): a rock has a
parent team (canonical home) and can be shared/visible on other teams the
owner belongs to — Steph's example: rock originated on IT Systems & Security,
shared into ESD. Privacy stays hard on non-shared team data (P2-7).

**Trail**
- 2026-08-05 · transcript · src roadmap-prior#pass-18 — Cora: Home is a dump of everyone's items; wants My-90-like personal priority
- 2026-08-10 · decision · src roadmap-prior#pass-18 — shared rocks in scope: parent team + share/visibility on other teams; milestone assignees cross-team
- 2026-08-10 · decision · src roadmap-prior#pass-18 — N13 folded into this item; design precedes build
- 2026-08-12 · build · src pr#28 — My-Home board + multi-team Home + shared-rock read path shipped to main; found by reconciliation, not recorded when merged
- 2026-08-12 · note · src pr#28 — remaining scope re-derived from the merged code: no share writer, Rocks tab excluded, rules gap (N20), milestone-assignee case unverified
- 2026-08-12 · client · src session-2026-08-12 — Steph: always person-accountable; share rock→teams not people; milestones can span teams
- 2026-08-12 · build · src pr#30 — share writer + type/owner split + guest read surfaces (Rocks tab + L10) on `feature/multi-team`; answers the two pr#28 gaps above
- 2026-08-12 · decision · src l10-2026-08-12 — share function green-lit; milestone assignment is the cross-team mechanism; "Shared with you" section, rock headline + only the assigned milestone, in both Rocks tab and L10
- 2026-08-12 · request · src l10-2026-08-12 — sharing-block touch-ups, wording garbled ("personal plus business best, some nice header") — confirm against transcript backup
- 2026-08-15 · correction · src l10-2026-08-12-transcript — garbled fragment probably resolved: dictation garble, best match is Steph naming the "shared with you / shared rocks" label; treat as a wording note unless daniel's written notes say otherwise
- 2026-08-15 · correction · src l10-2026-08-12-notes — mechanism is dual, not milestone-only; daniel's own notes green-light the share function alongside the milestone rule, and Steph confirms rock→multi-team share is 90's behavior and hers, so `shared_team_ids` stays primary alongside the milestone pull-in
- 2026-08-15 · client · src l10-2026-08-12-transcript — Steph: cannot create a rock on leadership and share it *down*; only up/across works, reads as a permissions restriction — the real gap, missed in Pass 19
- 2026-08-15 · client · src l10-2026-08-12-transcript — Cora's live demo (Moody's reporting, 4 milestones, sees only hers) is existing 90 behavior endorsed as the default, not a new spec
- 2026-08-18 · client · src onboarding-2026-08-18 — second team now exists; Steph rock share was tested and did not work
- 2026-08-18 · request · src onboarding-2026-08-18 — shared items list at the bottom as "Shared By {First Last}" of the person owner
- 2026-08-18 · request · src onboarding-2026-08-18 — Leadership team (to be added) carries company rocks, not team rocks; re-offer `rock_type: company` there
- 2026-08-19 · build · src session-2026-08-19 — guest Rocks + L10 list shared-in rocks ("Shared by {First Last}"); picker = all org teams (share-down); guest read-only; todo/status rules follow the shared rock. Diagnose: writer was fine, read surface was missing.

### N21 · Headlines add-form → button (match the other tabs)
*W3 · not-started · due — · deps — · owner daniel · src session-2026-08-12 · upd 2026-08-12*

Effort S. The Headlines tab carries a permanently-open add form at the top
(title + category + detail + Add button) while every other tab uses a single
button that opens a modal — Rocks "+ New Rock", Issues "+ Add issue", To-Dos
"+ Add to-do". Collapse Headlines to the same pattern so the list is the page
and adding is an action, not a standing block of fields.

Note the interaction with **P3-2**: that inline form now holds a
`RichTextEditor` (grown to 7 rows on 2026-08-12 at the client's request,
because people write a lot there). Moving it into a modal should reuse the
sizing already proven in `headline-edit-modal.tsx` — `max-w-4xl`, 16 rows,
footer pinned outside the scroll area — rather than re-deriving it. The edit
modal is effectively the target design; this item is mostly "use it for
create too".

**Trail**
- 2026-08-12 · request · src session-2026-08-12 — daniel: collapse the floating add fields to a button like all the other add types

### N22 · To-Dos tab restyled to the Home board
*W3 · not-started · due — · deps — · owner daniel · src session-2026-08-12 · upd 2026-08-12*

Effort S–M. Restyle the To-Dos tab to the two-column Home board that shipped
in **PR #28**, with **rock-milestone to-dos and ordinary to-dos on the left**.
Pull over whatever the Home work already solved rather than re-deriving it:
`lib/home-board.ts` owns the selection rules (including
`isMilestoneHiddenByRock`, which is exactly the milestone-vs-todo overlap this
tab has to get right), and `app/(app)/home/home-rocks-list.tsx` plus the
restyled row/badge components carry the visual language. Scope is presentation
+ grouping, not new data.

Open sub-question for the build: the To-Dos tab is team-scoped while Home is
person-scoped, so "two columns" has to be re-read for a team surface — decide
whether the right split is milestones/to-dos (as asked) or mine/team's, and
confirm against the tab's actual job in the L10 To-Dos segment before
committing to the layout.

**Trail**
- 2026-08-12 · request · src session-2026-08-12 — daniel: to-do needs restyled like home page, two column, rock milestone to-dos and normal to-dos on the left; style relative to the pieces that can be pulled over

### N23 · Rocks Archived tab crashes — audit M5 confirmed live
*W3 · in-progress · due 2026-08-16 · deps — · owner daniel · src session-2026-08-12 · upd 2026-08-19*

Effort S. The Rocks **Archived** tab throws as soon as any archived rock
exists — reported broken on `main` 2026-08-12. Root cause is exactly audit
**M5** (`docs/AUDIT_2026-08-04_PR11-18.md`), which F4 had carried as "may
have been mooted by PR #22 — verify, don't assume": not mooted.
`rocks/page.tsx` projects `archived_at: x.archived_at ?? null` — a raw
admin-SDK `Timestamp` instance — into the `"use client"` `RockRow`; class
instances aren't RSC-serializable, so Active renders (all `null`) and
Archived crashes. Every other tab already serializes defensively server-side
(todos/issues/headlines format `archived_at` via `toDate`/`toMillis` before
the boundary); Rocks is the one surface passing the raw object. Prod now runs the
same code (`98bb30b` via the F5 ship, which predated this fix), so its tab
breaks the moment the Monday sweep archives its first rock — which F4's
backfill (due before 2026-08-17) is about to make happen. Fix is small:
serialize at the projection (millis or a boolean — `rock-row.tsx` only ever
checks `!= null`). F5 shipped without it, so this now needs its **own
mini-ship to prod** (same F5 mechanics, no rules deploy); the due date is
the Sunday before the sweep. **Fix built** on
`feat/rocks-owner-type-simplify` (with the rocks-simplification work):
`archived_at` serialized to millis at the projection, plus the L1 rocks
half — the L10 rocks segment now filters archived rocks (client
subscription and server prefetch). L1 remainder closed in this tree:
`todos/page.tsx` and `segment-todos.tsx` both call
`isMilestoneHiddenByRock`. Remaining: merge + mini-ship with N32.

**Trail**
- 2026-08-04 · note · src audit-2026-08-04#M5 — predicted: "Archived rocks tab will throw once any rock is archived"; latent only because the archive path didn't exist yet
- 2026-08-12 · report · src session-2026-08-12 — daniel: Rocks archive tab broken on main; diagnosis matches M5 (raw Timestamp across the RSC boundary into RockRow); prod carries the same code
- 2026-08-12 · build · src feat/rocks-owner-type-simplify — millis serialization + L10 archived-rock filter (L1 rocks half); 331 tests pass, tsc clean; awaits PR merge + prod mini-ship
- 2026-08-19 · verify · src session-2026-08-19 — serialization + L1 milestone filter both present on this tree; still not on prod (`98bb30b`). Ships with N32.

### N24 · Coherent add-{item} + Active | Archived pattern on every entity tab
*W3 · not-started · due — · deps — · owner daniel · src session-2026-08-12 · upd 2026-08-15*

Effort S–M. App-wide coherence pass: every entity tab (Rocks, To-Dos,
Issues, Headlines) presents the same two affordances the same way — one
**"+ Add {item}"** button opening a modal, and one **Active | Archived**
segmented toggle. The data layer is already uniform (all four tabs filter on
`?archived=` and `archived_at`); the presentation isn't — Headlines still
carries a permanently-open add form (**N21** is the Headlines slice of this
item), and toggle placement/labels/counts differ tab to tab. Rocks' toggle
(pill pair with counts + Archive icon) is the most complete; treat it as the
reference once **N23** fixes its crash. **N22** (To-Dos restyle) must
conform to this pattern rather than invent another — this item frames
N21/N22, it does not duplicate them. Extend to any future entity surface,
and honor the standing design note that tabs render the same in-meeting and
standalone (docs/ROADMAP.md cross-cutting notes).

**Extended 2026-08-12 (live L10):** the client hit this in the meeting — the
Active | Archived view for Issues, To-Dos, Rocks, and Headlines exists only
in normal mode, not the L10. They want it **in both modes**, so the four L10
segments are now explicitly in scope (until now the parity work — PR #34 —
deliberately preserved "no archived tab in-meeting" as a meeting-specific
choice; that choice is overruled by this ask).

**Trail**
- 2026-08-12 · request · src session-2026-08-12 — daniel: global app coherence on add {item} and active | archive view
- 2026-08-12 · client · src l10-2026-08-12 — bug per client: Active/Archived views absent in the L10, present in normal mode; wanted in both
- 2026-08-15 · client · src l10-2026-08-12-transcript — Steph endorses manual (not quarter-end automatic) rock archiving: planning timing varies per team, "it's helpful to just archive it once we've discussed it and it creates a clean slate" — validates the F4/N23 model; she archived Cora's rocks live during the meeting
- 2026-08-12 · build · src pr#35 — L10 slice built same day: `EntityViewToggle` (client-state twin of EntityViewTabs) + archived views in all four segments, restore working in-meeting; PR open awaiting review. Standalone-tab placement/label coherence (the rest of this item) still open

### N25 · Meeting presence confirmation
*W3 · not-started · due — · deps — · owner daniel · src l10-2026-08-12 · upd 2026-08-15*

Effort S–M. Better visibility into who is actually **in** the meeting: when
a user joins the L10, surface a confirmation that they're present, and give
the room a live view of who has joined. Client: "I'm pretty sure we should
be able to do that pretty easily" — and they're right: a presence layer
already exists (the audit-log Cloud Function explicitly excludes presence
docs from capture), and the L10 already tracks absent users + speaking
order. This is surfacing, not new infrastructure — likely a joined/roster
indicator on the meeting rail fed by the existing presence docs.

**Concrete target (Pass 20).** Steph screen-shared 90's version and it is
small: a **"3 of 7 are here"** count at the top, **checkmarks** on the
roster for who has joined, and the joined members queued into the sharing
order below. She was working around its absence live — asking out loud
"Jessica, are you in the meeting?" Match that shape; it is the pattern the
team already reads.

**Trail**
- 2026-08-12 · request · src l10-2026-08-12 — need a better way to see who is present; confirmation when a user joins
- 2026-08-15 · client · src l10-2026-08-12-transcript — 90's shape: "3 of 7 of us are here" + per-member checkmarks + joined members queued for sharing order

### N26 · Headlines — collapse long bodies + check off after sharing
*W3 · shipped · due — · deps — · owner daniel · src l10-2026-08-12 · upd 2026-08-24*

Effort S–M. Two asks from live use, both born of P3-2 rich text making
headline bodies long:
1. **Expand/collapse on headline descriptions, collapsed by default** — the
   list should be scannable titles, with the long body one click away.
   Applies to both the Headlines tab and the L10 segment (N24 coherence).
2. **Headlines can be checked off after they are shared** — broader than
   Pass 19 recorded. Steph's framing is the normal EOS cycle: "you put a
   headline on there, you share the headline, and then you check it off."
   Today none of them can be checked off, so last week's headlines are
   still standing this week. This applies to **ordinary team headlines
   first**; the cascading org-wide ones are the same ask and the harder
   case, since they stay read-only — those need a dismissed state
   (per-team or per-user — decide) that does not touch the broadcast
   source doc.

**Both halves shipped (Pass 22).** Collapse landed 2026-08-19 (`0f5c7a1`,
`HeadlineBody` — click-toggled disclosure with a one-line clamp). Check-off
landed 2026-08-24 (`3ded811`).

The per-team question Pass 19 left open — "a dismissed state (per-team or
per-user — decide)" — needed no design: cascading headlines are **already
one doc per team** (`importDocId("headline", ctx.teamId, …)` in
`lib/team-import.ts`, and the headlines query is `where("team_id", "==",
teamId)`). So `discussed` and `archived_at` were already per-team facts and
the only thing in the way was a blanket read-only guard applied to all four
mutations. Dropped from `setHeadlineDiscussed` and `setHeadlineArchived`;
**kept** on `updateHeadline` and `deleteHeadline`, because those would
rewrite the org's message for whoever cascaded it. The Finish and Monday
sweeps stopped holding broadcast copies back (`lib/todos-archive.ts` +
`functions/src/todos-archive.ts` — the second needs a **Cloud Function
deploy**, not just an app ship). Badge now reads "Org-wide · text is
read-only" so it says *which half* is locked. Archive is exposed on
broadcast rows on the Headlines tab; edit/delete stay hidden.

Confirmed verbatim on both 8/19 calls. Steph: "each team will have that in
their queue to share ... when they mark it off, it's setting the status that
it was shared with a team, not that it's not available to share anymore."
Joe: "it'd be nice if this team could mark it complete, but it doesn't
affect other teams."

**Trail**
- 2026-08-12 · request · src l10-2026-08-12 — descriptions are quite long; collapse by default, expand on demand
- 2026-08-12 · request · src l10-2026-08-12 — want to close out organizational headlines even though read-only
- 2026-08-15 · correction · src l10-2026-08-12-transcript — check-off is wanted for *all* headlines ("share it, then check it off"), not only org-level; Pass 19 scoped it too narrowly
- 2026-08-15 · client · src l10-2026-08-12-transcript — Steph on collapse: leadership can have ~20 headlines; click to read rather than display all bodies continuously
- 2026-08-19 · client · src l10-2026-08-19-it — Steph + Joe: cascading messages still can't be marked off; want per-team completion that doesn't affect other teams. Second sighting same day on ESD (src l10-2026-08-19-esd)
- 2026-08-24 · build · src session-2026-08-24 — collapse shipped `0f5c7a1`; check-off shipped `3ded811`. Per-team was a guard to drop, not a model to change — the fan-out is already per team. Edit/delete stay blocked; sweeps updated; functions deploy required

### N27 · Leader-driven meeting sync (follow the leader, off-sync opt-out)
*W3 · not-started · due — · deps — · owner daniel · src l10-2026-08-12 · upd 2026-08-15*

Effort M. Whoever hits **Start meeting** becomes the default driver: their
transport actions (segment advance, jump) propagate to everyone in the
meeting so the room moves together, with a notification of the driver's
action. Individual users keep the ability to step to another page — go
**off-sync** — and presumably rejoin sync. Builds directly on what exists:
leader-only transport is already enforced server-side (QW1 #9) and the
meeting doc already carries segment state; the new part is followers'
clients tracking the meeting doc's current segment by default plus an
off-sync toggle, and the action notifications. Pairs naturally with N25
(presence) — same rail, same realtime channel.

**Confirmed on the transcript (Pass 20).** The group-position indicator
already exists and works — Cora talked Joe through it live ("that little
tiny blue dot next to scorecard, that's where the meeting is"), and Joe,
who had started the meeting, expected the group to have *moved* with him.
So the missing half is exactly the follow behavior, not the state. Joe
came down in favor of keeping the driver model — "in some ways it kind of
holds you accountable, it makes you go through the entire cycle of the
meeting" — after daniel offered to drop group-vs-individual tracking
entirely. Keep it; add the follow.

**Trail**
- 2026-08-12 · request · src l10-2026-08-12 — starter drives; actions notified to all; others pulled along; users can go off-sync
- 2026-08-15 · client · src l10-2026-08-12-transcript — blue-dot group indicator already ships and reads correctly; Joe expected followers to be pulled along; Joe endorses the driver model on accountability grounds

### N28 · Scorecard metric-expand styling + scroll behavior
*W3 · not-started · due — · deps — · owner daniel · src l10-2026-08-12 · upd 2026-08-15*

Effort S–M. Verbatim from daniel's recovered notes: "the scorecard
expansion feature and the metrics are cool. However, the overall styling is
a little bit off, and you kind of have to scroll the metric oddly. So we're
gonna wanna improve the scorecard expansion behavior." Likely the expand
panel's height / inner scrolling inside the grid — the L10 wraps the grid
in a `max-h-[min(60vh,28rem)]` scroller, which compounds any inner scroll
oddness.

**Re-attributed (Pass 20): this is daniel's own observation from driving
the screen, not client feedback.** Pass 19 logged it as `client`; the
recovered notes and the transcript both say otherwise. Nobody in the room
raised it, and the scorecard segment (00:24–00:28) drew only praise — Joe
on the no-goal treatment ("I kind of like the gray theme for the no-goal
one, the red and green are indicating good or bad, I think that's pretty
good"), Steph on inline entry recalculating in real time ("which is nice"),
and "we feel good about the scorecard." That does not make the gripe wrong
— daniel was the one operating the expansion — but it means there is no
client pressure behind it and no second witness to the repro. Get the
specifics from daniel before styling blind: which surface (tab vs L10),
which unit/interval, what scroll gesture felt wrong.

**Trail**
- 2026-08-12 · client · src l10-2026-08-12 — expansion + metrics are cool; styling a bit off; odd scrolling on the expanded metric
- 2026-08-15 · correction · src l10-2026-08-12-notes — re-attributed from `client` to daniel's own observation: the ask is verbatim his, and the room's scorecard feedback was uniformly positive. Real item, no client pressure, repro still owed

### N29 · Milestones as a two-week reminder (To-Dos tab + L10)
*W3 · shipped · due — · deps — · owner daniel · src l10-2026-08-12 · upd 2026-08-26*

Effort S–M. **Shipped 2026-08-24 (`004f22e`)** — `MILESTONE_REMINDER_DAYS = 14`;
the standalone tab scopes to the viewer when no owner filter is set, the L10
stays team-wide (Jessica's ask) and moved beside the to-dos instead of above
them. Status line was still `not-started` until the 08-26 reconciliation. Live verdict on the milestone surfaces: effective but **too much
information**. daniel, driving the page live: "this is a little bit of a
broken page ... they're just vomit at the top of the to-dos page currently,
so you got to scroll to the bottom" — the milestone block pushes the actual
to-dos below the fold. Joe: "a little overwhelming," and wants the headline
treatment — "just a drop down that showed upcoming milestones in the next
two weeks." New scope:
- **To-Dos tab:** show only milestones **assigned to the viewing user, due
  within the next two weeks** — a reminder, not an inventory. daniel's
  decision, verbatim and unambiguous in the recovered notes, so it stands.
  **Flagged (Pass 20):** Jessica, answering daniel's question in the
  meeting, went further than he did — the personal surface may not need a
  milestone section at all, "on the home screen you already can see the
  milestones under the rocks, so I don't know that they really need to be
  separated on that page." She was speaking about Home, and the two-week
  window may already be the compromise that answers her. Worth one look
  before building, not a blocker.
- **L10 To-Dos segment:** same rule widened to the team — members'
  milestones due within two weeks — and in a **two-column view like the
  normal (standalone) To-Dos page**. Jessica backs the team-wide scope on
  the meeting surface specifically: "in this view I would say it's better
  to see everyone's milestone, so if you know something's coming up for
  someone else you can push them on it if you think they're not ready."
- **Per-team on/off toggle** (Steph, new in Pass 20): in 90, ESD liked
  milestones surfacing as to-dos and leadership disliked it enough to turn
  the feature off, so she asked whether it can be toggled per team. She
  flagged the cost herself — "I don't know if that creates a more
  complicated view." Cheapest form is a team setting defaulting to on, with
  the two-week window making the off case rarer. Decide with daniel.

This supersedes the "all open milestones" scope that PR #34 (merged
2026-08-12, pre-meeting) put in the L10, and narrows the standalone column
shipped in the Aug-12 restyle — so this is a follow-up change to both. The
`isMilestoneHiddenByRock` filter and `MilestoneTodoRow` component stay;
what changes is the window (≤14 days), the owner scoping per surface, and
the L10 adopting the two-column layout (which also revisits N22's layout
question for the in-meeting surface).

**Trail**
- 2026-08-12 · request · src l10-2026-08-12 — To-Dos: own milestones due in 2 weeks as reminder; L10: replicated for the team, two-column like normal view
- 2026-08-15 · client · src l10-2026-08-12-transcript — daniel live: milestone block buries to-dos below the fold ("broken page"); Joe: overwhelming, wants a two-week dropdown like headlines
- 2026-08-15 · client · src l10-2026-08-12-transcript — Jessica: Home already shows milestones under rocks, may not need a separate personal section; but team view should show everyone's
- 2026-08-15 · request · src l10-2026-08-12-transcript — Steph: leadership turned this off in 90, ESD liked it — asks for a per-team toggle
- 2026-08-19 · client · src l10-2026-08-19-it — third corroboration, no scope change: Joe restated the two-week rule to the room ("if it's due in two weeks, it would show up") and Steph accepted it. New detail — her actual complaint is that "you can't see the rock that it's associated with", so the surfaced row should carry its parent rock (display work; N34 owns the row treatment)

### N30 · Demark comments made during live discussion
*W3 · not-started · due — · deps — · owner daniel · src l10-2026-08-12 · upd 2026-08-15*

Effort S–M. When a comment is added to an issue **while that issue is being
discussed in a meeting**, highlight or demark it in the comments section as
a live-discussion note. The L10 already knows which issue is being
discussed (`setDiscussingIssue`), so the write path can stamp the comment
with the meeting id when it matches — the same `source_meeting_id`
attribution pattern G1 wants for recap items; build them on the same field.

**Where this came from, and the design question under it (Pass 20).** The
ask started as Steph describing a workaround: in a real L10 there is a
moderator and a scribe, and the scribe's discussion notes currently go into
the issue **description** — which she dislikes, because the description is
the creator's framing ("here's the description of the issue, here's some
links"), not a running log. She floated "a separate discussion notes field
or something like that." Jessica answered from live use: the comments box
already does this, and it preserves the distinction Steph wants — "that way
you can kind of keep track of what was said before versus what's said now."
Steph confirmed leadership already threads comments pre-discussion. So the
comment stream is the right home and **N30's demarcation is what makes it
usable** — a during-the-meeting comment reads visually as the scribe's
note. Build the stamp first; only add a dedicated field if the demarcation
proves insufficient. Steph is fine either way ("it's fine to put it in the
description, but we do do that a lot").

**Trail**
- 2026-08-12 · request · src l10-2026-08-12 — highlight/demark comments added during live discussion of an issue
- 2026-08-15 · client · src l10-2026-08-12-transcript — origin: Steph wants a discussion-notes home other than the description; Jessica points at comments; demarcation resolves it without a new field

### N31 · Issue-discussion notification — internal, not email
*W3 · not-started · due — · deps — · owner daniel · src l10-2026-08-12 · upd 2026-08-15*

Effort M. Steph wants to know when there's discussion on a particular issue
— her current system distributes that as an **email**. We have freedom to
brainstorm the right distribution; daniel's read, which stands unless the
client pushes back: **an internal (in-app) notification, not email, in the
short term**. This is the first notification feature in the app — keep it
deliberately narrow (a per-issue "new discussion" indicator / notification
surface, likely fed by N30's live-discussion comments) and don't let it
grow into the general notifications platform the client already said is
NOT phase 1 (Pass 11). Design question to settle first: subscribe
(watch-this-issue) vs broadcast-to-owner.

**Owed before design (Pass 20):** Steph took an action item to find out
whether 90's issue-comment emails go to **all participants or only the
issue owner** — that answer settles the subscribe-vs-broadcast question
above, so wait for it. Her stated need is the wider one: "for me it would
be cool to know if there's been discussion on an issue **even if it's not
my issue**." Her stated constraint is equally clear — "we're getting
notified all over the place, there's a lot of noise" — so the bar is that
this replaces email volume rather than adding to it.

**Trail**
- 2026-08-12 · request · src l10-2026-08-12 — Steph: wants to know about discussion on an issue; current system emails it
- 2026-08-12 · decision · src l10-2026-08-12 — daniel: lean internal notification, not email distribution, short term
- 2026-08-15 · followup · src l10-2026-08-12-transcript — Steph to check whether 90 emails issue comments to all participants or the owner only; her answer decides subscribe vs broadcast
- 2026-08-15 · client · src l10-2026-08-12-transcript — Steph wants activity signal on issues that are not hers; explicit noise constraint (bell must replace email, not add to it)

### N32 · Meeting rating stays editable after the meeting ends
*W3 · in-progress · due — · deps — · owner daniel · src l10-2026-08-12-transcript · upd 2026-08-19*

Effort S. **Urgent — queued at position 2 (2026-08-15) and ships with N23's
mini-ship.** Two live-on-prod bugs of the same size, and neither should wait
for the next full ship.

**Client-reported bug, raised twice** — Steph flagged it in the
2026-08-12 L10 and noted "I think this happened last time" too. After the
meeting has concluded and the rating panel has been dismissed, a
participant can still open it and change their vote. Steph: "the meeting
has concluded and I closed the right sidebar, but now I'm still seeing that
I'm in there and now I can change my vote." Joe named the integrity angle
that makes this more than cosmetic: "you get this popup at the end, you
click done, but then you can still change your vote — if Steph was running
the meeting I could say it was a 10, and then once she logs off I could
move it to a one." daniel on the call: "yeah, that's confusing."

Fix is a close boundary, not a UI tweak: once the meeting is concluded the
rating write should be rejected server-side (rules + the write path), not
merely hidden — and the panel should read as final rather than as an open
form. Also settle whether a concluded meeting's ratings stay *visible*
read-only, which is what Steph expected. Check the same boundary for the
other end-of-meeting writes (recap, segment state) while in there.

**Trail**
- 2026-08-15 · client · src l10-2026-08-12-transcript — Steph + Joe: votes remain editable after the meeting concludes and the panel is closed; recurring, not first sighting; tampering scenario named by Joe; daniel acknowledged as a bug
- 2026-08-15 · decision · src session-2026-08-15 — daniel: urgent. Enters `next` at 2, ahead of QW1, and rides N23's mini-ship. Integrity bug on prod, small fix, no reason to hold it
- 2026-08-19 · build · src session-2026-08-19 — lock in `rateMeeting`: after `ended_at`, first write still allowed (recap catch-up), rewrite rejected. Conclude panel is read-only once you have a score (visible, not an open form). Same freeze on notes + attendance writes. Client meeting-doc updates denied after conclude in `firestore.rules`. `lib/l10/ratings.ts` holds the predicate. Needs merge + mini-ship with N23; rules deploy this time.

### N33 · Agenda side panel → modal
*W3 · not-started · due — · deps — · owner daniel · src l10-2026-08-12-transcript · upd 2026-08-15*

Effort S. daniel's own proposal, put to the room at the end of the meeting:
replace the in-meeting right-sidebar agenda / meeting-breakdown with a
standard modal, "like everything else sort of is in the new system." A
consistency argument, and it is the same sidebar N32's rating panel lives
in — sequence them together if both are taken.

Client signal is deliberately weak and should not be read as approval.
Steph: "I feel like I don't pay much attention to that right now" — but
with the caveat that matters, "as we roll it out across the organization
maybe there will be more visibility into that ... IT has been the early
adopters, we've been doing it longer than other people have." So today's
low engagement is an early-adopter artifact, not a verdict on the
surface. Decide on the consistency argument alone; do not cite client
demand for it.

**Trail**
- 2026-08-15 · request · src l10-2026-08-12-transcript — daniel: dislikes the right sidebar, proposes a normal modal; Steph neutral-to-low signal now, expects visibility to rise as the org adopts

### N34 · Separate departmental from individual rocks (Home board sections)
*W3 · shipped · due — · deps — · owner daniel · src l10-2026-08-12-transcript · upd 2026-08-26*

Effort S. **Shipped 2026-08-24 (`004f22e`)** — Home splits into "My Rocks"
and "Departmental Rocks" (`home/page.tsx:543`). Tests caught that the row item
carried no `owner_id`, without which a legacy null owner would have dumped
every rock into one bucket. Status line was still `not-started` until the
08-26 reconciliation. **Re-aimed at our app (Pass 22).** Pass 19/20 recorded this as
Joe critiquing **90** rather than us — "that's a critique I have for 90.
I'd like to know what's departmental and what's not." On 2026-08-19 Cora
made the same complaint about **our Home board**, and specified the fix:
not a badge, but **separate sections**. Reviewing Joe's shared screen:
"it's got all of the rocks but it also includes the two departmental ones
... I like seeing the departmental rocks, but I would like them to be in
their own section, to be like *my rocks* and *the departmental rocks*.
Because at first I was looking at it like, what rocks am I on here?"

So the target is a grouped Home board — "My Rocks" and "Departmental Rocks"
as distinct sections — with the badge treatment as the cheaper fallback on
rows elsewhere (To-Dos, the L10 segments). Second independent witness, aimed
at us rather than at 90, with a concrete layout.

We already carry the data. The Pass 18/19 rock model settled on `owner_id`
(a person, always) plus `rock_type` (individual / team / company), so this
is display work only: a badge or grouping on rock rows and on milestone
rows surfaced elsewhere (To-Dos, Home, the L10 segments) that says which
kind it is. Related but distinct from N4's "Shared with you" label —
that one answers *whose team it came from*, this one answers *what kind of
rock it is*. Both can ride the same row treatment.

**Trail**
- 2026-08-15 · client · src l10-2026-08-12-transcript — Joe: cannot tell departmental from individual rocks in the list; a 90 critique, cheap for us because `rock_type` already exists
- 2026-08-19 · client · src l10-2026-08-19-esd — Cora, on OUR Home board: personal and departmental rocks are intermingled and she couldn't tell which were hers. Asks for separate sections ("my rocks and the departmental rocks"), not a badge. Re-aims the item at our app

### N39 · Headline edit modal vanished when the cursor left the window
*W3 · shipped · due — · deps — · owner daniel · src l10-2026-08-19-it · upd 2026-08-24*

Effort S. **Shipped 2026-08-24 (`64b11d9` + `3ded811`).** Client-reported by
three people in the 8/19 IT L10 while editing a headline mid-meeting. Steph:
"when I move my cursor off of this screen, it drops the focus ... I would
expect the modal to stay up until I close it." Ryan pinned the boundary: "if
you stay over that website, it stays. But if you leave the screen, it's
gone." Joe reproduced it live.

**Not an event handler — a CSS containment bug.** A sweep for
`onMouseLeave` / `onPointerLeave` / `mouseleave` / `focusout` /
`visibilitychange` / window `blur` across `app`, `components` and `lib`
returns **zero hits**, at HEAD and at `98bb30b` (the commit prod was
serving). Nothing in the codebase can close a dialog on pointer exit. What
actually happened: `HeadlineEditButton` rendered the modal **inline**, and
its trigger lives inside the row's action cluster
(`opacity-0 group-hover:opacity-100`, `segment-headlines.tsx:171` /
`headlines/page.tsx:179`). `opacity` applies to the entire rendered subtree
and `position: fixed` does not escape it, so an open dialog was painted at
opacity 0. It never closed and never lost the typed text.

Why Ryan's description was exact: the modal's `fixed inset-0` backdrop is a
DOM *descendant* of the row, and an element is `:hover` when the pointer is
over any descendant — so hovering anywhere in the viewport held the row
hovered and the modal visible, and only leaving the window dropped it.

Fixed by portalling to `document.body` (precedent: `status-popover.tsx`),
which removes the trap structurally rather than patching the instance. **Only
headlines nested a modal inside a faded wrapper** — `rock-row.tsx`,
`issues-list.tsx`, `segment-issues.tsx`, `todo-list-row.tsx`,
`entity-comments.tsx`, `meetings-list.tsx`, `scorecard-grid.tsx` and
`move-term-button.tsx` all put `opacity-0` on the button itself and render
their modals as siblings. No SSR guard needed: `open` starts false and only
a click sets it.

**Trail**
- 2026-08-19 · client · src l10-2026-08-19-it — Steph, Ryan, Joe: editing a headline, the modal disappears when the cursor leaves the browser viewport; expected to persist until closed
- 2026-08-24 · build · src session-2026-08-24 — diagnosed as ancestor `opacity-0`, not a dismissal handler (zero pointer-leave handlers exist); portalled to `<body>`; blast radius confirmed limited to the two headline surfaces

### N40 · Scorecard groups — surfaced, ordered, and grouped in the L10
*W3 · shipped · due — · deps — · owner daniel · src l10-2026-08-19-it · upd 2026-08-24*

Effort S (tab) + decision (L10). Steph asked for scorecard **categories** —
"we have like weekly, and then we have compliance, so John kind of moved the
compliance ones into a separate category ... I don't know that that
functionality exists right now."

**It does.** `scorecard_metrics` carries a `group` field, `GroupCell` is an
inline editor for it, `setMetricGroup` is the server action, and
`scorecard-grid.tsx` renders grouped header rows. Two reasons she did not
find it:
1. **It is called "Section", not "Category"**, and the affordance is a small
   grey "No section" link under the metric name — easy to miss entirely.
2. **The L10 suppresses sections by design.** `scorecard-panel.tsx` forces
   `flatList` whenever a speaking order is present, commented "L10 speaking
   order must not be reshuffled by section groups." She was driving the
   meeting, so she saw a flat list.

So this splits. The **tab half** is naming + discoverability, and is cheap.
The **L10 half** is a real product conflict and needs a call, not a fix: 90
groups by category *in the meeting*; we sort by speaker. Both orderings
cannot hold at once. Options: keep speaker order (status quo), group by
section with speaker order inside each, or make it a per-team preference.

**Also raised in the same segment, now its own item:** the large-number
display problem is **N43**. Joe said on the call it was already being fixed;
daniel confirmed 2026-08-24 that it never landed.

**Unblocked 2026-08-24, and confirmed narrower than written.** Rather than
waiting on view access in 90, daniel **imported Steph's IT team scorecard
into our app**. Her export carries a **`Group Name`** column holding exactly
the categories she described — `Weekly` and `Compliance` (screenshot
confirmed) — and the scorecard importer already maps
`Group Name` / `Group` / `Section` → our `group` field
(`lib/team-import.ts:626`). **So her categories came in with the data and
are already rendering as grouped section rows on the Scorecard tab.** No
data work, no model work.

**Shipped 2026-08-24 (`004f22e` + follow-up).** Both halves:
1. **Naming.** "Section" → **Group** everywhere in the UI, and the unset
   state reads **"+ Group"** in link colour rather than a grey noun that
   looked like a status rather than a control. Landed briefly as "Category"
   before daniel settled on **Group** — which is also what the data field has
   always been called and what ninety's export column says ("Group Name"), so
   UI, schema and source file now use one word.
2. **L10 grouping.** daniel's call: group by group, **speaking order inside
   each one**. They turn out to compose rather than compete —
   rows already arrive sorted (by speaking order in the L10) and bucketing
   preserves that order, so each category renders its own speaking round:
   Weekly in speaker order, then Compliance in speaker order. The forced
   `flatList` for the speaking-order case is gone; an explicit sort, filter
   or search still flattens, because regrouping rows someone deliberately
   re-sorted would bury what they asked for. Grouping logic moved out of the
   grid into `groupMetricsByCategory()` so the ordering contract is pinned by
   tests rather than living in a `useMemo`. Category *editing* stays on the
   Scorecard tab — the L10 already passed `showGroupEditor={false}`.

Related, from the same import: getting other teams' scorecards in needs an
in-app path at all. Scorecard import is still CLI-only — recorded as **N6
finding 7**, not here.

**Groups became a first-class thing (same session).** Free text sorted
alphabetically put Compliance *above* Weekly, which is backwards — Compliance
is a weekly category that must not outrank the ordinary weekly measurables,
and no sort rule derived from the name can express that. So a category is now
something you create, with a **name**, a **period**, and a **position you
choose** (daniel: "we will define custom"). New `scorecard_groups` collection
(team-scoped rules alongside `scorecard_metrics`), a **Categories** modal on
the Scorecard tab to add / reorder / delete, and metrics still reference a
category by name — which is what the importer already writes and the grid
already reads, so nothing had to migrate.

Decisions worth keeping:
- **"Weekly" stays a real category** rather than being dissolved into
  "ungrouped weekly metrics" (daniel's call). Uncategorised measurables still
  render above every category.
- **Assigning a metric to a category moves it into that category's period.** A
  weekly measurable dropped into a monthly category would otherwise show under
  neither tab.
- **Import creates categories in first-seen order**, so Steph's
  Weekly-then-Compliance file produces exactly that order with nobody setting
  it. Re-import **never** rewrites `sort_order` or `interval` on a category
  that already exists — `Writer.set` merges, so without that guard a
  re-import would silently undo a hand-reordered list.
- **Deleting a category keeps its measurables**, un-assigned.
- **Unmanaged labels still render**, after the defined categories, so a
  hand-typed name never disappears.

**Trail**
- 2026-08-19 · client · src l10-2026-08-19-it — Steph: 90 has scorecard categories (weekly / compliance), used by leadership too; believes ours has none. Steph + Joe agree to grant daniel view access to the IT team scorecard in 90
- 2026-08-24 · finding · src session-2026-08-24 — the feature exists as `group` / "Section"; invisible in the L10 because `flatList` is forced whenever a speaking order is present. Tab half = naming; L10 half = speaker-order vs category-order conflict, needs a decision
- 2026-08-24 · unblocked · src session-2026-08-24 — daniel imported Steph's IT 90 scorecard instead of taking view access; importer already maps `Group Name`/`Group`/`Section` → `group`
- 2026-08-24 · confirmed · src session-2026-08-24 — ninety's export carries `Group Name` = Weekly / Compliance (screenshot). Categories arrived with the import and already group on the Scorecard tab; remaining scope is the rename plus the L10 speaker-order-vs-category decision
- 2026-08-24 · decision · src session-2026-08-24 — daniel: build category grouping in the L10 too — group by category, then speaker order within each category. Not an either/or after all
- 2026-08-24 · build · src session-2026-08-24 — shipped: "Section" → "Category" + visible affordance; `flatList` no longer forced by speaking order; `groupMetricsByCategory()` extracted and tested
- 2026-08-24 · decision · src session-2026-08-24 — daniel: Compliance below Weekly; groups assignable by name AND period; you can create a group as well as a measurable; a weekly group does not take precedence over ordinary weekly measurables. Ordering is custom, not derived
- 2026-08-24 · build · src session-2026-08-24 — `scorecard_groups` collection + rules, Groups modal (add / reorder / delete), importer creates groups in first-seen order and never clobbers an existing one's position, assignment aligns the metric's period
- 2026-08-24 · decision · src session-2026-08-24 — daniel: call it **Group**, not Category. Matches the `group` field and ninety's "Group Name" column — one word across UI, schema and source file
- 2026-08-26 · decision · src session-2026-08-26 — **Group confirmed** after the naming was re-raised: Steph says "category" out loud, but ninety's own export column says "Group Name", so Group keeps UI, schema and source file on one word. Closed, not revisited
- 2026-08-26 · build · src session-2026-08-26 — group break restyled: Weekly and Compliance now read as separate blocks (gap row + heavy top rule + banded header) instead of one tinted row. Kept inside a single `<table>` on purpose — separate tables would size their week columns independently and fall out of alignment across the horizontal scroll

### N41 · Room-wide vote tally on the Issues segment
*W3 · shipped · due — · deps — · owner daniel · src l10-2026-08-19-it · upd 2026-08-24*

Effort S. **Shipped 2026-08-24 (`64b11d9`).** Steph, mid-vote: "we always
ask everyone if they voted ... it might be cool to just tally up, like if
the available votes have been exhausted or not. That would actually be kind
of a nice feature, because then you don't have to confirm that everybody has
submitted their three votes."

Cheaper than it looks: no client subscribes to other people's `issue_votes`,
but the team total is already denormalized onto each issue, so **cast** is a
sum over issues already on screen. **Available** counts only people in the
room — absentees never spend theirs, and an unreachable denominator would
defeat the chip. Reads the live `absent_user_ids` off the meeting-doc
subscription the discuss pointer already uses, so marking someone absent
mid-meeting re-bases it immediately. `teamVoteTally()` in `lib/issues.ts`
(5 tests), `TeamVoteTallyBadge` beside the existing personal credits chip.

**Trail**
- 2026-08-19 · request · src l10-2026-08-19-it — Steph: show total votes available vs used so the room can see when everyone has voted, without asking round the table
- 2026-08-24 · build · src session-2026-08-24 — shipped; computed from denormalized `issues.votes` against present members x `MAX_VOTES_PER_TEAM`

### N42 · Speaker round wraps instead of dead-ending
*W3 · shipped · due — · deps — · owner daniel · src l10-2026-08-19-it · upd 2026-08-24*

Effort S. **Shipped 2026-08-24 (`64b11d9` + `3ded811`).** Ryan: "I
definitely like the speakers being on every page ... but maybe we allow it
to wrap. So you get to the last speaker, you click next, and it goes back to
the beginning. Sometimes we go multiple rounds, and that's much easier than
clicking previous a bunch of times to get to the first speaker."

**Scope reversed 2026-08-26 (daniel): wrap everywhere BUT Segue.** Pass 22
had gone the other way — one behaviour across the board, Segue included, on
consistency grounds. That is retired. Segue is a once-around stage: everyone
shares, then the round is done, and wrapping there erases the only signal
that the room has finished going round. Steph said as much on 8/19 ("for
headlines or for segue, we would only go through once, but ... in discussion
for like an issue, we might go around twice"), and Ryan's ask never mentioned
Segue either way — the exception was in daniel's notes from the start.

Implementation: `stepSpeakerIndex` takes a `wrap` flag (default true) and
returns `from` unchanged at the edges when it is false. New `canStepSpeaker`
mirrors it so a control is disabled exactly when pressing it would do
nothing — at the ends of Segue's round, or when nobody else is in the room.
`segment-segue.tsx` passes `wrap: false`; `speaking-order-rail.tsx` takes
`wrap` from the **group's** active stage (`activeSegment !== "segue"`), not
the viewer's local peek, because those buttons drive the room. Both
directions honour it: Prev is inert at the first speaker on Segue for the
same reason Next is inert at the last.

**Deliberately not built:** Joe's follow-on idea that next-past-last should
also *advance the stage* — wrapping and auto-advance are mutually exclusive,
and stage transport stays on its own buttons.

**Trail**
- 2026-08-19 · request · src l10-2026-08-19-it — Ryan: wrap the speaker list back to the first speaker at the end of the round; Joe agrees, flags that next-past-last currently should trigger stage advance
- 2026-08-19 · client · src l10-2026-08-19-esd — Steph on round shape: "for headlines or for segue, we would only go through once, but ... in discussion for like an issue, we might go around twice"
- 2026-08-24 · decision · src session-2026-08-24 — daniel: wrap everywhere including Segue, one behaviour across the board; per-stage exception dropped. Stage advance stays separate from speaker wrap
- 2026-08-26 · decision · src session-2026-08-26 — **reversed**: wrap everywhere BUT Segue. Segue is once-around and its round-done marker is the point; the 08-24 consistency argument loses to it. Never shipped to prod under the 08-24 reading, so no client ever saw the wrapping Segue
- 2026-08-26 · build · src session-2026-08-26 — `wrap` flag + `canStepSpeaker` in the pure module; Segue passes false, the rail derives it from the group's active stage. 437 tests pass, tsc + build clean

### N43 · Scorecard large numbers render badly
*W3 · shipped · due — · deps — · owner daniel · src l10-2026-08-19-it · upd 2026-08-26*

Effort S. **Shipped 2026-08-24 (`004f22e`)** — values above 100k render
compactly ($2.3M), exact figure moves to the tooltip + aria-label, editing
still works on the raw number; percent / yes-no / time never abbreviate.
Status line was still `not-started` until the 08-26 reconciliation. **Confirmed still live 2026-08-24** — Joe told the room on 8/19
that this was already reported and being fixed ("he messaged me about two
hours ago and said that was the case and that he was going to get it
fixed"); daniel confirms it never landed. Client-visible on the scorecard
today.

Steph, on a `$2.3M`-scale cell: "the larger numbers are a little a little
wonky from a display." She had also zoomed the browser in to read the grid
("I increased the percentage so that I could see it better because it's just
pretty tiny"), which compounds it — so there are arguably two complaints
here: big values render badly, and the default type size is small.

Mechanism: `formatValue()` (`lib/scorecard.ts:146`) renders currency at full
precision — `2300000` becomes `$2,300,000`, ten characters — into cells
fixed at `min-w-[4.5rem]` (`value-cell.tsx:15,103`). At the grid's type size
that overflows its column, and since the whole grid is `overflow-x-auto`
(`scorecard-grid.tsx:476`) the result is a horizontally scrolling table
rather than a clipped cell — which matches Steph having to "scroll the
metric oddly" (and is likely the same underlying complaint as **N28**, which
Pass 20 re-attributed to daniel with no client witness; N43 is the witnessed
version).

Likely fix: compact notation above some magnitude —
`Intl.NumberFormat(undefined, { notation: "compact" })` giving `$2.3M` —
with the exact value kept in a `title` and in edit mode, so nothing is lost.
`formatValue` is pure and already covered by `lib/scorecard.test.ts`, so the
change is testable in isolation. Decide the threshold and whether percent /
plain units get the same treatment. Worth doing alongside **N28** rather
than separately: same surface, same scroll symptom.

**Now checkable against real data:** Steph's IT team scorecard was imported
2026-08-24 (see N40), so the actual value magnitudes are in the app rather
than hypothetical.

**Trail**
- 2026-08-19 · client · src l10-2026-08-19-it — Steph: larger numbers display wonky on the scorecard; had zoomed in because default type is small. Joe: already reported, believed in flight
- 2026-08-24 · correction · src session-2026-08-24 — daniel: the fix never landed. Recorded as its own item rather than folded into N28, which has no client witness

### N44 · Screen-review polish batch (2026-08-26)

*W3 · shipped · due — · deps — · owner daniel · src session-2026-08-26 · upd 2026-08-26*

Effort S. Four fixes from daniel reading real screens rather than a
transcript — no client ask behind them, all shipped the same session.

1. **To-Dos: the "DONE" divider goes.** An owner's completed rows sat under a
   grey uppercase `DONE` band while every row already carries a green check
   and the owner header already counts `1 done`. Three signals for one fact;
   the band was the weakest and the loudest.
2. **Headlines: rounded top corners were being painted over.** The owner-group
   list is `rounded-xl border`, but its first child is a header with its own
   `bg-zinc-50` — a square background over a rounded parent, which reads as a
   missing border rather than a covered corner. `overflow-hidden` on the
   container. *Same shape of bug as N39* — a child ignoring the box its parent
   drew — and worth checking whenever a tinted header leads a rounded list.
3. **Scorecard: a real break between groups.** Weekly → Compliance was one
   lightly tinted row, which does not read as a section change. Now a gap row,
   a heavy top rule and a banded header. **Kept inside one `<table>`
   deliberately:** the literal ask was "split the table", but separate tables
   size their week columns independently and would drift out of alignment
   across the shared horizontal scroll, so the split is visual and the grid
   stays one aligned surface.
4. **Import page widened** `max-w-2xl` → `max-w-6xl`, preview box to `32rem`
   tall, title column to `40rem`. The dry-run preview (N6) is a four-column
   table of real rows and was being read through a 672px straw.

**Trail**
- 2026-08-26 · request · src session-2026-08-26 — daniel, reviewing live screens: drop the redundant Done line; headlines upper rounded border not rendering; cleaner group break between Weekly and Compliance; widen the import modal for preview viewability
- 2026-08-26 · build · src session-2026-08-26 — all four shipped; 437 tests pass, tsc + next build clean, lint unchanged at its 17-finding baseline (none in touched files)

### N6 · Better import functionality
*W3 · in-progress · due — · deps — · owner daniel · src roadmap-prior#pass-18 · upd 2026-08-24*

Effort M. Beyond the current CSV/xlsx import: clearer mapping, validation,
dry-run, re-import, error report. Attachments are out of import scope
(decided with N3/N10). Current import docs: `docs/CSV_IMPORT.md`. Note
from the audit era: import payloads now write explicit `archived_at: null`
(PR #19), so re-imports can't un-archive — preserve that in any rework.
The Pass 11 people CSV (directory) moved to N35 — this item is entity
import (rocks / milestones / todos / issues / headlines).

**Live findings 2026-08-18 (onboarding import). Verdict: decent, not
done.** In-app import exists at `/teams/[teamId]/import` for rocks /
todos / issues only — headlines was added 2026-08-19 (`2de1be1`, finding 5);
**scorecard is still missing** (finding 7).

1. **Milestone import is broken when importing rocks.** Ninety ships
   rocks + milestones as one two-sheet `.xlsx`. The CLI accepts both
   (`--rocks` + `--milestones` on the same file). The in-app Rocks kind
   never sets `inputs.milestones`, so the milestone sheet is silently
   dropped. Fix: when kind is rocks and the workbook has a milestone
   sheet (or add an explicit Milestones kind), run `importMilestones`
   in the same pass, linking by rock title the way the CLI already does.
2. **Preview does not show anything relevant.** This is Jessica's
   existing dry-run/mapping ask (Pass 18 + the 08-12 API/upload
   follow-up), confirmed live. Today's Preview prints filename, row
   count, write counts, skipped, and a collapsed header list — not a
   row-level view of what will land. Dry-run has to preview the payload,
   not the file metadata.
3. **Team filter / target is a typed box, pre-filled "Enterprise
   Systems & Data".** Replace with: default the department/team-column
   filter to the **active team** (the one on the URL), and a **team
   dropdown** to import into another team. No more free-text Filter
   by Department.
4. **Unmatched owner (fired employee came up today).** Do not skip the
   row and do not create a placeholder member. Import the item with
   **No Owner** (`owner_id: null`) and append the unmatched name to the
   **description** so the history is visible. Distinct from the
   existing skip / `--no-create-owners` / fallback-owner paths.
5. **Headlines import** is still CLI-only (`WebImportKind` is rocks /
   todos / issues). Add Headlines as an in-app kind.
6. **Archived-data import — confirm the contract.** `includeArchived`
   already exists as a checkbox (off by default; CLI `--include-archived`).
   Client asked for confirmation of what archived rows do. State it on
   the page (skipped unless checked; `archived_at` stamped; re-import
   cannot un-archive) rather than inventing a second path.
7. **Scorecard import is still CLI-only** (new 2026-08-24, daniel —
   raised while importing Steph's IT scorecard for N40). Same shape as
   finding 5, one kind later: the *parser* fully supports scorecard
   (`lib/team-import.ts` writes `scorecard_metrics` **and** back-fills
   `scorecard_entries` from the week columns, and maps
   `Group Name` / `Group` / `Section` → `group`), and `ImportKind`
   includes `"scorecard"` — but `WebImportKind` is
   `rocks | todos | issues | headlines`, so the Import page never offers
   it. Add it to `WebImportKind`, `KINDS` and `EXPECTED_HEADERS`; the
   team dropdown, preview and owner-alias machinery all come for free.
   **Two wrinkles to settle while in there:**
   - *Preview shape.* Scorecard is the only kind that writes two
     collections. A row-level preview (finding 2) should say metrics
     **and** week-entries, or the write count will read as wrong.
   - *`interval` is hardcoded `"weekly"` on import.* Every imported
     metric lands weekly regardless of what it is, so monthly/quarterly
     measurables import into the wrong interval tab — and Steph's
     Compliance group is exactly the kind of thing that may not be
     weekly. Either read an interval column or state the limitation on
     the page.

**Trail**
- 2026-07-13 · note · src roadmap-prior#pass-11 — CSV user import named in Pass 11 directory/admin asks
- 2026-08-10 · note · src roadmap-prior#pass-18 — captured as next-work item 6; attachments excluded
- 2026-08-12 · followup · src l10-2026-08-12 — daniel to follow up with Jessica on API documentation and how she'd like to upload data; her answer shapes whether this item stays CSV-first or grows an API surface
- 2026-08-18 · client · src onboarding-2026-08-18 — import "decent"; milestone sheet dropped on rocks upload; preview not useful (Jessica's dry-run ask, live); team filter should be dropdowns; unmatched owner → No Owner + name in description; headlines kind missing; archived-import contract to confirm
- 2026-08-18 · decision · src onboarding-2026-08-18 — people/directory CSV is N35, not this item
- 2026-08-24 · request · src session-2026-08-24 — daniel: need an in-app Import path for **scorecard** data so other teams can be onboarded without the CLI. Parser already supports it; only `WebImportKind` gates it. Flagged alongside: two-collection preview, and the hardcoded `interval: "weekly"`

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
*W3 · shipped · due — · deps F5 · owner daniel · src roadmap-prior#pass-11 · upd 2026-08-15*

**Core shipped PR #27** (`feature/agenda`): `lib/l10/agenda.ts` (+190 lines
of tests) with two built-in presets (**Level 10**, **L10 Condensed**),
per-team custom agendas in Firestore with an editor
(`agendas.tsx` / `agenda-editor.tsx` / `agendas-panel.tsx`), agenda
**selected at meeting start** (`start-meeting-picker`), and a
`MeetingAgendaSnapshot` stamped onto the meeting so a later agenda edit
cannot rewrite history. Rules updated. This closes the client's stated ask
(≥4 formats via the editor + pick-at-start, Jenna #8 / Stephanie Pass 13
#8). **Added 2026-08-15 (transcript backup):** Steph, on where templates should
live, asked for **default agendas that ship with every new team** — "maybe
there's some default agendas that come with every basic team, like an L10,
and then they can create other ones that are associated with the team." The
two built-in presets satisfy the first half; what is unbuilt is attaching
them to a team at creation so a new team is usable before anyone opens the
editor. Small, and it lands with N1's new-team flow. Her reason for
team-scoping is worth keeping: "I wouldn't want to associate it with a
person, because if that person leaves."

**Verified not built** — reopen as P2-1b only if asked: scheduled /
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

**Post-ship fix (2026-08-12):** the shipped code left three `TS2367`
always-true comparisons against `"done"` in `meeting-rail.tsx` /
`meetings/[meetingId]/page.tsx`. `AGENDA_TOOL_TYPES` deliberately excludes
`"done"`, and both `activeSegment` / `viewSegment` route it away in their
IIFEs, so assignment narrowing made every downstream `!== "done"` guard dead
code. Behaviour was correct but **`next build` could not type-check**, so the
branch was unbuildable. Fixed by encoding the invariant in the types —
`activeSegment`, `viewSegment`, `storedSegment`, the `MeetingRail`
`viewSegment` / `initialSegment` props and the `SegmentContent` `segment`
prop are now `AgendaToolType` rather than `Segment` — and dropping the three
dead guards plus one now-redundant `as` cast. The legacy stuck-meeting
handling (stored `"done"` with no `ended_at`) is untouched: it still lives in
the IIFEs, which is the only place it ever did the work. Live meeting,
concluded meeting and `?view=` peek all re-verified in the sandbox.

**Trail**
- 2026-07-13 · note · src roadmap-prior#pass-11 — full scope captured from the ninety.io config doc; flagged biggest single build item
- 2026-07-29 · transcript · src roadmap-prior#pass-13 — Stephanie re-confirmed flexible templates in live use
- 2026-07-30 · transcript · src tracker-2026-08-03#8 — Jenna: ≥4 agenda formats now, select agenda at meeting start
- 2026-08-12 · fix · src session — 3 dead `!== "done"` comparisons broke `next build` type-check; segments retyped to `AgendaToolType` so the "done is never a viewable stage" invariant is compiler-enforced

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
*W3 · shipped · due — · deps F5 · owner daniel · src tracker-2026-08-03#15 · upd 2026-08-12*

**Shipped PR #29** (`feature/rich-text`), merged 2026-08-12. Sandbox-proven;
**not on prod** — gated on F5. Chosen shape: a **constrained markdown
subset stored in the existing plain-string field** — bold, italic, bullets,
numbered lists, `[label](url)` and bare URLs — not an HTML editor. That
choice is the point: descriptions stay one plain string, so there is **no
migration, no second format to read, and nothing downstream (BigQuery batch,
Google Tasks notes, CSV export) has to learn HTML**, and the renderer keeps
the React-element property the 2026-08-04 audit relied on — no
`dangerouslySetInnerHTML` anywhere, so no HTML sink to sanitize.

Files: `lib/rich-text.ts` (parser + `safeHref` + `richTextToPlain`, 47
tests), `lib/rich-text-toolbar.ts` (caret transforms, 19 tests),
`components/rich-text.tsx` (renderer, server- and client-safe),
`components/rich-text-editor.tsx` (toolbar + ⌘B/⌘I/⌘K + Preview; works
controlled for modals and uncontrolled for the server-action form).

Wired on all four entity families — **headlines** (tab + edit modal + inline
add form + L10 segment), **issue** descriptions (form + detail modal),
**rock** descriptions (modal + card row + detail modal), **to-do**
descriptions (add modal + edit drawer + list row). L10 segments inherit it
by delegating to the same row/modal components. `href` is allowlisted to
`https?://` / `mailto:` — a `javascript:` or quote-break-out target renders
as literal text (verified by server-render). Google Tasks notes are
flattened via `richTextToPlain` so `**bold**` never reaches an owner's task
list. Marker-free text renders byte-identical markup to before.

**Verified in the running app 2026-08-12** (sandbox DB, real Google sign-in):
created + persisted + re-rendered a headline, an issue and a rock; the
uncontrolled add-form clears both fields on submit; clicking a field label
focuses the box instead of firing Bold; `javascript:` targets render as
literal text in a real browser; the L10 Headlines segment and the `?view=`
peek path both render markup. **Bonus found:** Stephanie's existing
"Weekly Leadership updates" headline already contained `- ` bullets and a
bare Sheets URL, so pre-existing client content renders as real lists and
live links with no migration.

Running it caught three defects unit tests could not: the bullet/number
button was a **no-op on an empty line** (a blank line counted as
"already marked", so the toggle stripped instead of inserted); a **no-op
transform never returned focus** to the textarea (the effect keyed on
`[text]`, so an unchanged value meant no re-render, no effect, and the next
keystrokes went nowhere); and the **headline modal was far too small** for
the volume the client writes (`max-w-lg` + 4 rows → `max-w-4xl` + 16 rows,
with the footer pinned so Save can't scroll out of reach). All three fixed,
first two with regression tests.

**Comments unified 2026-08-12.** The links-only `linkify` in
`entity-comments.tsx` (Pass 16 P2-5) is **deleted** — comments now use the
same `RichText` renderer and `RichTextEditor` composer as every description
field, so there is one markup path in the app rather than two. The editor
gained an `onKeyDown` passthrough so the composer keeps ⌘/Ctrl+Enter-to-post
alongside ⌘B/I/K. Verified in the app: a comment with bold, bullets and a
link posted via ⌘Enter, rendered correctly, and a `javascript:` target stayed
literal text.

Still plain text by choice: rock status notes (`comment`), meeting notes and
L10 rating notes. These never had a second renderer, so they are scope, not
drift — say the word and they are a small follow-up.
No prod exposure until F5. Related to N10 (links on entities) — one write
path now, so keep it that way.

**Trail**
- 2026-08-03 · transcript · src tracker-2026-08-03#15 — Steph: hyperlinks + rich text in headlines
- 2026-08-04 · note · src audit-2026-08-04#verified-sound — existing linkify verified safe (React elements, https-only)
- 2026-08-11 · decision · src session — markdown subset in the existing string field over a Tiptap/HTML editor: no migration, no sanitizer, no dual-format read path, and downstream consumers keep plain text
- 2026-08-11 · build · src session — parser + toolbar + renderer + editor built and wired across headlines/issues/rocks/todos; 66 new unit tests
- 2026-08-12 · verify · src session — driven in the running app against the sandbox DB; 3 defects found and fixed (empty-line list button, focus lost on no-op toolbar click, undersized headline modal); 68 new unit tests, 317 total green; full `next build` now passes
- 2026-08-12 · cleanup · src session — comments folded onto the shared renderer; P2-5 `linkify` deleted, so one markup path remains; stored bodies arrive CRLF from the browser, now covered by a parser test

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
- 2026-08-15 · followup · src l10-2026-08-12-transcript — Joe owns a dark-mode sweep ("if you see anything super wrong with dark mode"); he is the team's dark-mode user, Jessica uses it personally but not for work. No defect reported yet — this is a request for one
- 2026-08-15 · client · src l10-2026-08-12-transcript — Joe wants the issue owner's photo or initials on the issue row; daniel: profile photos are in flight but not on prod. Steph: "that's low priority"

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
*W4 · in-progress · due — · deps — · owner daniel · src roadmap-prior#pass-13 · upd 2026-08-18*

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
- 2026-08-18 · note · src onboarding-2026-08-18 — leavers are N38 (deactivate), not Auth-delete. P1-2 still owns allowlist + membership ops; it does not grow a deactivate UI

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
| Leadership team to be created (company rocks live there) | N4 | 2026-08-18 |

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
- 2026-08-12 · N13 · closed — personal Home shipped inside PR #28 (`lib/home-board.ts` filters to the viewer's own to-dos/rocks/milestones), answering Cora's "Home is a dump of everyone's items"; was folded into N4 on 08-10 and is now delivered rather than pending
- 2026-08-12 · P3-2 · closed — rich text + links shipped (PR #29) across headlines / issues / rocks / to-dos **and** comments; the P2-5 links-only `linkify` deleted so one markup path remains; stored in the existing plain-string field, so no migration and nothing downstream learns HTML; awaits F5 for `verified`
- 2026-08-12 · Q-index · answered — PR #28's `shared_team_ids array-contains` query needs no composite index (equality-only, served by merged single-field indexes) and PR #28 changed neither `firestore.rules` nor `firestore.indexes.json`; F5 carries no extra deploy step for it
- 2026-08-11 · Q-queues · answered — three parallel queues (root front matter W2-only, agent-local P0–P3 aid, docs/ROADMAP.md numbered lists) consolidated into one cross-workstream `queue.next`; docs/ROADMAP.md banner-superseded; `queue.now` N1 → F4 because N1 is gated on Steph's calendar and a client-gated `now` stalls the queue
- 2026-08-24 · N39 · closed — headline edit modal "disappearing" was an ancestor `opacity-0` on the hover action cluster, not a dismissal handler (the repo has none); portalled to `<body>` (`3ded811`). Only headlines nested a modal that way
- 2026-08-24 · N41 · closed — room-wide vote tally shipped: `teamVoteTally()` + `TeamVoteTallyBadge`, computed from denormalized `issues.votes` against present members, live off the meeting doc (`64b11d9`)
- 2026-08-24 · N42 · closed — speaker round now cycles on every stage including Segue; `stepSpeakerIndex` always wraps, end-guards removed from the rail and Segue. Old inert-at-the-ends contract retired (`3ded811`)
- 2026-08-24 · N26 · closed — both halves shipped: collapse `0f5c7a1`, per-team check-off `3ded811`. The Pass 19 "per-team or per-user — decide" question was moot: cascading headlines are already one doc per team, so it was a guard to drop. **Monday sweep change needs a Cloud Function deploy**
- 2026-08-24 · N40 · closed — scorecard **groups** shipped: renamed from "Section" (via a short-lived "Category"), affordance surfaced, groups became real docs with a period and a chosen order, and the L10 groups with speaking order preserved inside each (they compose — bucketing keeps the caller's sort). Group editing stays on the tab
- 2026-08-24 · Q-scorecard-l10-order · answered — category grouping vs speaking order in the L10 is not an either/or: group by category, speaker order within. Retires the "L10 speaking order must not be reshuffled by section groups" assumption
- 2026-08-24 · Q-scorecard-fix · answered — the scorecard large-number fix Joe reported as in flight on 8/19 never landed (daniel); recorded as N43 rather than assumed closed
- 2026-08-24 · Q-scorecard-categories · answered — scorecard categories already exist as the `group` / "Section" field with grouped rows; invisible in the L10 because `flatList` is forced whenever a speaking order is present. Remaining work is naming + the speaker-order-vs-category decision → N40
- 2026-08-18 · N1 · in-progress — Steph onboarding walkthrough ran; new-team solid, import decent, add-members not. Leaves `awaiting`. Leftover: admin sees all teams in the sidebar dropdown before P2-7 → `verified`
- 2026-08-26 · N29 · closed — reconciliation: two-week milestone window shipped 2026-08-24 (`004f22e`); status line had read `not-started` for two days
- 2026-08-26 · N34 · closed — reconciliation: Home My/Departmental rocks split shipped 2026-08-24 (`004f22e`); same stale-status cause as N29
- 2026-08-26 · N43 · closed — reconciliation: compact large numbers shipped 2026-08-24 (`004f22e`); same stale-status cause as N29
- 2026-08-26 · Q-segue-wrap · answered — the speaker round wraps on every stage **except Segue**. Reverses the 2026-08-24 wrap-everywhere call: Segue is once-around and its round-done marker is the point. Never reached prod under the old reading
- 2026-08-26 · Q-group-naming · answered — the scorecard bucket stays **Group**. Steph says "category" out loud, ninety's export column says "Group Name"; one word across UI, schema and source file wins the tie
- 2026-08-26 · N44 · closed — screen-review polish batch: Done-divider drop, headlines rounded-corner clip, scorecard group break, import page widened

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
| l10-2026-08-19-it | (Gemini notes + transcript, client-held — not a repo artifact) | IT Systems & Security L10, 2026-08-19; anchors are its transcript timestamps. N26 / N39 / N40 / N41 / N42 / N29 |
| l10-2026-08-19-esd | (Gemini notes + transcript, client-held — not a repo artifact) | Enterprise Systems & Data L10, 2026-08-19; anchors are its transcript timestamps. N26 / N34 / N42 |
| onboarding-2026-08-18 | (session notes — not a repo artifact) | Steph new-team + import walkthrough 2026-08-18; N1 / N4 / N6 / N35 / N38 |
| iam-request | docs/HPB_IAM_REQUEST.md | IAM ask to HPB's GCP admin (2026-07-27) |

`src pr#NN` refs resolve to pull requests on the project's GitHub origin
(`mcgareyconsulting`); the Bitbucket move (N19) will change that home.
