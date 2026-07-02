# EOS Platform — Feature & Infrastructure Roadmap

> **Status:** Planning notes only. Nothing here is scheduled or implemented yet.
> This document tracks client requests as they come in. It is captured in
> stages — each pass adds context. We'll scope and roll features later.

**Client:** High Plains Bank (HPB)
**Last updated:** 2026-07-01 — _Pass 10_

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

Pass 10 (2026-07-01) resolved the session-start checklist: stack surfaced,
audit-log capture point (Option 2), nightly cadence, and collection list
decided; deployment target locked to the client's GCP org. Foundation work
done this pass: Gemini assistant removed, repo hygiene (branding PDF
untracked, strays deleted), Cloud Run deploy scaffolding (Dockerfile,
cloudbuild.yaml, `docs/DEPLOY.md`).

**Next up (in order):**
1. **Blocked on client:** requirements stack + BigQuery/data-compliance
   conventions (dataset naming, region, PII/retention). Also: which GCP
   project, Cloud Build vs GitHub Actions for CI, consultant IAM identity.
2. **Buildable now:** audit-log `onWrite` trigger (Cloud Function writing the
   append-only `audit_log` collection) — independent of BQ schema decisions.
3. **Buildable now:** Terraform skeleton for the client-project footprint,
   with Tier 1/2 security levers as toggleable blocks (see Pass 10 notes).
4. **After conventions arrive:** nightly BQ batch worker (Cloud Scheduler →
   Cloud Run job → date-partitioned load jobs).
5. Then feature scoping against the requirements stack (features above remain
   tabled until it lands).

## Pending passes
_Additional notes to be added in subsequent passes._
