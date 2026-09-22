# Rock & milestone sharing — ruleset

Status: **confirmed with daniel 2026-09-22, built on `fix/improved-rock-sharing`
(uncommitted at time of writing).** Two items still need the client — see
[Open for the client](#open-for-the-client). Supersedes the per-team share
*levels* in `docs/ROCK_MILESTONE_PLAN.md` (Workstream B) and answers roadmap
**N65** (three-tier sharing) and **N66** (org-wide milestone assignment).

Code of record: `lib/rocks-share.ts` (rules, pure + tested in
`lib/rocks-share.test.ts`). Every surface calls into it; nothing re-derives
the rules locally.

---

## The rules

There are three ways to see a rock, and one way to hold something back.

| # | How someone gets access | What they see |
|---|---|---|
| 1 | **Parent team** — the team the rock belongs to | The whole rock: every milestone (locked ones too) and progress |
| 2 | **Team share** — the rock is shared with another team | The whole rock, same as the parent team. There is no partial team share |
| 3 | **Assignment** — someone is assigned a milestone on the rock | **That person:** the whole rock. **Their teams** (if the person is *not* on the parent team, and the team has no share): the rock's title plus *only that person's* milestones, no progress |
| — | **Lock** a milestone ("Kept off team") | That milestone does not travel to the assignee's teams. It hides nothing from anyone in rows 1–2 or from other assignees |
| — | **Keep on this team** (whole rock) | Every milestone is treated as locked, including ones added later. Cannot be combined with team shares |

Org admins and the **rock's owner** always get the whole rock (row 1
behaviour) — the owner even off the parent team, since they can tick every
milestone and move its status.

**Keep on this team is not the same as locking every milestone.** Both stop
milestones travelling; only Keep on this team also blocks team shares and
covers milestones added later. Lock-all is per milestone and leaves sharing
alone.

**The lock is inert, and shown greyed, when it would hide nothing:** the
owner is on the parent team ("On this team"), every team the owner is on
already has the whole rock ("Team has rock"), or the rock is kept on its team
("Kept on team").

### Precedence

- **The broadest access wins.** A team that is both shared (row 2) and reached
  through an assignment (row 3) gets the whole rock.
- **Unsharing a team is not all-or-nothing.** If someone on that team still
  holds an unlocked milestone, the team drops back to row 3 — the rock's title
  and that person's milestones — rather than losing the rock entirely. The
  save review says so.
- **A person on several teams** passes their unlocked milestones to *all* of
  their teams that lack a share.
- **Parent-team members' milestones never travel** (option A — see open item
  2). Someone on the parent team who also sits on other teams does not carry
  the rock onto those teams by owning a milestone.

### Worked example

Joe is on Operations Support. The rock "Vendor migration" belongs to
Enterprise Systems & Data (ESD) and is shared with nobody.

| Action | Joe sees | Operations Support sees | ESD sees |
|---|---|---|---|
| Assign Joe milestone "Contract signed" | Whole rock | Title + "Contract signed", no progress | Everything |
| …lock "Contract signed" | Whole rock | Nothing | Everything |
| …instead share the rock with Operations Support | Whole rock | Whole rock | Everything |
| …then unshare Operations Support (milestone unlocked) | Whole rock | Back to title + "Contract signed" | Everything |
| Turn on **Keep on this team** | Whole rock | Nothing | Everything |

---

## Where a rock appears

| On a team's Rocks page / L10 | Placement |
|---|---|
| The team's own rock | Company → Team → by owner, as before |
| A rock **shared** with the team, owner on this team | Under the owner's section, tagged "from {team}" |
| A rock **shared** with the team, owner elsewhere | **Shared by {owner}** section at the bottom |
| A rock the team sees **through an assignment** | Under **each assignee's own section** ("each person's list shows what they carry"), tagged "from {team}", showing only that person's milestones and no progress. Never in "Shared by" — that section is for full team shares only |

If two people on the same team carry milestones on one rock, the rock appears
under each of them, each time with that person's milestones only.

