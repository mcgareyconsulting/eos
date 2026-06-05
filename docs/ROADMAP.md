# EOS Platform — Feature & Infrastructure Roadmap

> **Status:** Planning notes only. Nothing here is scheduled or implemented yet.
> This document tracks client requests as they come in. It is captured in
> stages — each pass adds context. We'll scope and roll features later.

**Client:** High Plains Bank (HPB)
**Last updated:** 2026-06-05 — _Pass 1_

---

## Infrastructure

### Keep data live on Firebase Firestore
- Firestore remains the **system of record for live, real-time data** — the
  back-and-forth between users stays here. No change to the live data layer.

### Bleed all data down into BigQuery
- Every Firestore data object needs to **flow down into BigQuery**.
- Purpose: **consolidate all of the client's data** into a single analytics
  warehouse alongside their other sources.
- _Open questions for later: sync mechanism (streaming export vs. scheduled
  batch), schema mapping, which collections, latency expectations._

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

---

## Pending passes
_Additional notes to be added in subsequent passes._
