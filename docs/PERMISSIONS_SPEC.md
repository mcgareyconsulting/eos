# Permissions and sharing specification

Writing standard: ASD-STE100 (Simplified Technical English). Words in
**bold** in section 1 are technical names. They have only the meanings that
section 1 gives.

**Status:**

- This is version 2 for review. Version 1 was agreed on 2026-10-09.
- The team did not build this specification yet.
- The production application uses the rules in `docs/ROCK_SHARING_RULES.md`
  (commit `8193fa7`).
- The audit for this specification is in
  `docs/PERMISSIONS_AUDIT_2026-10-09.md`.

---

## 0. Changes from version 1 (for review)

1. **Four access shapes.** All data types use one of four access shapes
   (section 3). Threads, mentions and notifications use the shape of their
   item. They have no separate rules.
2. **A milestone is a to-do.** A milestone is a to-do with a link to a rock.
   It uses the to-do thread and the to-do notifications. There is no separate
   milestone thread.
3. **Leaders have no special permissions on private to-dos.** Only the
   creator, the assignee and admins can see or change a private to-do.
4. **Each milestone always has an assignee.** The default assignee is the
   rock owner. A milestone is unassigned only after an admin deactivates its
   assignee, until a person reassigns it (section 2.6).
5. **One function is postponed.** The team that owns a public metric cannot
   remove one tracking team. To stop all tracking, make the metric private.
6. **Deactivated persons.** When an admin deactivates a person, all items
   that the person owns become unassigned (section 2.6).
7. **Follow applies to to-dos, milestones, rocks, issues, metrics and
   headlines.** You can follow only what you can see. The owner and the
   assigner of an item cannot stop following it (section 5.3).
8. **The audience can change the rock.** The audience can change the rock
   and its milestones, as the parent team can. Only leaders of the parent
   team and admins can change the audience (section 3.3).
9. **A block is read-only.** A block shows a milestone. It does not give
   access to the milestone (section 4).
10. **Members can make a metric public.** A leader is not necessary
    (section 3.4).

---

## 1. Technical names

| Name | Meaning |
|---|---|
| **admin** | A person with the `role: "admin"` custom claim. There are one or two admins. |
| **leader** | A person with the role `leader` on one team. This role applies only to that team. |
| **member** | A person on the roster of a team. |
| **directory** | The list of all persons and their teams. |
| **parent team** | The team that owns an item. |
| **audience** | The teams and persons that a leader or admin adds to a rock. The audience can see and change the full rock. |
| **full rock** | The rock, all its milestones, its progress, its description, its status history and its thread. |
| **assign** | To make a person the owner of an item. |
| **assignee** | The person that owns an assigned item. |
| **creator** | The person that created an item. |
| **private** | A setting that limits an item to a small group. Section 3 gives the group. |
| **public** | A setting that lets all persons see a scorecard metric. |
| **track** | To add a public metric of a different team to the scorecard of your team. Tracking does not change access and does not make you a follower. |
| **block** | The area of a team page (Rocks page or L10) that shows the items of one member. |
| **thread** | The list of comments on one item. |
| **mention** | A person name with `@` in a comment. |
| **notification** | A message in the application for one person. |
| **follower** | A person who gets notifications about one item. |
| **save review** | The dialog that shows changes to access before the application saves. |

---

## 2. Roles

### 2.1 Admin

The scope of an admin is the full organization. An admin can:

- See and change all data. This includes private items.
- Create and deactivate accounts.
- Give and remove the admin role.
- Promote and demote leaders.
- Create teams and change the names of teams.
- Change the audience of all rocks.
- Import users.

### 2.2 Leader

The scope of a leader is only the teams that they lead. On those teams, a
leader can:

- Add a person from the directory to the team.
- Remove a person from the team.
- Change the audience of a rock.
- Set a rock to private.
- Change agendas and meeting settings.
- Import team data.
- Delete meetings.

### 2.3 Member

On their teams, a member can:

- See all team items.
- Create and change rocks, milestones, to-dos, issues, headlines and metrics.
- Set a metric of their team to public or private.
- Track a public metric.
- Assign to-dos and milestones to persons on all teams.

### 2.4 Rules for roles

- The leader role applies only to one team. If a person leads ESD, they have
  no leader permissions on Ops. This rule also applies to ESD rocks that are
  shared with Ops.
- Only an admin can create or deactivate an account.
- Only an admin can promote or demote a leader.
- A leader can add only a person who is already in the directory.
- The application does not let the last admin be demoted.