**Your own milestones always appear in your own section on your team's Rocks
page and L10** — locked ones and Keep-on-this-team rocks included — and only
for you. Both render per viewer, so teammates still see only what travels.
Anything only you see is **greyed with an "Only you" tag**: a locked milestone,
and the whole row when it is there only because of your locked milestones.
This is what lets an assignee from outside the rock's teams find and tick a
locked milestone. (Parent-team members use the parent team's page.) **While you hold the
wheel in an L10**, your "Only you" items are hidden from your screen — it is
the room's screen then.

**Home** shows every rock the viewer has in full (their own, their teams',
shares, and any rock they carry a milestone on) — always the whole rock. The
**To-Dos page** carries every milestone assigned to you, including ones on
other teams' rocks, in its milestone column.

The **detail and edit views** of an assignment row show the whole rock to a
viewer who has it in full (parent/shared team, admin, or an assignee), and
only the row's milestones to anyone else.

---

## Who can do what

| Action | Who |
|---|---|
| Edit the rock, add / rename / re-date / delete milestones, change sharing | Parent team members and org admins |
| Tick a milestone | Parent team / admin: any. Everyone else: **their own** milestone, or any milestone on a rock **they own**. Your own milestones are tickable on **Home** too |
| Move the rock's status | Parent team / admin; the rock's owner from a team it is shared into |
| Set the Company flag | Org admins only (unchanged) |

Seeing the whole rock (as an assignee) is not editing it.

**Comments:** a rock has **one thread**, filed under its parent team,
readable and postable by everyone with the whole rock and by nobody else.
Authors from other teams are named across the thread.

**Activity and notifications:** ticking a milestone is filed under the
**rock's team** as the person who ticked it, whichever team's page they
ticked it from. Being assigned a milestone sends the assignee an "assigned"
notification, which opens for them even off the rock's team.

---

## Assigning a milestone owner

The owner picker has two tabs:

- **{Parent team name}** — only the parent team's own people. Deliberately
  *not* the teams the rock is shared with: listing them would show anyone
  opening the picker where the rock has been shared.
- **Whole org** — everyone on any team, A–Z, each with their teams listed;
  search matches a name or a team name. The list is prefetched when the rock
  modal opens.

A gold dot on the owner button marks someone outside every team that has the
rock in full. The server accepts any owner who is on at least one team.

---

## The save review

A dialog appears before the save commits:

- **Adding a rock — always.** Leads with the parent team ("Only this team sees
  the rock" when nothing else applies).
- **Editing — only when who-sees-what changes:** a team is shared; someone
  outside the rock's teams is assigned (they get the whole rock); a milestone
  newly reaches a team through an assignment; or an unshared team still sees
  part of the rock.

Narrowing (unsharing with nothing left, locking, removing an assignee) saves
without asking.

---

## Data model

| Field | On | Meaning |
|---|---|---|
| `shared_team_ids: string[]` | rock | Teams with a full share. Max 8 (firestore.rules checks by index) |
| `team_only: boolean` | rock | Keep on this team. Mutually exclusive with shares (server refuses both) |
| `team_hidden: boolean` | milestone (to-do with `source_rock_id`) | Locked — doesn't travel to the assignee's teams |
| `milestone_owner_ids: string[]` | rock | Owners of every milestone, rewritten on each save — lets firestore.rules grant assignees the rock doc, its comments and status history |
| `share_levels` | rock | **Retired.** Removed on the next save of any rock |

Milestones are always written `visibility: "team"`. The to-do `"private"`
setting means owner-only everywhere (Home, notifications, rules), which is not
what a lock means; a legacy milestone saved as `"private"` reads as locked.

Assignment visibility is **worked out when a page loads**, from current team
membership — not stored. If Joe moves teams, his milestones follow him.

## Enforcement

- **Server (the real gate).** Pages load through the Admin SDK and filter with
  `lib/rocks-share.ts`: `assignmentCarriers` (row 3), `hasFullRockView`,
  `canTickMilestone`. Saves validate owners and the share/keep-on-team
  exclusion in `rocks/actions.ts`; ticks go through `canTickMilestone` in
  `todos/actions.ts`.
- **Firestore rules (backstop for client reads).** `rockFullAccess` mirrors
  `hasFullRockView` (parent team, shared team, owner, assignee via
  `milestone_owner_ids`) for the rock doc, its status history and its comment
  thread. A person can always read a milestone assigned to them. Row-3 teams
  get their view from the server, never a client read.
  **`firestore.rules` changed and must be deployed with the app.**

---

## Open for the client

1. **Placement of assignment rows.** Currently under each assignee's own
   section, never under "Shared by". Confirm that is how they want to read
   it.
2. **Do parent-team members' milestones travel? (A vs B)**
   - **A — built:** no. Only assignees from outside the parent team carry a
     rock onto their other teams.
   - **B:** yes — one rule for everyone ("a milestone's owner's teams see it
     unless locked"), less code, and a person's section shows everything they
     carry. Cost: the default milestone owner is whoever owns the rock, so
     multi-team people's rocks (including leadership rocks) appear on their
     other teams by default; **Keep on this team** becomes the way to stop
     that for sensitive rocks.
   Question to put to them: *should a person's section on a team page show
   everything they're carrying across the org?* Yes → B. No → A.
3. **Assignee sees the whole rock.** Confirmed internally; worth stating to
   the client, since assigning one milestone shows that person every other
   milestone on the rock, and its comment thread.

## Known limits

- On the **L10**, rocks a team sees through assignments load with the page
  and don't update live mid-meeting; their status history isn't shown.
- On the **L10**, "Only you" items follow the wheel, not screen-sharing: a
  viewer who shares their screen without taking the wheel still shows them.
- There is no rock-level activity feed yet; milestone ticks land in the
  milestone's own trace.
