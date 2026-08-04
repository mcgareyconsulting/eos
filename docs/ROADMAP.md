# EOS Platform — Feature & Infrastructure Roadmap

> **Status:** Planning notes only. Nothing here is scheduled or implemented yet.
> This document tracks client requests as they come in. It is captured in
> stages — each pass adds context. We'll scope and roll features later.

**Client:** High Plains Bank (HPB)
**Last updated:** 2026-08-04 — _Pass 17 in progress — Session D cleanup (`feature/p3-roadmap`)_

---

## Infrastructure

### Pass 10 (2026-07-01) — deployment target + scope decisions

- **Runs fully in the client's GCP org.** No Vercel anywhere (the Vercel demo
  retires at cutover — rotate the service-account key stored in its env vars).
  Web app infra is created in HPB's GCP project; consultant access via
  client-granted IAM, replacing the hardcoded break-glass gmail in
  `firestore.rules` (retirement plan required — a personal gmail with full
  admin will not survive a bank security review).
- **BigQuery promoted from deferred to foundation-tier data target.** The
  client is mid-migration of core banking data from **Jack Henry → BigQuery**;
  EOS is one more source feeding that warehouse. Firestore stays the live/
  operational layer (realtime L10 voting); the nightly batch + audit-log
  design below stands.
- **Gemini assistant pulled from the app** (chat panel, voice-create action,
  parser). AI features are deferred; if revived, they return as **Vertex AI
  inside the client's GCP perimeter**, never the key-based AI Studio API.
  The old `GEMINI_API_KEY` must be revoked in AI Studio.
- **Requirements stack pending from client.** Assume current app ≈75% of
  final functionality. Until requirements + data-compliance conventions
  arrive, work = foundation lockdown (security, storage stack, deploy
  scaffolding) — not new features.
- **Security levers menu (client-facing, ballpark $/mo, verify before
  quoting):** Tier 0 free/included — least-privilege SAs with zero exported
  keys, Secret Manager, default-deny rules, domain-restricted auth, audit
  log, Cloud Audit Logs, org policy banning SA key export, SCC Standard.
  Tier 1 (~$40–75/mo total) — Cloud Armor WAF, CMEK on Firestore/BQ, Firestore
  PITR, Data Access audit logs, LB + IAP. Tier 2 (quote on request) — VPC-SC
  perimeter ($0 direct, real ops cost), SCC Premium, Access Transparency,
  Assured Workloads (likely client-owned org-level products).

### Keep data live on Firebase Firestore
- Firestore remains the **system of record for live, real-time data** — the
  back-and-forth between users stays here. No change to the live data layer.

### Live data must flow seamlessly in and out of meeting
- Updates to **rocks, milestones, to-dos, issues, etc.** must **flow live both
  in and out of the meeting context.**
- Example: a user updates an issue **while in a meeting**; when they open their
  **Issues tab outside the meeting**, the update is already reflected there.
- Goal: make the data feel **as live as possible** everywhere — not just on the
  live voting features.
- Today's live behavior (real-time voting) should **extend to all updates** of
  rocks / issues / to-dos / milestones / etc.

### Bleed all data down into BigQuery
- Every Firestore data object needs to **flow down into BigQuery**.
- Purpose: **consolidate all of the client's data** into a single analytics
  warehouse alongside their other sources.
- All app data should **trickle down (as relevant) into BigQuery.**

### Why Firestore now — and the open architecture question
- The **current MVP is on Firebase Firestore** for **very quick up/down latency**
  on the **live voting** features.
- We want that **"live field"** to extend to all entity updates (rocks, issues,
  to-dos, milestones, etc.), and then have that data **trickle down to BigQuery**
  as relevant.
- **Open architectural idea:** if we can create that live field effectively, we
  may want to **step around Firestore and write straight into BigQuery** — and
  adjust the infrastructure accordingly. This requires **tuning how we handle
  data flow.**
- _Open questions captured separately below — to be resolved before scoping the
  data layer._

#### Recommendation (engineering)
- **Keep Firestore as the live source of truth; feed BigQuery downstream.**
  Do **not** step around Firestore into BigQuery for the live field. BigQuery is
  an OLAP warehouse: streaming inserts land in a buffer, queries are billed and
  take seconds, and there is **no real-time listener/push model**. Making BQ the
  live layer would **regress** the live feel, not improve it.
- **The live "feel" and the infra cost are two different dials:**
  - **Live UX is essentially free on Firestore.** Making rocks/issues/to-dos/
    milestones live both in and out of meeting is the **default behavior of
    Firestore `onSnapshot` listeners** — the same mechanism the live voting
    already uses. Writes propagate **sub-second** to every subscribed client
    with no separate real-time infra to build. Marginal cost is per-doc reads +
    concurrent connections — trivial at this client's scale (tens of users).
    → **Recommendation: real-time (sub-second) everywhere, via Firestore
    listeners.**
  - **Cost lives on the BigQuery path, not the live path.** Streaming-vs-batch
    only bites here, and analytics rarely needs sub-second freshness, so BQ can
    run cheaper (batch / low-frequency streaming) **without** affecting live UX.
    → There is **no meaningful inflection point on the live-UX side**; the dial
    to tune for cost is **BQ freshness**, a separate decision.