### 2.5 Directory

- All persons can see all persons, their teams and their role on each team.
- Only admins can see the sign-in status. The server does not send the
  sign-in status to persons who are not admins.

### 2.6 Deactivated persons

- When an admin deactivates a person, each item that the person owns becomes
  unassigned. This applies to rocks, milestones, to-dos, issues, metrics and
  headlines. For a headline, the owner is the creator.
- The application sends a notification to the leaders of the parent team of
  each item.
- An unassigned item shows "Unassigned" to persons who can see the item.
- A leader or a member of the parent team must assign the item to a new
  person.
- An unassigned item is permitted only in this condition. The application
  does not save a new item or a changed item without an owner. Exception: an
  issue can have no owner.
- If a private to-do has no creator and no assignee that is active, only
  admins can see it.

## 3. The four access shapes

Each data type uses one shape. The shape tells who can see the item, who can
change it, and who can read and write in its thread.

| Shape | Who can see and comment | Who can change | Data types |
|---|---|---|---|
| **A. Team item** | The parent team, the assignee, admins | The parent team, admins. The assignee can complete the item and comment. | Issue, headline, to-do |
| **B. Private item** | The creator, the assignee, admins | The creator, the assignee, admins | Private to-do |
| **C. Rock** | The parent team, the audience, admins | The parent team, the audience, admins | Rock, milestone (also the milestone assignee) |
| **D. Metric** | The parent team, admins. If public: all persons | The parent team, admins | Scorecard metric |

A milestone is a to-do with a link to a rock. A milestone uses the access of
its rock (shape C). The milestone assignee can also see the milestone,
complete it and comment (section 3.3).

### 3.1 Shape A: team item

- The item stays on the parent team.
- The item shows in the lists and the L10 of the parent team.
- **To-do:** a member can assign a to-do to a person on any team. The
  assignee can see the full to-do and its thread.
- **Issue and headline:** you cannot assign these to a person on a different
  team. The owner of an issue must be a member of the parent team. A headline
  has no assignee.

### 3.2 Shape B: private item

- A private item does not show in the lists or the L10 of the team.
- Leaders have no special permissions on a private item.
- Only the creator or the assignee can change a private to-do to a team
  to-do.

### 3.3 Shape C: rock

**Access:**

| If you are | You can see |
|---|---|
| A member of the parent team | The full rock |
| In the audience | The full rock |
| An admin | The full rock |
| The assignee of a milestone on the rock | Your milestone (as a to-do, shape A). Also the title, owner and team of the rock. |
| A member of a team of the assignee | The milestone of the assignee, in the block of the assignee on your team page (section 4). Also the title, owner and team of the rock. This view is read-only. It does not give access (section 4). This does not apply to private rocks. |
| All other persons | Nothing |

**Audience:**

- Only a leader of the parent team or an admin can change the audience.
- The audience can contain teams and persons.
- The audience is the only method to share the full rock.
- The audience can see and change the full rock and its milestones (table
  "Tasks on a rock").
- Members and the audience can see the audience list. They cannot change
  it.

**Milestones:**

- A milestone is a to-do with a link to the rock.
- A member of the parent team can assign a milestone to a person on any team.
- Each milestone must have an assignee. The default assignee is the rock
  owner.
- The owner picker shows a marker next to each person who will see only their
  milestone.
- A milestone is unassigned only after an admin deactivates its assignee
  (section 2.6). An unassigned milestone does not show in a block.

**Rock owner:**

- The rock owner must be a member of the parent team.

**Private rock:**

- Only a leader of the parent team or an admin can set a rock to private.
- A private rock has no audience. When a leader sets a rock to private, the
  application removes the audience.
- The assignee of each milestone on a private rock must be a member of the
  parent team. If not, the application does not save the rock.
- A private rock shows only on the pages of the parent team and on the Home
  page of each member of the parent team.

**Tasks on a rock:**

| Task | Who can do it |
|---|---|
| Change the rock. Add, change and delete milestones. Assign milestones. | Members of the parent team, the audience, admins |
| Change the rock status | Members of the parent team, the audience, admins |
| Complete a milestone | The milestone assignee, members of the parent team, the audience, admins |
| Comment on a milestone and follow it | The milestone assignee, members of the parent team, the audience, admins |
| Delete the rock | Members of the parent team, admins |
| Change the audience. Set the rock to private. | Leaders of the parent team, admins |
| Set the Company flag | Admins |

**Removed functions:**

