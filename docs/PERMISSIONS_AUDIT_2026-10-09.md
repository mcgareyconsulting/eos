# Permissions & sharing audit — 2026-10-09

**Scope:** who can see, edit and share what across the app, as the code
stands on `main` at `2b1eb5c`. Read-only audit; nothing changed. This is the
baseline for the sharing/permissions restructure.

**How enforcement works (read this first).** Every page and server action
runs on the Firebase Admin SDK, which **bypasses `firestore.rules`**. The
server guards in `lib/firebase/teams.ts` are the real gate:

| Guard | Admits |
|---|---|
| `requireTeamAccess(teamId)` (`teams.ts:20`) | any member of the team, or an org admin |
| `requireTeamLeader(teamId)` (`teams.ts:71`) | a team leader, or an org admin |
| `requireAdmin()` (`teams.ts:95`) | org admins (`role: "admin"` custom claim) only |
| `requireTeamDoc` (`teams.ts:110`) | checks the entity really lives on that team |

`firestore.rules` governs only the browser's live `onSnapshot` listeners. Any
signed-in user can also reach it directly with the public Firebase web config
from a browser console. Wherever the rules are **looser** than the server,
the server's policy can be bypassed. Section 4 lists those spots.

**Roles today:** org admin (custom claim) · team leader · team member
(`team_members.role`). There is no Owner/Implementer tier, no private team,
and no per-object role (viewer/editor).

---

## 1. One-page summary

- **Almost everything is team-wide.** Any team member can edit or delete any
  rock, issue, headline, scorecard metric or team-visible to-do on that team.
  "Leader" gates only roster management, agendas, meeting settings, deleting
  meetings, data import, and editing private to-dos.
- **Any member, not just leaders, can share outward.**
  - Rocks: any parent-team member can share to any team in the org, up to 8,
    and can assign a milestone to anyone in the org. Either one gives the
    recipient the whole rock.
  - Scorecard: any member can pull another team's metric onto their board.
    The home team isn't asked and can't revoke a single borrower.
- **The org-wide surfaces are broad.** Every signed-in user sees:
  - every team, roster, email, and leader/admin flag (the Directory);
  - **every team's scorecard metric names and ~26 weeks of values**, through
    the "Add existing" picker.
- **Private to-dos leak in four places.**
  - The meeting recap shows them.
  - Their comment threads are readable by the whole team (rules).
  - Activity history from before a to-do went private stays team-readable.
  - Leaders and admins can edit or publish private to-dos they can't see.
- **The rules are looser than the server** on rocks, to-dos, issues,
  headlines, scorecard and `users`. Server-only policies (admin-only Company
  flag, 8-share cap, archive stamps, home-team-only writes, owner-only
  delete) can be bypassed from a browser console.

---

## 2. Who sees what

✅ full · ◐ partial · ✏️ can edit · 🔗 can widen access to others · — none

### Org structure & identity

| Capability | Org admin | Team leader | Team member | Any signed-in user |
|---|---|---|---|---|
| See all team names | ✅ | ✅ | ✅ | ✅ (`teams.ts:215`) |
| Directory: every person, email, team, role, admin flag, "never signed in" | ✅ | ✅ | ✅ | ✅ (`directory.ts:59-117`, no gate) |
| Create / rename team | ✏️ (`admin/actions.ts:379,433`) | — | — | — |
| Delete team | CLI only (`scripts/delete-team.ts`) | — | — | — |
| Add member to team | ✏️ any team | ✏️ own team, **any allowlisted email** (`directory/roster-actions.ts:27`) | — | — |
| Remove member / change role / promote to leader | ✏️ | ✏️ own team, incl. demoting/removing other leaders; last-leader guard only (`roster-actions.ts:61-150`) | — | — |
| Grant org admin | ✏️ (`admin/actions.ts:104`); no last-admin guard | — | — | — |
| CSV user import | ✏️ (`admin/import/actions.ts:37`) | — | — | — |
| Team data import | ✏️ | ✏️ own team; can create phantom roster users (`lib/team-import/owners.ts:156`) | — | — |
| Read `audit_log` | rules only, no UI | — | — | — |
| Edit own `users` profile (any field) | — | — | — | ✏️ via rules (`firestore.rules:84`) |