- **Prefer a managed Firestore→BigQuery stream over app-level dual-write.**
  Dual-writing from the app risks Firestore and BQ diverging on partial failure.
  A managed pipe (official Firestore→BigQuery extension / change streams) keeps
  Firestore authoritative and BQ eventually-consistent.

#### Chosen direction — nightly batch worker (DECIDED)
**Firestore owns the live + meeting-doc-heavy layer; BigQuery is the
non-real-time consolidation warehouse, fed by a scheduled batch worker.**

Rationale: EOS data is **meeting-cadence** (weekly L10s, weekly scorecard
numbers, quarterly rocks). No analytics question needs sub-day freshness, so
streaming infra buys nothing here. Scheduled batch is the cheap, simple,
correct choice.

Design decisions:
- **Run cadence: nightly.** Barely more cost than weekly, keeps each batch tiny,
  and gives day-resolution if ever wanted. **Decouple run cadence from
  analytical grain** — the worker can run nightly even though analytics mostly
  cares weekly.
- **Date-partitioned snapshots, not overwrite.** Each run **appends** the
  current state of each collection tagged with a `snapshot_date` partition
  column (rather than truncate-and-reload). EOS analytics is inherently
  historical (trend lines, quarter-over-quarter), so the warehouse should
  **accumulate** state, not just mirror "now."
- **Mechanics:** Cloud Scheduler → Cloud Run/Function worker → BigQuery load
  jobs. Idempotent, partitioned by date. Small surface area.

Caveats / boundaries:
- **A nightly read-current-state *snapshot* misses intra-day churn and deletes.**
  An item created and deleted the same day never reaches BQ via snapshots alone.
  **This is solvable without streaming — see the audit log decision below.**
- **In-app Scorecard trend lines (Feature 2) read from Firestore, NOT BigQuery.**
  Those are a live app feature over data already in Firestore. BigQuery is for
  the client's **cross-source consolidation/reporting**, not for powering
  in-app charts — don't couple a live feature to the nightly lag.

#### Audit log / change history → BigQuery (DECIDED — Option 2, `onWrite` trigger)
The "snapshot misses intra-day changes/deletes" gap is a property of snapshotting
current state, **not** a real limitation. An **append-only audit log captures
full change history and still ships fine on the nightly batch** (append-only =
nothing to overwrite, so nightly cadence loses nothing; deletes become event
rows).

Design: add an append-only `audit_log` (event) collection in Firestore. Each
mutation writes an immutable row:
`{ entity_type, entity_id, action (create/update/delete), actor, timestamp,
before/after or diff }`. The nightly worker ships it to BQ like any other table
(date-partitioned). Keeps the simple, cheap BQ pipe — **no streaming-to-BQ.**

**DECIDED 2026-07-01: Option 2 — server-side `onWrite` trigger.** The app has
three write paths (server actions, admin/seed scripts, future integrations);
only the trigger guarantees all of them are captured — for a bank, "the audit
log cannot be bypassed" is the property that matters. Original analysis kept
below for the record.

**Where to capture the events (original options):**
- **Option 1 — app-level (data-access layer writes the audit row).** Simple,
  rich semantics (actor/action/human-readable diff) for free. Risk: writes that
  bypass that layer (e.g. admin/direct writes) aren't logged.
- **Option 2 — server-side Firestore `onWrite` trigger (Cloud Function).**
  Captures **everything**, even direct/admin writes — nothing slips past.
  Slightly more infra; diff reconstructed from the change snapshot. Still writes
  to the Firestore audit collection (not streamed to BQ), so the nightly pipe is
  unchanged.
- **Engineering lean: Option 2** — only the trigger *guarantees* nothing is
  missed, which is the whole point of an audit log.
- Practical notes: partition the BQ audit table by date; the log grows
  unbounded, so optionally TTL the Firestore copy once shipped (BQ keeps the
  permanent record).

#### Still open (to resolve before building the worker)
- **Run cadence: DECIDED 2026-07-01 — nightly.** Cost delta vs. weekly is
  noise at this scale; day-resolution snapshots + the append-only audit log
  close the intra-day-churn gap.
- **Collections to mirror: decided in principle** — all nine domain
  collections (`organizations`, `users`, `teams`, `team_members`, rocks +
  milestones, todos, issues, headlines, scorecard metrics/values, meetings)
  plus `audit_log`; skip ephemeral presence/segment-cursor state. Per-table
  shape: stable scalar columns + `snapshot_date` partition + a `raw` JSON
  column to absorb schema drift.
- **Schema mapping: BLOCKED on client** — must conform to HPB's BigQuery
  conventions from the Jack Henry migration (dataset naming, region,
  partitioning standards, PII handling, retention, reader access). Build the
  worker schema-agnostic until their conventions arrive.