- The milestone lock (`team_hidden`).
- "Keep on this team" (`team_only`). The new name is `private`.
- `milestone_owner_ids` as a source of read access.

### 3.4 Shape D: metric

- The person who creates a metric selects public or private. The default is
  private.
- Members of the parent team and admins can change the setting at all times.
- A public metric shows on the metric board of the organization. The board
  shows the name, owner, team and values.
- A member of a different team can track a public metric. Then the metric
  shows on the scorecard of their team. That team cannot change it.
- Public, track and follow are three different functions:
  - Public: all persons can see the metric.
  - Track: the metric shows on the scorecard of a different team.
  - Follow: you get a notification when a person posts a new value.
- Members of the tracking team can stop tracking a metric.
- You can track a metric and not follow it.
- You can follow a metric only if it is on the scorecard of one of your
  teams. This is a metric of your team, or a public metric that your team
  tracks. You cannot follow a metric from the metric board.
- When your team stops tracking a metric, you stop following it. When a
  metric becomes private, all followers on other teams stop following it.
- When a metric becomes private, the application removes it from all other
  teams. The application sends a notification to the leaders of those teams.
- The metric owner, leaders and admins can archive or delete a metric.

---

## 4. Team pages and the Home page

A team page (Rocks page or L10) shows the view of the team. It does not show
the view of the person who reads the page.

| Item | What the team page shows |
|---|---|
| The rocks of the team | The full rock |
| Rocks with this team in the audience | The full rock, in the "Shared by" section |
| The block of each member | Each milestone that the member owns on a rock of a different team. The rock must not be private. The block shows the title, owner and team of the rock, and the milestone. |
| Private rocks of other teams | Nothing |

- A block is read-only. It shows the milestone. It does not give access.
- Persons who see a milestone only in a block cannot change it, read or
  write in its thread, follow it, or be mentioned on it. They do not get
  notifications about it.
- Only the milestone assignee can complete a milestone from a block.
- The default assignee is the rock owner. Thus, if a rock owner is on more
  than one team, their rocks show in their block on each of their teams. To
  stop this, a leader sets the rock to private. The private setting shows
  this text: "Private rocks do not show on the L10 of your other teams."
- A rock can show in the "Shared by" section and in a block. This duplicate
  is permitted.
- The Home page shows the view of one person. It shows all full rocks that
  the person can see, and all items that the person owns.

---

## 5. Threads, mentions and notifications

These rules apply to all four shapes.

### 5.0 One system for all items

The thread, mention, follow and notification functions are the same for all
item types. Each function uses an item reference (the type and the ID of the
item). The functions do not contain rules for one type.

Each item type gives only these five values:

| Value | Rock | Milestone | To-do | Issue | Metric | Headline |
|---|---|---|---|---|---|---|
| Shape (access) | C | C, and the assignee | A or B | A | D | A |
| Owner | Rock owner | Assignee | Assignee | Owner | Metric owner | Creator |
| Assigner | Yes | Yes | Yes | Yes | Yes | No |
| Events | Section 5.3 | Section 5.3 | Section 5.3 | Section 5.3 | Section 5.3 | Section 5.3 |
| Link | The rock | The milestone in its rock | The to-do | The issue | The metric | The headline |

To add an item type, give these five values. Do not change the thread,
mention, follow or notification functions.

### 5.1 Threads

- These items have one thread each: rock, milestone, to-do, issue and
  headline.
- A metric has no thread. Persons can follow a metric (section 5.3).
- A person can read and write in the thread only if they can see the item.
- If the access to the item decreases, the access to the thread decreases
  also. This rule applies to old comments too.
- The comment box shows who can read the thread.
- Only the author or an admin can delete a comment. You cannot change a
  comment.
- When a person deletes an item, the application deletes its thread and its
  notifications.

### 5.2 Mentions

- You can mention only a person who can see the item.
- A mention does not give access.
- If a person cannot see the item, the mention list shows their name in grey
  with this text: "Cannot see this item."
- The server refuses a mention of a person who cannot see the item.
- There are only two methods to give access: assign a to-do or milestone to
  the person, or add the person to the audience of a rock. The owner of a
  rock, issue or metric must already be a member of the parent team, so
  these assignments do not give access.

### 5.3 Notifications

For phase 1, notifications are only in the application.

| Event | Who gets the notification |
|---|---|
| A person mentions you | You |
| A person assigns an item to you | You |
| A person removes your assignment | You |
| A leader adds you or your team to the audience of a rock | You, or the leaders of your team |
| An event on an item that you follow (table below) | The followers |
| A metric that your team uses becomes private | The leaders of your team |