### Rocks & milestones (`lib/rocks-share.ts`, `rocks/actions.ts`)

| Actor | Sees | Edits | Shares / widens |
|---|---|---|---|
| Org admin | whole rock | everything; only one who can set Company flag (`actions.ts:328`) | 🔗 |
| Parent-team leader **or member** | whole rock incl. locked milestones | ✏️ everything (gate is `requireTeamAccess`, not leader) | 🔗 share to **any org team** (`actions.ts:459`), assign milestones to **anyone rostered anywhere** |
| Shared-team member | whole rock, comments, history | ticks own milestones only | — |
| Milestone assignee (off-team) | whole rock + comment thread | ticks own milestone | — |
| Assignee's teammates ("row 3") | intended: title + that person's unlocked milestones. **Actual: also description, status, due date** (`rock-row.tsx:347`, L10 `mapRock`) | — | — |
| Rock owner (off-team) | whole rock | ticks any milestone; status only via a shared team | — |
| Anyone else | — | — | — |

### Scorecard (`lib/scorecard-share.ts`, `scorecard/actions.ts`)

| Actor | Sees | Edits | Shares |
|---|---|---|---|
| **Any member of any team** | **"Add existing" catalog: every active metric org-wide, with team, owner, goal and ~26 wks of values** (`scorecard-catalog.ts:92-115`) | — | 🔗 pull any metric onto own team, no consent (`actions.ts:420`) |
| Home-team member | all | ✏️ name/goal/owner/values of **any** home metric; archive/delete only if metric owner | — |
| Borrowing-team member | metric + values | own grouping only; **any member can detach** | — |
| Home team revoking one borrower | — | **not possible** (archive hides from everyone) | — |

### To-dos, issues, headlines, comments

| Object | Who sees | Who edits/deletes | Notes |
|---|---|---|---|
| Team-visible to-do | team | any member | reassign limited to roster |
| Private to-do | owner (pages hide it even from admins) | owner, **plus leaders/admins who can't see it**, incl. flipping it to team-visible (`lib/todo-access.ts:26`) | any member can create a private to-do *for* someone else |
| Issue | team | **any member can edit, archive, or delete with its votes and comments** | no private concept, no move-to-team action |
| Headline | team | any member | cascading isn't built (`target_team_ids` always `[]`) |
| Comment | team (rules); private to-do threads owner-only on the server only | author-only delete; no moderation | @mentions limited to the team roster |
| Notification | recipient only | recipient | fan-out to `follower_ids` |
| Google Tasks mirror | owner's own Google account | — | titles stay behind in Google after reassign or rock delete |

### Meetings (L10)

| Capability | Who |
|---|---|
| View any past meeting + recap | any team member, no time limit |
| **Individual ratings + written notes** | **every team member, by name**. Not anonymous. Visible live during Conclude (`[meetingId]/page.tsx:136-158`) |
| Start / take the wheel | any member, any time (driver model is advisory) |
| Mark anyone absent (removes their rating from the average) | any member (`meetings/actions.ts:657`) |
| Reorder speaking order | any member; **permanently overwrites the team's order** (`actions.ts:425`) |
| Agendas, meet link, team speaking order, delete meeting | leader / admin |

---

## 3. Findings — ranked

### High: privacy leaks or privilege escalation

1. **Meeting recap shows other people's private to-dos.** The recap filter
   checks the time window and `!source_rock_id`, but not `visibility`.
   *Fix:* add `x.visibility === "team"` (or owner == viewer).
   `meetings/[meetingId]/page.tsx:255-260`.
