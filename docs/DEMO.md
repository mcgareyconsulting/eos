# EOS — 5–10 Minute Walkthrough

A scripted demo of the High Plains Bank EOS app. The arc: **see the operating
system at a glance → run a live Level 10 meeting → turn a problem into an
owned action → wrap with a recap.** Total core run: ~9 minutes.

> **The story you're telling:** "You're on High Plains Bank's leadership team.
> This one app runs your week — your numbers, your quarterly goals, your
> problems, and the 90-minute meeting that keeps it all moving."

---

## Before you start (2-min prep)

1. **Load clean demo data** (idempotent — safe to re-run between demos):
   ```bash
   pnpm seed <your-login-email>
   ```
   (Pass the email — or UID — of the account you sign in with, so the data
   lands on a team you're actually a member of.)
   This fills *every* screen: 4 teammates, rocks + milestones, an 8-week
   scorecard, ranked issues, to-dos, headlines, and one completed meeting.
2. **Sign in** at <http://localhost:3000/login> with the demo leader account,
   land on **Home**.
3. **Mic (optional):** the Assistant takes voice *or* typed input — typing is
   fine and more reliable on a projector.
4. **Optional wow-factor:** open a second browser (incognito) signed in as a
   teammate and put it side-by-side — votes and the "Discussing now" pin sync
   live between the two during IDS.

Keep the left sidebar visible — it's your map: Home, Scorecard, Rocks, To-Dos,
Issues, Headlines, Meetings, Members.

---

## Run of show

Each beat lists what to **DO** and what to **SAY**. Times are cumulative.

### 0:00 — Home · "Everything I own, in one place"
- **DO:** Start on `/home`. Point at the three groups: Active To-Dos, Rock
  Milestones, Active Rocks. Note the red overdue date and the "You" labels.
- **SAY:** "Monday morning, this is my cockpit — every open commitment across my
  teams, mine first, soonest due at the top. Nothing falls through the cracks."

### 0:45 — Scorecard · "The numbers that matter, weekly"
- **DO:** Sidebar → **Scorecard**. Scan the 8-week grid. Point at a green
  trend (Net Promoter Score climbing) and a **red** average (30-day delinquency
  rate is over goal). Click one cell to show inline editing, then `Esc`.
- **SAY:** "Seven KPIs, eight weeks, each with an owner and a goal. Green is on
  track, red isn't. The delinquency rate is trending the wrong way — hold that
  thought, we'll deal with it *in the meeting*, not in a hallway."

### 1:45 — Rocks · "Quarterly goals, owned"
- **DO:** Sidebar → **Rocks**. Show My Rocks vs Team Rocks, statuses
  (on-track / off-track / done / cancelled). Expand a rock to reveal its
  **milestones** (checked + upcoming). Click a status chip to show the popover.
- **SAY:** "Rocks are our 90-day priorities. Each has one owner and a clear
  status. The acquisition integration is **off-track** — again, an issue for the
  meeting."

### 2:45 — Issues · "The list we actually work"
- **DO:** Sidebar → **Issues**. Show issues ranked by team votes, mixed
  statuses (Open / Solving / Solved / Dropped).
- **SAY:** "Every problem, prioritized by the team's votes. We don't solve these
  ad hoc — we solve the top ones, together, in the Level 10."

### 3:15 — Start the Level 10 · "The 90-minute heartbeat"
- **DO:** Sidebar → **Meetings**. Note the one completed meeting with its team
  rating (gold star). Click **Start meeting**. The live orchestrator opens on
  **Segue** with the agenda timer running.
- **SAY:** "This is the engine. A timed, 90-minute agenda the team runs every
  week. Same order, every time — that consistency is the whole point of EOS."

### 3:45 — Scorecard & Rocks segments · "Drop problems into the list"
- **DO:** Advance to the **Scorecard** segment (top nav / Next). On the
  off-track delinquency metric, click **"+ Issue"** (top-right) — it pre-fills
  *"Off-track metric:"*. Add it. Advance to **Rocks**; do the same on the
  off-track acquisition rock (*"Off-track rock:"*).
- **SAY:** "As we review the numbers and the rocks, anything off-track gets
  dropped straight onto the Issues list — one click — so we keep moving instead
  of rat-holing."

### 4:45 — IDS · "Identify, Discuss, Solve" *(the core)*
- **DO:** Advance to **IDS**. 
  - **Vote:** click **+** on the top one or two issues (you have 3 credits;
    you can stack). Watch the list re-rank by votes. *(If you opened a second
    teammate window, vote there too and show the counts update live.)*
  - **Discuss:** click **Discuss** on the top issue — it pins to the top with a
    blue "Discussing now" badge for everyone in the meeting.
  - **Solve:** once "talked through," click the **✓** to mark it **Solved**.
- **SAY:** "We vote so we spend our hour on what matters most. We pin what we're
  discussing so the whole room — and anyone remote — stays in sync. Then:
  identify the *real* issue, discuss, solve. Solving it isn't the end though —
  someone owns the next step."

### 6:00 — Assistant · "Capture the action by voice"
- **DO:** Click the round **Assistant** button (bottom-right). Type or say:
  > "Add a to-do for Tom to pilot automated doc intake by Friday."

  The Assistant replies with a **proposed** to-do card. Click **Apply / Confirm**.
- **SAY:** "Here's where it gets modern. I just *tell* it the follow-up — by
  voice or text. It drafts the action with the right owner and due date, and
  **nothing is written until I confirm**. That's the guardrail: AI proposes, a
  human commits."
- *(Optional second prompt:)* "What rocks are off track?" — show it answers from
  real team data, not guesses.

### 7:15 — Conclude & End · "Recap + rate the meeting"
- **DO:** Advance to **Conclude**. Show the notes field and the **peer
  effectiveness** scoring (rate teammates 1–10). Click **End meeting** — the
  **Recap** modal opens automatically.
- **SAY:** "We close by capturing cascading messages and rating the meeting 1 to
  10 — EOS holds the meeting itself accountable."

### 8:15 — The Recap · "Proof the hour produced something"
- **DO:** In the recap, point at: the new to-do (Tom's), the issue(s) solved,
  the solve-rate stat, and the per-person ratings.
- **SAY:** "In one screen: what we created, what we solved, and how we performed
  — all auto-generated. The team leaves with owned actions, not vibes."

### 9:00 — Wrap
- **SAY:** "Numbers, goals, problems, and the meeting that drives them — one
  system, GCP-native, with an AI assistant that respects a human in the loop.
  That's the whole operating system in ten minutes."

---

## Talking points / differentiators

- **It's the *meeting*, not just the data.** Most tools store EOS artifacts;
  this one *runs the L10 live* with a shared timer and synced state.
- **AI proposes, humans commit.** The Assistant never writes silently — every
  change is a card you confirm. Easy story for a risk-conscious bank.
- **GCP-native.** Firestore + Firebase Auth + Cloud Run + Gemini — fits HPB's
  existing Google stack; no new vendor.
- **Live & multiplayer.** Votes, the "Discussing" pin, and segment changes sync
  across everyone in the meeting in real time.

## If asked "what's not built yet?"
Be upfront: the **V/TO** (Vision/Traction Organizer) and the **Accountability
Chart** are the two classic EOS pieces not yet in the MVP. Everything in the
weekly operating cadence — Scorecard, Rocks, To-Dos, Issues, Headlines, and the
L10 — is here.

## Reset between demos
```bash
pnpm seed <your-login-email>      # clears this team's data and re-seeds clean
```
The seed only touches the demo team — it never deletes other teams' data.

## Troubleshooting
- **Screens empty / "not assigned to the team"?** You seeded under a different
  account than the one you sign in with. Re-run `pnpm seed` with your **login
  email** — it attaches your account to the Demo Team as a leader.
- **Owner shows "—" instead of your name?** Re-run the seed — it backfills your
  `/users` profile from your Auth account.
- **Mic blocked?** Just type into the Assistant instead; same behavior.
- **No teammate window?** The live-sync beat is optional — the single-screen
  flow stands on its own.
