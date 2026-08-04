# L10 Meeting Flow — Gap Report (2026-07-29, pre-demo audit)

Product of the evening audit pass before the demo. Three audit sweeps
(entry/lifecycle, in-meeting segments, conclude/recap/history) plus the
requested features. **Everything fixed tonight is in the PR diff** — this file
is the remainder: real gaps that were too big, too risky, or genuinely a
product decision the night before a demo.

Severity: 🔴 worth doing soon · 🟡 real but not urgent · ⚪ nice-to-have.

---

## Decide first (product semantics — need a call, not just code)

### 🔴 Vote credits now reset when a meeting concludes — confirm this is wanted
Fixed tonight, but it's a semantics change worth a deliberate yes: `endMeeting`
now deletes the team's `issue_votes` and zeroes `issues.votes`. Rationale: EOS
vote credits rank *one meeting's* Issues hour; before this, credits were
lifetime-per-team, so the second meeting ever run opened with everyone "out of
votes". Consequence: between meetings the Issues tab ranks by priority/status
only. If the client wants votes to persist across a week, the alternative is
scoping vote docs by meeting id instead. (One-line revert if unwanted:
the cleanup block at the end of `endMeeting` in `meetings/actions.ts`.)

### 🔴 Recap "created this meeting" is a time-window guess
The recap lists items whose `created_at` falls inside the meeting window — a
to-do created from the standalone page by someone not in the meeting still
shows up as "created in this meeting", and anything captured a minute after
Finish is missed. Tonight the in-meeting creation paths (inline to-do form,
every Drop-to-Issues) started writing `source_meeting_id`, so the data now
accumulates. **Next step:** switch recap membership to
`source_meeting_id == meeting.id`, keeping the time window only as a fallback
for legacy docs. Also: rocks/headlines created in-meeting don't carry the
field yet (no in-meeting creation surface for rocks; headlines quick-add could
pass it the same way).

### 🟡 Recap is a live view masquerading as a historical record
"Total Tracked Issues", solve rate, and every recap list are recomputed from
*today's* data each time a past recap is opened. Retitle a rock → last month's
recap changes. Proper fix: denormalize a recap snapshot onto the meeting doc
at conclude time (one write in `endMeeting`), render from that. Medium-size,
touches schema — good post-demo task. Related: per-segment durations are never
persisted (`segment_started_at` is overwritten on each advance), so "how long
did Issues take?" is unanswerable; ninety.io tracks this (see ROADMAP Pass 11).

### 🟡 Who may drive/end a meeting
Any team member can advance segments and conclude (the driver label is
display-only by design). The two-step Finish arm is the only guard. If the
client wants driver-only transport, it's a small server-side check — but it's
a workflow decision, not a bug.

---

## Deferred (real gaps, too big for demo eve)

### In-meeting Issues can't complete solve → to-do 🔴
Solving an issue in the meeting has nowhere to land the follow-up: no owner
or priority editing in-segment (`IssueFormModal` + detail comments live on
the Issues tab / detail modal, not in the L10 list), and `resolution_todo_id`
is written as null and never set. The natural demo beat — "solved; Tom owns
the follow-up to-do" — needs a "solve → create to-do" affordance in
`segment-issues.tsx`. The inline to-do form from tonight makes this a compose
job, not a build job.