2. **A leader can rewrite any org user's name or email.** Adding someone
   to a team does `users.set({display_name, first_name, last_name, email},
   {merge:true})` with whatever the leader typed, and the Directory shows it
   org-wide. *Fix:* only write the profile when it doesn't exist yet.
   `lib/team-invite.ts:63-73`.
3. **Demoted admins keep god-mode for up to 12 h.** `setOrgAdmin` changes
   the claim but doesn't call `revokeRefreshTokens`. The session cookie keeps
   `role:"admin"` until it expires or renews. *Fix:* revoke on any claim
   change. `admin/actions.ts:104-120`.
4. **`users/{uid}` is self-writable on any field.** Nothing trusts
   `users.role`, so this isn't an escalation. But a user can spoof their
   name or email org-wide, or set `deactivated_at` to hide from the
   Directory. *Fix:* `affectedKeys().hasOnly([...])`, or no client write at
   all. `firestore.rules:84`.
5. **Private to-do comment threads are team-readable.** The server limits
   private threads to the owner, but the `entity_comments` read rule is
   team-scoped. `firestore.rules:291-294` vs `entity-comments/actions.ts:69-75`.
6. **The org-wide scorecard catalog exposes real numbers.** Any member of
   any team sees every metric's values without attaching it. This was a
   recorded product decision (2026-09-09, `scorecard-catalog.ts:70-81`), but
   it's the widest data exposure in the app. **Revisit with HPB.**
7. **Row-3 rock viewers see more than the rule promises.** The description,
   status and due date render for assignment-only teams.
   `rocks/page.tsx:291-343` → `rock-row.tsx:347`; L10 `mapRock`.

### Medium: missing gates or inconsistent policy

8. **Sharing outward isn't leader-gated anywhere.** Any member can:
   - share a rock to any org team;
   - assign an org-wide milestone owner (that person gets the whole rock);
   - borrow or detach a scorecard metric;
   - add a follower.
9. **Rock `owner_id` is only loosely validated.** It's checked only as the
   fallback owner of milestones. With no milestones, or with every milestone
   explicitly owned, any uid is accepted, and the owner gets full view plus
   tick-all. `rocks/actions.ts:288-311`.
10. **`milestone_owner_ids` drifts.** It's rewritten only on a rock save.
    Reassigning or deleting a milestone from the To-Dos drawer leaves the old
    assignee with client read of the rock, comments and history, and gives
    the new one none.
11. **Leaders can take over a team.** A leader can promote an ally and
    demote or remove every other leader. Nothing caps or audits it in-app.
    `roster-actions.ts:109-150`.
12. **Leaders can add any allowlisted person to their team** with no consent
    or approval. That grants all of the team's data at once.
13. **Private to-do edge cases.**
    - Leaders and admins can edit or un-private items they can't see.
    - Old followers are reactivated when a to-do flips back to team-visible
      (`todos/actions.ts:410`).
    - Activity rows stamped "team" before the flip stay readable
      (`lib/activity.ts:87`).
14. **Meeting ratings aren't anonymous**, and peers' ratings are visible
    before you submit your own. The comment "clients only read aggregates"
    is wrong.
15. **Any member can mark others absent**, which drops their rating from
    the average, and can permanently reorder the team's speaking order.
16. **Any member can delete an issue** with all its votes and comments.

### Rules looser than the server (bypassable from a browser console)

17. **Rocks** (`firestore.rules:195-199`). There's no field freeze, so a
    member can write directly:
    - `is_company_rock` (meant to be admin-only);
    - `shared_team_ids` (past the 8 cap, to any team);
    - `team_only`, `owner_id` and `milestone_owner_ids`.
18. **To-dos, issues and headlines don't freeze `team_id`.** A member can
    move an item onto another team, including one they aren't on. They can
    also write `follower_ids` to add an off-team user, who then receives
    notification titles and snippets.