---

## Pass 11 (2026-07-13) — requirements stack arrived (ninety.io config doc)

The client delivered their annotated ninety.io walkthrough ("Ninety.io
configuration requirements") — the first installment of the requirements
stack Pass 10 was blocked on. Drift analysis vs the current app:

**Confirmed already built (no action):** private to-dos; four rock
statuses + status history; milestones w/ due dates; to-dos assignable to
any member; issues short/long-term split; headlines incl. cascading kind;
L10 segment list matches ninety's default agenda; segment timers +
attendance/presence; recap w/ ratings + past-meeting history; multi-team
membership; scorecard weekly grid w/ owners/goals/averages.

**Drift (exists, differs) — being fixed this pass via subagent batch:**
- Scorecard: 8→13-week grid; optional metric grouping (ninety-style
  sections). [Deferred from this batch: monthly/quarterly/annual interval
  views, warehouse-fed metrics — see "new" below.]
- Rocks: company/department/individual type flag + ordering (extends 5a);
  milestone progress indicator; optional descriptions (7).
- Issues: single owner + 4-level priority gate (8) + description; voting
  kept as meeting-time ranking. [Deferred: merge/send-to-team/convert
  actions.]
- Meetings: end-of-meeting vote rates the meeting, not attendees (9,
  confirmed by ninety's per-person meeting-rating list); overrun timer
  goes red (verify/add).
- Home: milestones due ≤7 days surface in the To-Dos group (ninety "My
  90" behavior).
- To-dos: optional description (7).

**Requirement changes to tabled features:**
- Feature 1 (VTO tab) SIMPLIFIED: client wants named hyperlinks out to
  Google Drive docs only — no in-app VTO documents. "Directory" visibility
  question raised (Owner/Implementer-only?).
- Feature 4 (cascading messages) refined: client dislikes ninety's
  design; wants cascade surfaced per-user (mark-off in My 90-equivalent),
  per-team cascade-eligible checkbox, private teams excluded.
- Feature 3 overlap: ninety tracks per-*section* durations in past
  meetings; client's speaking-timer ask (per-person) still stands apart.

**New asks (NOT in this batch — next run):**
- Google Tasks two-way sync for private to-dos (client's only flagged
  Phase-1 integration; needs per-user Google OAuth + token storage —
  security-review item).
- Insights dashboard (meeting-rating trend, issue solve rate, to-dos
  created/over-time, rock %, milestone trend, revised-due-date counts,
  avg time in Issues). NOTE: the audit-log trigger already captures the
  change-history this needs (due-date revisions etc.).
- Custom meeting agendas: multiple templates (L10, L10 Condensed,
  Quarterly, Annual, 1-on-1, Focus Day, Vision Building), per-team agenda
  editor (rename/reorder/durations/custom + tool sections, push-to-all-
  teams), scheduled/recurring meetings, archive-on-close semantics.
  Biggest single build item.
- Linked items + attachments + comments on rocks/to-dos/issues/headlines.
  Attachments ⇒ Cloud Storage bucket (absent from Terraform/backups/
  security tiers — infra follow-up).
- Scorecard fed FROM the warehouse (Looker Studio / BigQuery metrics
  into the app) — reverses our one-way EOS→BQ design; scoping
  conversation needed; makes client BQ conventions more urgent.
- Directory/admin: CSV user import; per-team last-met visibility;
  private-team flag; richer role model (Owner/Implementer see all teams).
- Notifications (email/web/mobile + daily digests) — client says NOT
  phase 1. Meet-transcription→to-dos — client says not phase 1 (aligns
  with Vertex-only AI deferral).

**Strategic notes:** heavy Google integration asks (Tasks/Drive/Meet)
confirm HPB is a Google Workspace shop → the SSO/identity-provider risk
in CLIENT_GCP_SETUP.md §3 is effectively retired. BigQuery becomes
two-way (export for consolidation + import for scorecard/insights).

## Cross-cutting notes

### Tabs surface identically in-meeting and standalone
- **Scorecard, Rocks, To-dos, etc. render nearly identically** whether viewed
  on their own independent tab or inside the L10 meeting view.
- Captured here as a design note for future feature work: when we build/extend
  any of these tabs, the same component should serve both contexts.

---

## Features

### 1. VTO + Accountability tab
A tab that surfaces the client's core internal documents:
- **Values**
- **Purpose**
- **Mission**
- **10-year goal / focus** ("Ten Year Target")
- Other **marketing** material/assets

> Think of this as the read-out for the Vision/Traction Organizer plus the
> accountability view — the durable "who we are / where we're going" docs.

### 2. Scorecard trend lines
On the **Scorecard** page, add **trend lines** showing a user's performance
against their scorecard over a chosen interval.
- Supported intervals: **weekly, monthly, annual**.
- **No granularity finer than weekly.**

### 3. L10 meeting "Segue" — start/stop speaking timer
For the **Level 10 (L10) team meetings**, add a **start/stop timing flow**.
- At the **end of the meeting**, produce a breakdown of who spoke and for how
  long — e.g. _"Joe spoke for 30 seconds. Susie spoke for a minute and a half."_
- This is an **optional** start/stop time gate — the client opts in.
- When enabled, the client gets the **opportunity to track that speaking data**.

### 4. Cascading messages (Headlines tab)
"**Cascading message**" is the name for the data object on the **Headlines** tab.
It works in two primary ways:

1. **Internal team communication (default)**
   - A user's default headline / cascading message goes **to their own team**
     (e.g. a dev-team member's message defaults to the dev team).

2. **Cross-team opt-in communication**
   - Allow a message to be **opted in to other teams** for cross-team L10
     communication — e.g. _"Hey marketing team, thanks for your great work this
     week."_

### 5. Rocks page enhancements

**5a. Layout — departmental rocks first, then individual rocks**
- **First line item: departmental rocks.**
- **Following line items: individual rocks.**
- Everything **filtered down to just the team** — nothing outside that team's view.

**5b. Dashboard / milestone summary at top of page**
- A **dashboard-style section at the top of the Rocks page**, shown **whether
  in-meeting or not**.
- Surfaces:
  - **Milestones completed this week** (what your teammates accomplished).
  - **Upcoming milestones** — high-urgency items due next week.
- Goal: when you click the Rocks tab in a meeting, everyone immediately sees
  what teammates accomplished this week and what high-urgency item is due next
  week.
- **Time-gated for now** (this-week / next-week windows). Surfaced to the top.
- _Note: "milestones" here are the to-do-like sub-items under each rock._

**5c. Archive tab**
- Add an **archive tab** to the Rocks page.
- A **paginated** view to browse archived rocks (page through N pages of
  archived rocks).

### 6. Multi-user To-do assignment

- A to-do can be **assigned to multiple users at once**.
- It surfaces as **one single line item** on the team To-dos list — **do not
  duplicate** the line item per user. One to-do, distributed to multiple users.
- Indicate multiple assignees with **multiple profile avatar pictures** on the
  line item.
- **Clicking/expanding** the line item reveals the specific details of the
  to-do, including the multiple assigned users.
- **Completion semantics (per-user):** a multi-assigned to-do **does not clear
  until _all_ assigned users mark it complete.**
  - Each assigned user checks off their own completion independently.
  - Show a **staged / partially-complete state** reflecting how many of the
    assigned users have checked off (e.g. 2 of 3 done).
  - The to-do is only **fully complete (and clears)** once **every** assigned
    user has marked it done.

### 7. Optional description / tagline on Rocks, To-dos (and maybe Milestones)

- Add an **optional description (tagline) field** for **greater context** on:
  - **Rocks**
  - **To-dos**
  - **Milestones** (maybe / TBD)
- Primary use case: when an **admin creates a rock, milestone, or to-do for
  another user**, they can **optionally drop additional notes** in this
  description field.
- Goal: **improve the handoff** of whatever action needs to be done.

### 8. Issues — single owner + priority gate

- **Single owner only.** When creating an issue, assign exactly **one owner** —
  **no** multiple-owner / multi-user assignment for issues (unlike to-dos).
- Add a **priority gate** with **four levels**:
  - **Urgent**
  - **High**
  - **Medium**
  - **Low**

### 9. End-of-meeting vote — rate the meeting, not the attendees _(change)_

**This is a change to existing functionality.**
- The end-of-meeting vote must measure the **quality/efficacy of the meeting
  itself** — **not** a user voting on the quality/performance of the other
  attendees.
- A user should be able to:
  - **Vote on the efficacy of the meeting**, and
  - **Optionally leave a note** describing/explaining that rating.
- **Remove** any option to vote on the efficacy/performance of **other
  attendees**. There is no per-attendee rating.

---

## ▶ RESUME HERE — next session

**Pass 17 (in progress): Session D — P1/P2 cleanup** on
`feature/p3-roadmap` (branch name is historical; scope is remaining P1–P2).

**Shipped this session (so far):**
- **P1-6 Vote credits UI** — remaining-first badge, per-person copy, team vs you.
- **Archive contract (P2-2 / P2-3 aligned):**
  - **To-dos / Headlines / Issues:** closed *in L10* → archive on Finish;
    closed *outside* → gray on Active until **Monday 3am** worker.
  - Headlines “closed” = **discussed** only (standing never auto-archive).
  - Issues “closed” = **solved | dropped** (`resolved_at`).
  - Mid-week gray + “Closes Monday” chip; Archived = flat, Closed On, no strike.
  - **Rocks:** Active/Archived tabs ready; **no archive path yet** (empty Archived).
  - Worker `archiveStaleTodos` archives prior-week todos + issues + discussed
    headlines (**redeployed** to prod).
- **P1-6** vote credits as above.

**Still open on this cleanup branch:**
- **Rocks archive path** (manual and/or auto) — UI only for now
- **P2-7** privacy · **P1-7** Google Tasks (optional)
- **P1-2** allowlist ops (**deferred**)
- **P2-1** custom agendas (out of band)
- **Recap attribution** mid-L10 standalone creates (`L10_GAPS` / T1)
- P3-* as capacity allows

**Prior:** Session C complete on `feature/p2-roadmap` → **PR #14**
(P2-3…P2-6 + polish). Sessions A/B on p0/p1 branches.

Working priority list is agent-local — not in this repo
(`~/.local/share/mcgarey-agents/eos/CLIENT_FEEDBACK_PRIORITY.md`).

---

**Pass 14 (2026-08-03): structured client feedback tracker** — HPB users
filled `Daniel_Tool_Feedback_Tracker.xlsx` after hands-on time in the
demo (22 items, 2026-07-30 → 2026-08-03). Reviewers: **Jenna Scheeler**,
**Steph Benes**, **Jessica Teichman**. Source xlsx includes 12 screenshots
(under `docs/feedback/pass-14-screenshots/`). Ingested below; cross-links
Pass 11/13 so we don't double-count.

> **Working priority list (merged Pass 13+14)** is agent-local on the
> consultant machine (not in this repo). Grok/Claude load it via local rules;
> this ROADMAP section stays the raw client log only.

### Pass 14 — Feedback Log (verbatim themes → triage)

| # | Date | Who | Page | Ask / bug | Map / disposition |
|---|------|-----|------|-----------|-------------------|
| 1 | 07-30 | Jenna | Scorecard | Weekly metrics work; **other scorecard tabs inaccessible** | ✅ **Done Pass 15 (P1-3).** Metric `interval` model: tabs filter weekly/monthly/quarterly/annual measurables (not weekly rollups). Calculated/share-up still P3-1; warehouse trends P3-5. |
| 2 | 07-30 | Jenna | Rocks | Quarter + Due Date — **manual entry or smart logic?** | ✅ **Done Pass 16 (P2-6).** Free-text quarter; rock due optional (EOQ suggested). Deeper monthly-stage defaults still later. |
| 3 | 07-30 | Jenna | Rocks | **Where does the status comment go?** (off-track note) | **UX discoverability.** Related to Pass 13 #1 (save bug fixed). Surface comment history on rock after save. |
| 4 | 07-30 | Jenna | To-Dos | **Default due date = 7 days out**; milestones 7 days out should become to-dos — she added a milestone due today and it **did not** pull into to-dos | **Bug + product.** Home 7-day milestones (Pass 11) may not cover "milestone → to-do" auto-promote, or list filter is wrong. Verify `home` + to-dos surface. |
| 5 | 07-30 | Jenna | To-Dos | **Done to-dos archive after the team meeting**; toggle to view archived — same pattern for Rocks, Headlines, Issues, etc. | **Product** — archive-on-close + archive tab. Rocks archive already Feature 5c; generalize across entities. Custom agendas "archive-on-close" in Pass 11 new asks. |
| 6 | 07-30 | Jenna | Issues | Comments useful; **attachments optional** (links to Google Docs OK instead) | ✅ **Done Pass 16 (P2-5)** for comments + linkify. Binary attachments still deferred. |
| 7 | 07-30 | Jenna | Headlines | **Mark off headlines discussed in meeting**; keep standing headlines (e.g. open positions); **don't auto-archive all** — only checked-off | ✅ **Done Pass 16 (P2-3).** Discuss checkbox + selective archive at meeting end. |
| 8 | 07-30 | Jenna | Meetings | Likes it; **adjust speaking sequence**; is order = join order?; **≥4 agenda formats** now, more later; **select agenda at meeting start** | **Confirmed.** Speaking order = team `speaking_order` (editable?) — verify UI. Custom agendas = Pass 11 / Pass 13 #8. |
| 9 | 07-30 | Jenna | Members | Multi-team org; needs **admin testing**; **employee issues must not leak across individuals/teams** | **Security / tenancy review.** Cross-team IDOR fixed on mutations (Pass 10); still need explicit privacy story for sensitive issues + role model (Pass 11 Directory/admin). |
| 10 | 07-30 | Steph | To-Dos | **Google Tasks complete → mark complete in tool** (two-way) — **not working** | **Integration bug / incomplete.** Today is **one-way push** (`lib/google/tasks.ts`). Client wants **Tasks → EOS** completion sync. Elevates Pass 11 Phase-1 Tasks ask to **two-way is required**. |
| 11 | 07-30 | Jessica | Scorecard | **Calculated measurables** from other metrics; **share-up** to other teams (Transformation uses this — confirm with Joe) | **Major product gap** vs ninety. Formula metrics + cross-team rollup. New — not in prior passes. Scope carefully (warehouse vs live). |
| 12 | 07-30 | Jessica | Issues | **Move short-term ↔ long-term**; **comment / bigger description edit in-meeting** for decision notes | ✅ **Done Pass 16 (P2-4 + P2-5).** Move button + LT tab; comments on issue/rock detail. |
| 13 | 08-03 | Steph | Teams | **On multiple teams — no toggle** to switch; suggest click current team → dropdown. Wants admin testing when ready | ✅ **Done Pass 15 (P1-1).** Sidebar team switcher over all memberships. |
| 14 | 08-03 | Steph | Headlines | Categorization good; add **General / FYI** category (beyond Other) | **Small product** — headline category enum. |
| 15 | 08-03 | Steph | Headlines | **Hyperlinks + rich text** (bullets, bold) in headlines | **Product** — rich text / linkify across headlines (and issues #21). |
| 16 | 08-03 | Steph | Headlines | **No submit loading feedback** → pressed multiple times → **4 duplicates** | **Bug — high confidence.** Disable button + pending state on create. Same pattern audit for all create forms. |
| 17 | 08-03 | Steph | Integrations | Move Integrations out of top nav into **Settings / profile** | **UX polish** — nav hierarchy. |
| 18 | 08-03 | Steph | Rocks | When screen full, **status dropdown at bottom is clipped / unreachable** | **Bug.** Related Pass 13 #1 popover flip/max-height — extend same treatment to status control at list bottom (collision / flip). |
| 19 | 08-03 | Steph | Rocks | **Milestone default dates = calendar quarter end** — prefer no date or today; rock quarters need more flexibility | ✅ **Done Pass 16 (P2-6).** Milestone due empty by default; free-text quarter. Optional monthly-stage suggestions still later. |
| 20 | 08-03 | Steph | Rocks | **Cannot edit milestone dates after set** | **Bug / missing edit path.** |
| 21 | 08-03 | Steph | Issues | **Long-term issues on separate tab** — list gets long | ✅ **Done Pass 16 (P2-4).** Short-term / Long-term tabs on Issues + L10. |
| 22 | 08-03 | Steph | Issues | Rich text + attachments (echo Jenna) | Same as #6 / #15. |

### Pass 14 — prioritized engineering queue

**Bugs / quick wins (buildable now):**
1. **Headline (and form) double-submit** — pending/disabled state (#16). ✅ Pass 15 P0
2. **Milestone date not editable after create** (#20). ✅ Pass 15 P0
3. **Rock status dropdown clipped at bottom of viewport** (#18). ✅ Pass 15 P0
4. **To-do default due = +7 days**; milestones due soon as to-dos (#4). ✅ Pass 15 P0
5. **Team switcher** in shell (#13). ✅ Pass 15 P1-1
6. **Status comment discoverability** after save (#3). ✅ Pass 15 P0

**Integrations / access:**
7. **Google Tasks two-way completion** (#10) — today one-way only; client expects Tasks→EOS.
8. **Members / issue privacy** story for multi-team (#9) — confirm rules + product model.
9. Ops still: allowlist + membership for access issues (Pass 13 #2).

**Product (scope against Pass 11):**
10. **Custom agendas + pick template at start** (#8) — still largest build; re-confirmed by Jenna + Steph (Pass 13).
11. **Archive-after-meeting + archive toggle** across entities (#5) — still open for todos/rocks/issues. ✅ Headline selective archive (#7) Pass 16 P2-3.
12. **Issue ST↔LT move + LT tab** (#12, #21) ✅ Pass 16 P2-4; **comments** (#6) ✅ Pass 16 P2-5 (binary attachments still deferred).
13. **Scorecard interval tabs** working (#1) ✅ Pass 15 P1-3 (metric interval model). **Calculated + share-up** (#11) still open (P3-1).
14. Headline **FYI category** (#14); **rich text / links** (#15, #22) — include **issue descriptions** (and rock descriptions / headline body / comments); comments already linkify URLs (P2-5). Full editor still P3-2.
15. Integrations nav → settings (#17). Rock/quarter **default flexibility** (#2, #19) ✅ Pass 16 P2-6 (empty milestone due; free-text quarter; smarter monthly stages later).

### Pass 13 (retained) + Pass 14 overlap

| Pass 13 | Reinforced by Pass 14 |
|---------|------------------------|
| #2 System access / multi-team | Steph #13 team switcher |
| #3 Scorecard visibility | Jenna #1 other tabs; Jessica #11 formulas/share-up |
| #8 Flexible meeting templates | Jenna #8 agendas at start |
| #1 Off-track comment save (fixed) | Jenna #3 "where does comment go?" (display) |
| Speaking / participant order | Jenna #8 adjust sequence |

---

**Pass 13 (2026-07-29): live client L10 prototype test** — Enterprise
Systems & Data L10 (Cora, Stephanie, Joe, Jessica + Daniel). Source:
Gemini notes PDF. Actionable product feedback + bugs below; non-EOS
ops items (picnic, conversion hours, Jack Henry pilot bandwidth) not
tracked here.

### Bugs / defects (client-reported)

| # | Item | Owner / notes | Severity |
|---|------|---------------|----------|
| 1 | **Cannot save comments when updating a rock status to off-track** | **FIXED 2026-07-30.** Capture-phase scroll listener on the fixed status popover was closing the panel when the off-track comment textarea scrolled (or the page shifted under it), wiping the draft before Save. Now ignores in-panel scroll, repositions on page scroll, and applies flip-above `bottom` + max-height so Save stays on-screen. | ✅ fixed |
| 2 | **System access** issues during the session | **Investigated 2026-08-03 — partial fix.** Dual auth (session cookie for SSR + client Firebase Auth for live listeners) desynced: app looks signed-in but live features die silently. Fixes: `LiveAuthBanner` when client uid missing; sign-out clears both halves; 404 copy points to join/Members. Remaining ops: ensure demo users are on the team (`Members` / join approve), `SIGN_IN_ALLOWLIST` matches HPB emails, sidebar only shows `teams[0]` (no team switcher). | 🟡 partial |
| 3 | **Scorecard visibility** bugs | **Investigated 2026-08-03 — fixed main code path.** Silent 30-metric `in` cliff dropped entry values for metrics 31+ (all-dash rows). Chunked loads server + live. L10 default sort was "status" reshuffling the list; compact now defaults to configured `sort_order`. Remaining: owner/speaking-order grouping (product), warehouse-fed metrics (Pass 11). | ✅ fixed (code) |

### UX / product feedback from live use

| # | Item | Speakers | Map to existing plan |
|---|------|----------|----------------------|
| 4 | **UI feedback** (general) | Jessica, Cora, Joe | Continue collecting; no single ticket yet |
| 5 | **Vote allocation display** unclear or wrong | Jessica, Cora, Joe | Check remaining-credits UI in Issues; related: Pass 12 vote-reset-on-conclude semantics in `L10_GAPS` |
| 6 | **Scorecard page limitations** | Jessica, Cora, Joe | Pass 11 deferred scorecard work (interval views, warehouse-fed metrics) + 30-metric cliff |
| 7 | **Issue management functionality** gaps | Jessica, Cora, Joe | Pass 11 deferred issue actions (merge / send-to-team / convert); in-meeting Issues solve gap in `L10_GAPS` |
| 8 | **Flexible meeting templates** (different durations & formats) | Stephanie | Already Pass 11 "new asks" — custom agendas (L10 / Condensed / Quarterly / 1-on-1 / …). **Client re-confirmed in live use.** Biggest build item. |
| 9 | **Scorecard presentation order should follow participant list order** | Stephanie, Joe | Confirmed as desired behavior — verify implementation matches speaking/participant order |
| 10 | **Active speaker highlighting during rotation** | Joe | Noted as present/working — keep as expected behavior |
| 11 | **Absent users grayed out in interface** | Cora, Joe | Noted as present/working — keep as expected behavior |

### Adjacent / not EOS product (context only)

- Client Q3 rock target **Nov 2**; strategic focus includes **Gemini Enterprise** + AI use cases (aligns with our Vertex-only / AI deferred stance — do not revive key-based Gemini in-app).
- Jack Henry data origination pilot discussed (account opening / questionnaires) — warehouse/data-org context for BigQuery conventions, not an EOS feature.
- Joe surveying **one-on-one meeting tool** usage org-wide — if 1:1 is real demand, it feeds the custom-agenda template list (1-on-1 is already named in Pass 11).

### Immediate engineering queue (from this meeting)

1. **Fix rock off-track comment save bug** (Daniel) — highest-confidence client bug.
2. Triage **system access** + **scorecard visibility** with repro steps from Cora/Joe.
3. Verify **scorecard row order** = participant/speaking order in-meeting.
4. Inspect **vote allocation display** for clarity bugs (not just semantics).
5. Keep **custom meeting templates** elevated — Stephanie re-confirmed; still the largest product build on the Pass 11 list.

**Pass 12 (2026-07-29): pre-demo L10 audit + fix batch.** Full-flow audit of
the L10 meeting (entry → segments → conclude → recap) the night before the
client demo; the fixes shipped on the demo-prep PR. Deferred items,
product-semantics questions (vote reset on conclude, recap source-of-truth),
and the demo-morning checklist live in **`docs/L10_GAPS.md`** — read that
before doing further L10 work. Cross-check Pass 13 client bugs against
`L10_GAPS` before opening new tickets.

**Pass 11 (2026-07-13): the requirements stack (first installment) ARRIVED**
— the client's annotated ninety.io config doc. See the Pass 11 section
above for the full drift map. Drift-fix subagent batch ran this session
(scorecard 13wk+groups, rock types+progress+desc, issue owner+priority+
desc, meeting-rating change (#9), home 7-day milestones, todo desc).
**Next run = the "new asks" list in Pass 11** (Google Tasks sync is the
client's flagged phase-1 integration; custom agendas is the biggest
build; attachments need a Cloud Storage bucket added to the Terraform
footprint). Features 1 and 4 have client-driven scope changes noted in
Pass 11. Client BQ conventions still outstanding but now more urgent
(two-way BigQuery).

Pass 10 (2026-07-01) resolved the session-start checklist: stack surfaced,
audit-log capture point (Option 2), nightly cadence, and collection list
decided; deployment target locked to the client's GCP org. Foundation work
done this pass: Gemini assistant removed, repo hygiene (branding PDF
untracked, strays deleted), Cloud Run deploy scaffolding (Dockerfile,
cloudbuild.yaml, `docs/DEPLOY.md`).

**Done this pass (2026-07-01, second batch):**
- Audit-log `onWrite` trigger built — `functions/` (Cloud Functions gen2,
  `onDocumentWrittenWithAuthContext`, audit_log loop guard, presence
  excluded), rules block (admin-read / never-client-write), deploy section
  in `docs/DEPLOY.md`. Not yet deployed.
- Terraform skeleton built — `terraform/` root module (APIs, least-privilege
  runtime SA, Artifact Registry, Cloud Run, Tier 1 levers behind boolean
  flags with $/mo notes, commented nightly-worker skeleton).
  `fmt` + `validate` clean. See `terraform/README.md` for the client
  cloud-team review flow and open inputs (state bucket, org_id, LB scope,
  Firestore import for native PITR/CMEK).
- Client-facing onboarding checklist written — `docs/CLIENT_GCP_SETUP.md`
  (non-engineer version of `docs/DEPLOY.md`: what HPB needs to
  provide/decide to unblock a real deploy — GCP project, IAM grant for us
  in place of a service-account key, Workspace sign-in domain, CI choice,
  sizing, security tier pick from the Pass 10 levers menu). Linked from
  `README.md` and the top of `docs/DEPLOY.md`. Expanded (2026-07-13) with
  gap-analysis sections: Firestore location choice (nam5 vs regional),
  baseline run cost, demo cutover/decommission plan, day-2 ops (alerts
  destination, admin handoff session, staging copy, patching ownership),
  and risk/compliance items (access lifecycle, repo ownership, retention,
  vendor review). **Note: the doc now promises Tier-0 baseline monitoring,
  budget alerts, scheduled Firestore exports, and a staging service — none
  of which exist in `terraform/` yet. Build these before go-live.**

**Deploy-path fixes (2026-07-13 infra review): ALL APPLIED (2026-07-13
pre-deploy hardening pass).** `_TAG` substitution replaces `SHORT_SHA`;
DEPLOY.md §6.1 grants the acting Cloud Build SA (legacy *or* compute-default
on 2024+ projects) its deploy roles; §3.1 creates the Firestore database
(location = client decision, permanent); `iam.tf` now grants the runtime SA
`roles/firebaseauth.admin`; CMEK lever grants the AR service agent KMS use +
immutability warning; stale §-refs and the gen2-functions SA corrected.
Same pass also added: Firebase project registration step (§0.5 +
`firebase.googleapis.com` in apis.tf — was a fresh-project blocker),
Dockerfile fail-fast guard on empty `NEXT_PUBLIC_*` build args, pnpm pinned
to 10.33.0 (packageManager + Dockerfile), and authorized-domains moved to a
post-deploy step (§6.3).

**Also fixed same pass (from the 3-agent code review):** cross-team IDOR —
all mutating server actions now call `requireTeamDoc()` (admin SDK bypasses
rules, so actions are the only write-side tenant check); TZ off-by-one in
live-L10 due dates (`formatDateOnly`, local-midnight parse); NaN-proofed
meeting-rating averages; seed creates real emulator Auth users for the 4
synthetic teammates (multiplayer demo beat works locally; teammate emails
now @highplainsbank.com to pass the rules domain gate).

**Known-remaining (LOW, non-blocking, do when convenient):**
- `terraform fmt -check` + `validate` never re-run after the CMEK/iam edits
  (CLI not installed in the session env) — run before first apply.
- Home page query breaks for a user on >15 teams (double-`in` disjunction
  cap, `app/(app)/home/page.tsx`); scorecard `in`-queries silently cap at 30
  metrics/team; home 7-day/overdue boundaries computed at UTC midnight (no
  business-timezone config).
- `firestore.indexes.json` carries unused composite indexes (superset —
  harmless, prune someday).

**Next up (in order):**
1. **Blocked on client:** requirements stack + BigQuery/data-compliance
   conventions (dataset naming, region, PII/retention). Also: which GCP
   project, Cloud Build vs GitHub Actions for CI, consultant IAM identity,
   plus the Terraform open inputs above.
2. **After conventions arrive:** nightly BQ batch worker (Cloud Scheduler →
   Cloud Run job → date-partitioned load jobs) — uncomment and finish
   `terraform/scheduler.tf`.
3. Then feature scoping against the requirements stack (features above remain
   tabled until it lands).

## Pending passes
_Additional notes to be added in subsequent passes._