### Per-row "drop to Issues" 🟡
Drop-to-Issues is a header button with a typed-prefix title ("Off-track
rock: ") — the canonical "this rock is off track, drop it" beat requires
retyping the rock title. `components/l10/drop-to-issues-button.tsx` was built
for per-row drops and is dead code. Wire it into rock rows (and maybe
scorecard rows) with the item title prefilled, or delete it.

### Round-robin stages don't follow the speaker 🟡
Rocks groups by speaking order with a "Now speaking" header; To-Dos and
Headlines are flat lists sorted by due date/recency even though the rail keeps
advancing a speaker. Either group those stages per-owner too, or stop
advancing the pointer there.

### To-Dos segment is read-mostly 🟡
Tonight added creation; editing is still page-only (no title/description
edit, no owner reassignment in-segment). Same for headlines (no body on the
in-meeting quick-add, no edit-after-create on either surface).

### "Back" resets the segment clock and speaker round 🟡
Overshoot into Rocks, click ← Back to finish Scorecard: the timer restarts at
5:00 and the round-robin resets to the first present person. Resuming needs
per-segment elapsed persistence (same storage work as per-segment durations
above — do them together).

### Stale-vote edge case 🟡
A vote on an issue that later gets re-classified long-term is stranded (no
VoteButton renders on long-term rows). The per-meeting vote reset from
tonight caps the damage at one meeting; a `-` affordance on long-term rows
would eliminate it.

### Everyone-rates visibility 🟡 (partial tonight)
Conclude now streams ratings live and lists who hasn't rated. The recap still
shows attendee scores; consider surfacing the "waiting on" state on the recap
too if rating-after-conclude stays allowed.

### Conclude segment content ⚪
The hint promises "recap new to-dos, identify cascading messages" but the
segment shows only notes/rating/attendance. The data exists (recap computes
it). Rendering "to-dos created this meeting" inside Conclude would match EOS
practice.

---

## Data / infra hygiene

- 🔴 **Firestore rules allow direct client update/delete of meeting docs**
  (`firestore.rules` meetings match). All real writes go through admin-SDK
  server actions, so the server-side guards added tonight (ended-meeting,
  segment clamp) are advisory against a devtools user. Tighten rules to
  read-only for clients (presence subcollection aside).
- 🟡 **Meetings list is unbounded + N+1**: fetches every meeting ever, then
  one `effectiveness_scores` read per meeting. The composite index for
  `team_id + started_at DESC` already exists and is unused. Add
  `orderBy started_at desc, limit(~26)` to both the server query and the
  client subscription, and consider denormalizing `avg_rating` onto the
  meeting doc at conclude.
- 🟡 **Completed meetings fetch full recap data on every load** even with the
  modal closed (4 team-wide collection scans). Gate on `recap === "1"` or
  read the future denormalized snapshot.
- 🟡 **`resolved_at` is stamped for `dropped` and never cleared on reopen** —
  dropped issues vanish from recap stats entirely (no "Issues Dropped"
  section), and a reopened issue keeps a stale `resolved_at`.
- ✅ **Scorecard 30-metric cliff (fixed 2026-08-03)**: entry loads now chunk
  via `lib/scorecard-entries.ts` + `useScorecardEntries` (server page,
  meeting SSR, L10 segment). Rows past metric 30 get real values instead of
  silent dashes.
- 🟡 **Subscription failures are console-only** (`use-collection.ts`) — if
  rules/indexes aren't deployed, the app looks fine but never updates.
  `LiveAuthBanner` covers the missing-client-auth case; other permission
  errors still need a small in-UI indicator.
- ⚪ **Legacy docs missing `visibility`** don't match the `== "team"` filters
  anywhere (consistent since tonight's payload fix, but they're invisible).
  One-off backfill script if any exist in prod.
- ⚪ **Dead code**: `components/l10/advance-button.tsx` (superseded by the
  rail transport — its "conclude → Finish" handling was reimplemented there
  tonight), `lib/dates.ts durationMinutes` (signature incompatible with
  callers' Timestamps), `jumpToSegment` server action (rail peeks locally
  instead). Wire up or delete.
- ⚪ **`meetings/{id}/presence` rules exist, nothing writes it** — a "who's
  in the room" dot was evidently planned; attendance stays manual until then.
- ⚪ **Clocks trust the client's clock** (`Date.now()` vs server timestamps).
  A skewed presenter laptop shows a wrong countdown. Server-time offset
  correction is straightforward if it ever bites.

---

## Demo-morning checklist (no code)

1. `pnpm seed <your-login-email>` for clean data (restores vote credits too —
   relevant now that concluding a practice meeting clears them).
2. Two-browser smoke test **on the prod project**: votes, "Discussing now"
   pin, segment advance, and the new live ratings all sync between windows —
   this also proves rules/indexes are deployed (subscription failures are
   silent).
3. Walk the full flow once: Start → all 7 segments → capture a to-do in
   To-Dos → drop an issue from Rocks → Finish → recap opens on both windows.
4. Note the intentional behavior changes: Next is disabled on Conclude
   (Finish ends the meeting), votes reset at conclude, rocks filter is now
   All + members, rock/issue titles click open detail modals.