19. **Scorecard metrics.** Any home member can:
    - delete or archive any metric (the server allows only the metric's owner);
    - rewrite `shared_team_ids` with no cap;
    - write entries to archived metrics.
20. **`rock_status_updates` create doesn't check `rock_id`.** A member can
    inject status history onto any rock.
21. **Headlines.** Members can edit or delete broadcast copies, which the
    server blocks.
22. **Admins can read every private to-do, comment and activity row**
    through the rules, though the pages hide them.

### Low / hygiene

- `inDomain()` hard-codes `daniel@mcgareyconsulting.com` (`firestore.rules:35`).
  The header says consultant access is IAM-only, and this line contradicts it.
  Remove it, or keep it in lockstep with `SIGN_IN_ALLOWLIST`.
- An empty `SIGN_IN_ALLOWLIST` means **open sign-in**. Terraform only checks
  that a secret version exists, not that it's non-empty
  (`terraform/cloud_run.tf:96`). Fail closed in prod.
- Nothing guards against demoting the last org admin.
- The 9th rock share is dropped silently (`rocks/actions.ts:377`); it doesn't
  raise an error.
- Google Tasks: mirrored titles stay in the old owner's or a deleted rock's
  owner's Google account.
- Deleting a meeting orphans its `presence` docs. The `presence` client write
  path is unused but open.
- `loadAssignedRocks` over-fetches every to-do of every roster member on each
  Rocks/L10 render (server-only, a cost issue rather than a leak).

### Confirmed OK

- Cross-team edits are blocked: `requireTeamDoc` runs on every mutation.
- Team create and rename are admin-only. Teams can't be deleted from the app.
  There's no join-request flow.
- The Company flag is admin-only on the server.
- Notifications are recipient-only. Mentions are limited to the roster. The
  Google Tasks connect/pull routes are CSRF- or secret-gated.
- The `meetings`, `issue_votes`, `notifications`, `entity_activity` and
  `audit_log` collections have no client write path.
- Nothing exports to BigQuery yet. The weekly Auth export goes to a private
  GCS bucket and includes every email and the admin flags.

---

## 4. Decisions needed for the restructure

These are product questions for HPB. The code can follow any answer.

1. **Who may share outward?** Today any member can share a rock, assign an
   org-wide milestone owner, or borrow a metric. Options:
   (a) leaders and admins only;
   (b) any member, but the target team's leader approves;
   (c) keep it open and add an audit trail.
2. **Scorecard catalog.** Keep org-wide discovery with values, show names
   only until attached, or limit it to teams you're on / that opted in.
   Should the home team be able to revoke a single borrower?
3. **Directory.** Keep the org-wide "soft directory", or hide emails, admin
   flags and "never signed in" from non-admins? Do private teams exist
   (already in the backlog: *private-team flag*)?
4. **Richer role model.** Owner/Implementer see all teams read-only
   (backlog). Is that a new claim, separate from admin?
5. **Leader powers.** Can a leader demote or remove other leaders, and
   promote anyone? Or is that admin-only?
6. **Private to-dos.** Should leaders and admins be able to act on items
   they can't see? Should admins be able to see them at all?
7. **Meeting ratings.** Anonymous to peers (driver/leader sees names)?
   Hidden until you've rated?
8. **Edit vs view within a team.** Should any member be able to delete
   issues, metrics or rocks, or only owners and leaders?

## 5. Suggested fix order (no client decision needed)

1. Recap private-to-do filter (#1). One line.
2. Stop the profile overwrite in `writeMembership` (#2).
3. `revokeRefreshTokens` on admin-claim change and on person removal (#3).
4. Tighten `firestore.rules` to match the server:
   - `users` field allowlist;
   - freeze `team_id` everywhere;
   - rocks/metrics: no client writes at all, since no client path exists;
   - `entity_comments` private-thread read;
   - `rock_status_updates` `rock_id` check;
   - drop the consultant email.
5. Row-3 rock view: strip description, status and due date server-side (#7).
6. Validate the rock `owner_id` against rosters (#9). Sync
   `milestone_owner_ids` from the to-do actions (#10).
7. Fail-closed `SIGN_IN_ALLOWLIST` and a last-admin guard.