**Follow:**

- You can follow these items: to-dos, milestones, rocks, issues, metrics and
  headlines.
- You can follow only an item that you can see. For a metric, the metric
  must also be on the scorecard of one of your teams (section 3.4). Admins
  can follow all metrics.
- When you write a comment on an item, or a person mentions you on an item,
  you follow it automatically. You can stop following it.
- A follower gets a notification for each change to the item.

**Followers who cannot stop following:**

These persons follow an item automatically. They cannot stop following it.

| Person | Meaning |
|---|---|
| The owner | The person who owns the item. For a to-do or milestone, the owner is the assignee. For a headline, the owner is the creator. |
| The assigner | The person who did the current assignment of the item. |

- When a person reassigns an item, the new assigner and the new owner become
  followers who cannot stop following.
- The old owner and the old assigner stay followers. They can stop following.
- All other followers can stop following.

**Events for followers:**

| Item | Events |
|---|---|
| To-do, milestone | A comment. Completed or opened again. A change to the title, due date or description. Reassigned. |
| Rock | A comment. A status change. A milestone is completed. A change to the owner or the due date. |
| Issue | A comment. Solved or archived. A change to the owner. |
| Metric | A new value is posted. A change to the goal or the owner. |
| Headline | A comment. A change to the text. Discussed or archived. |

**Access rules:**

- Before the application sends a notification, it checks the access of the
  recipient. If the recipient has no access, the application does not send
  it.
- A notification contains only a reference: the event, the item, the person
  who did the action, and the time. It does not contain item data.
- When you open a notification, the application checks your access. Then it
  shows the title and the text.
- If you have no access, the notification shows: "You do not have access to
  this item."

---

## 6. Enforcement

- Each shape has one access module. The module is a pure function with
  tests, as in `lib/rocks-share.ts`.
- Server pages, server actions, the mention list and the notification system
  use the access modules. No other code calculates access.
- One item registry gives the five values of section 5.0 for each item type.
  The thread, mention, follow and notification functions use only the
  registry and the access modules.
- The client does not write to Firestore. All writes go through server
  actions. `firestore.rules` refuses all client writes.
- The Firestore rules for client reads must agree with the access modules.
- The application records each change to access: audience, private
  settings, public settings, rosters, leaders and admins. The record shows
  who did the change and when.
- The application records when an admin opens a team that they are not a
  member of.

---

## 7. Security fixes before full production

These fixes are from `docs/PERMISSIONS_AUDIT_2026-10-09.md`. They do not
depend on this specification. Do these fixes first.

1. Change the meeting recap so that it does not show private to-dos.
2. When a leader adds a person to a team, do not change the existing profile
   of that person.
3. Revoke the sessions of a person when their admin role changes or when an
   admin deactivates them.
4. Change the Firestore rules:
   - Refuse all client writes.
   - Let a user change only a fixed list of fields in their `users`
     document.
   - Let only the creator and the assignee read the thread of a private
     to-do.
   - Check the `rock_id` of each rock status update.
   - Remove the consultant email address from the rules.
5. Make sign-in fail if `SIGN_IN_ALLOWLIST` is empty in production. Do not
   let the last admin be demoted.
6. Write a read-only query for the production database. The query must find
   each "Keep on this team" rock that has an outside assignee. Run it with
   Daniel.

---

## 8. Migration

Make these decisions when the team builds this specification.

| Current data | Change | Recommendation |
|---|---|---|
| Outside assignees who see the full rock | They see only their milestone | Let the access decrease. Leaders add persons to the audience if necessary. |
| Rocks with `team_only` | They become private | Show a list of outside milestone assignees. A leader must reassign them first. |
| Rocks with `shared_team_ids` | The teams move into the audience | — |
| Milestones with no owner, which use the rock owner | The rock owner becomes the real assignee | Before the change, show each rock owner who is on more than one team. Their rocks will show in their blocks on their other teams. A leader can set these rocks to private. |
| Items of persons who are deactivated now | They become unassigned | Send a notification to the leaders of the parent team. |
| To-do followers (`follower_ids`) | They stay. Remove each follower who can no longer see the to-do. | Set the assigner of current items to the creator. |
| Scorecard metrics | Each metric becomes public or private | Make all metrics private. Members make metrics public. |
| Metrics that other teams use now (`shared_team_ids`) | These metrics become public. The other teams track them. | If a metric stays private, the other teams lose it. |
| Private to-dos assigned by a different person | The creator gets access | — |
