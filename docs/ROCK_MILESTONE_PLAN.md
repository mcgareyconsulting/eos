# Rocks & Milestones — implementation plan

Source: two notes from Brian Otteman, 2026-09-09.

> 1. A need to tag a rock as a Company Rock (and also keep "Team" designation)
> 2. Dig into Rock and Milestone sharing. Ability to assign a milestone to a
>    rock that belongs on another team. Ability to see / modify that rock and
>    related milestones.

Audit of current behaviour: see the "Current behaviour" notes inline below.
The two notes are **independent** — A can ship without B and vice versa.

### Read the second note through an admin's eyes

Brian holds the org `admin` claim. `requireTeamAccess` admits an admin to any
team with no membership (`lib/firebase/teams.ts:28`), so he can already open
any team's Rocks page and edit its rocks as *home* rocks. He is never a
"guest" in the `shared_team_ids` sense. Two things follow:

- *"Assign a milestone to a rock that belongs on another team"* — he can, from
  that team's page; what blocks him is the owner picker being that team's
  roster (`rock-modal.tsx:506`). That is B6, the "Open to all" toggle.
- *"See / modify that rock and related milestones"* — a rock shared **into**
  his own team renders `readOnly` on his page purely because it is shared-in
  (`rocks/page.tsx:436`, `rock-row.tsx:215`); identity never enters into it.
  He has every right on that rock and gets a dead row. That is B9.

So the note is an admin describing permission he already holds, blocked by UI
that does not know who he is — **not** a request for guests to add milestones
to other teams' rocks. The guests-tick-only decision (resolved item 2) stands.

**Reference scenario used throughout Workstream B:** Brian (admin, member of
Leadership) puts a milestone on an ESD rock and assigns it to Casey (Ops
member, non-admin, not on ESD; the rock is not shared into Ops). Hardest case:
Casey has no relationship to the rock at all.

---

## Decisions locked before writing code

**D1 — Company and Team are two separate flags, not a hierarchy.**
A rock may be Company, Team, both, or neither. "Individual" is the absence of
both. This is *not* an elevated version of the Team designation.

**D1a — Flags are independent, but *placement* is a priority ladder.**
A rock renders in exactly one section, chosen by the highest bucket it
qualifies for: **Company > Department > owner**. It carries **every** pill it
qualifies for regardless of which section it landed in — so a Company+Team rock
sits in the Company block wearing both the Company and Team pills. Flags are a
set; placement is a single choice made from that set.

**D2 — Only org admins may set the Company flag. Settled 2026-09-09.**
The Identity Platform `role: "admin"` claim (`firestore.rules:18`), org-wide —
**not** team-scoped, so an admin can flag a rock as Company through whatever
team they are creating it on. `leader` gets nothing new here; it was considered
and rejected because it is per-team and every team has one, which would erode
"Company" to mean "some team lead said so".

`requireTeamAccess` already returns `isAdmin` (`lib/firebase/teams.ts:36`), so
this costs **zero extra reads** on any surface. The rejected leadership-team
variant (`is_leadership_team` on the team doc) is dropped entirely — do not
build it.

The **Team** flag is unchanged and stays open to any team member: it is
`rock_type === "department"`, which the existing kind radio already sets.

**D3 — A milestone's `team_id` stays pinned to its parent rock's team.**
Rejected alternative: re-point `team_id` at the assignee's team. Reason:
`updateRockWithMilestones` (`rocks/actions.ts:360`) and `deleteRock`
(`rocks/actions.ts:158`) both sweep milestones with
`where team_id == <rock team> AND source_rock_id == <rock>` and **delete
anything not in the submitted array**. Diverging `team_id` makes both sweeps
blind: the edit modal silently orphans milestones it cannot see, and delete
leaves them behind. Every `team_id ==` milestone query in the repo assumes the
child-of-rock invariant. Keep it; solve access by **owner identity** instead.

**D4 — Permission logic lives in one pure module, consumed by both UI and
server action.** `lib/rocks-share.ts` already does this for
`canSetRockStatus()`; milestones get a sibling in the same file so the
affordance and the gate cannot drift.

---

## Workstream A — Company / Team flags

> **Shipped 2026-09-09** on `feature/improved-rock-milestone-behavior` —
> A1–A5 and A7 as written below, with two implementation notes:
>
> - The classifier lives in `lib/rock-bucket.ts` (`rockBucket`, `isCompanyRock`,
>   `isTeamRock`) and is imported by *both* `lib/home-board.ts` and
>   `lib/l10/rock-order.ts`, so the duplicated `isDepartmentRock` rule is gone
>   rather than copied a third time. `rock-type.ts` re-exports it for `app/`.
> - On a **non-admin update**, the flag is written as `isCompanyRock(existing)`
>   rather than omitted (A3 said "omit the key"). Omitting would lose the
>   Company half of a legacy `rock_type: "company"` doc, because the kind radio
>   rewrites `rock_type` to `department` on the same save. Reading the stored
>   doc through `isCompanyRock` preserves it and folds legacy forward lazily —
>   so after everyone's next edit, A6 is a no-op for those docs.
>
> A6 (migration) is written as `scripts/migrate-company-rocks.ts`, dry-run by
> default, **not yet run** — row count unknown.

### A0. Current behaviour

- `rock_type` is a single string, one value per rock:
  `["company", "department", "individual"]` (`rocks/rock-type.ts:11`), stored
  on `RockDoc` (`lib/firestore-types.ts:31`).
- The picker offers **only Individual / Team** — `ROCK_KIND_OPTIONS`
  (`rock-type.ts:28`). Company was retired from it.
- `toFormRockType()` (`rock-type.ts:32`) folds `company → department` **on
  read**. A legacy Company rock therefore renders a "Team" badge
  (`rock-row.tsx:96`), and opening + saving it in the modal overwrites
  `company` with `department` (`rock-modal.tsx:206` → `:269` →
  `actions.ts:268`). **This is live data loss today.**
- `ROCK_TYPE_STYLES.company` (blue chip) exists but is unreachable.
- `isDepartmentRock()` is implemented **twice** — `rock-type.ts:66` and
  `lib/home-board.ts:7` (deliberate: `lib/` must not import from `app/`).
  Any field change lands in both.

### A1. Field shape

Add one new field. Keep `rock_type` as the Individual↔Team axis — it is already
wired into `isDepartmentRock`, L10 ordering (`lib/l10/rock-order.ts`), and the
Home board split.

```ts
// lib/firestore-types.ts — RockDoc
/** Company-level rock. Orthogonal to rock_type: a rock may be both a
 *  Company rock and a Team rock. Leader/admin-set only. Absent on all docs
 *  created before this field — always read as `=== true`. */
is_company_rock?: boolean;
```

`"company"` stays in `ROCK_TYPES` for legacy reads only, then is migrated out
(A6). Do **not** add a parallel `is_team_rock` boolean — `rock_type ===
"department"` already is that flag, and duplicating it means two sources of
truth for the Department section.

### A2. `rock-type.ts`

- Delete `toFormRockType()`. Every call site (`rock-row.tsx:96`,
  `rock-modal.tsx:206`) switches to `normalizeRockType()`, which is
  non-lossy. This alone stops the silent overwrite.
- `ROCK_KIND_OPTIONS` reverts to `individual | department` only — the kind
  radio stays a two-way choice. Company is a **separate checkbox**, not a
  third radio option (D1).
- Add `isCompanyRock(r): boolean` → `r.is_company_rock === true ||
  normalizeRockType(r.rock_type) === "company"` so legacy docs read correctly
  before the migration runs.
- `isDepartmentRock()` keeps `company` in its bucket so pre-migration rocks
  do not jump sections mid-deploy.

### A3. Server action gate

`parseRockFields()` (`actions.ts:262`) currently parses `rock_type` from the
form and defaults anything unrecognised to `"individual"`. The Company flag
must **not** follow that pattern.

In `createRockWithMilestones` / `updateRockWithMilestones`:

1. Take `isAdmin` straight off `requireTeamAccess` — already destructured in
   both actions, no extra read and no membership lookup.
2. On **create**: write `is_company_rock: isAdmin && formValue === true`,
   else `false`.
3. On **update**: if `isAdmin`, write the submitted value. If not, **omit the
   key from the patch entirely** so the existing value is preserved.

> The preserve-on-update rule is the whole point. Parsing-and-defaulting for a
> non-leader editing a leader-flagged rock reproduces exactly the
> `toFormRockType` wipe we are removing in A2, just with a new field.

### A4. UI

- `rock-modal.tsx`: add a Company checkbox beside the Rock kind radiogroup,
  rendered only when `canFlag`. Non-leaders see the current flag as a
  read-only chip (or nothing when unset) — never an input that silently
  no-ops.
- Both `NewRockButton` and `EditRockButton` need a `canFlagCompany` prop
  threaded from the page.
- `rocks/page.tsx:78` destructures `{ uid, db, team }` — add `isAdmin` and
  pass it down. (`meetings/[meetingId]/page.tsx:95` already destructures it.)
- L10 renders the same `RockRow` (`segment-rocks.tsx:373`), so it needs the
  same prop from the meeting page's server component.
- `rock-row.tsx`: render the Company chip using the existing
  `ROCK_TYPE_STYLES.company` blue treatment, **in addition to** the Team chip
  when both apply.

### A5. Sections and pills

Company gets its **own block, above Department** — it is not folded into it.
Section order becomes:

```
Company  →  Department  →  owners (A–Z on Rocks / speaking order in L10)  →  orphans  →  Shared by …
```

Placement uses the D1a ladder; pills are independent of it. Concretely, a rock
with `is_company_rock: true` and `rock_type: "individual"` lands in the Company
block (answering Brian's Q1) and shows only the Company pill. One with both
flags lands in Company and shows Company **and** Team.

`isDepartmentRock()` must therefore stop being the classifier. Introduce a
single pure `rockBucket(r): "company" | "department" | "owner"` and route every
surface through it. `isDepartmentRock` stays only as a narrow "is this in the
Department bucket" predicate, or is deleted once callers move over.

Surfaces to update — this is the full list, and the duplication is the risk:

| Surface | Change |
|---|---|
| `rocks/page.tsx:307` `buildSections` | Add a leading Company group before the Department group |
| `lib/l10/rock-order.ts:82` `groupRocksForL10` | Takes `isDepartmentRock` as a param today (kept dependency-free of `app/`). Swap that param for a `bucket` classifier and emit a leading Company section |
| `lib/l10/rock-order.ts:65` `L10RockSection` | `isDepartmentSection: boolean` → `bucket: "company" \| "department" \| "owner"`; sole reader is `segment-rocks.tsx:351` |
| `lib/home-board.ts:7` | Its private `isDepartmentRock` copy needs the company flag too — **this file must not import from `app/`**, so the rule stays duplicated on purpose |
| `lib/home-board.ts:185` `splitHomeRocksByType` | Returns `{ mine, departmental }`; needs a third `company` bucket (reader: `home/page.tsx:405`) |
| `lib/home-board.ts:148` `homeRockPillKind` | Returns `"team" \| "person"`; needs `"company"` (reader: `home/page.tsx:358`, which maps it to the owner-column label) |
| `rock-row.tsx:96` | Render Company and Team pills together, not one-or-the-other |

The Company section title is a new constant beside `DEPARTMENT_SECTION_TITLE`
(`rock-type.ts:74`).

### A6. Migration

One-off script under `scripts/`, run after A1–A5 are deployed (`isCompanyRock()`
handles both shapes in the meantime, so there is no window where legacy rocks
render wrong).

For every rock with `rock_type == "company"`, write `is_company_rock: true`.
The open half is what `rock_type` becomes:

- **`"department"`** — the rock ends up Company **and** Team, wearing both
  pills. Preserves the Team pill those rocks show today (`toFormRockType`
  folds company → Team on read), and preserves their current placement in the
  Department bucket — except D1a's ladder now promotes them to the Company
  block.
- **`"individual"`** — the rock ends up Company only, one pill. Truer to what
  "company" meant when it was set, but every one of these rocks visibly loses
  its Team pill on the day the script runs.

**Recommend `"department"`** — additive, no visible pill disappears, and the
promotion to the Company block is the behaviour Brian asked for. It is also the
reversible one: un-setting `rock_type` later is a one-field script, while
re-deriving which rocks *used* to be Team after the fact is not.

Worth a 30-second look at the actual data before running — `rock_type ==
"company"` may well be zero rows, since Company was pulled from the picker and
`toFormRockType` has been overwriting the value on every save since. If the
count is 0, the question is moot and the script is a no-op.

### A7. Rules

`firestore.rules:132` — rock writes are already `isMember(team_id)`, and no
client-SDK code writes rocks (all through Admin SDK server actions), so the
A3 gate is the real enforcement. A rules-side mirror would need
`admin() || request.resource.data.is_company_rock == resource.data.is_company_rock`
on update. Optional defense-in-depth; note it, don't block on it.

---

## Workstream B — Cross-team milestone sharing

### B0. Current behaviour

Rock sharing already works. Milestone sharing does not.

**Works:** `shared_team_ids` on the rock; the picker lists every org team, not
just yours (`rock-modal.tsx:433`, `actions.ts:307` `allowedShareTeamIds` —
share-down is intentional), capped at 8 because `firestore.rules:106` unrolls
the array check by index. Guest teams see a "Shared by {Owner}" section on
Rocks (`rocks/page.tsx:200`) and L10 (`segment-rocks.tsx:394`). The rock's
person owner can move status from a guest team; everyone else read-only —
enforced by `canSetRockStatus()` (`lib/rocks-share.ts:69`) in both the row and
the server action (`actions.ts:31`).

**Gaps:**

1. The milestone owner dropdown is seeded from the *current team's* roster
   only (`rock-modal.tsx:506`). You cannot assign a milestone to anyone off
   the rock's team.
2. `milestoneDoc()` (`actions.ts:213`) writes `team_id: <rock team>`, and
   every consumer queries `team_id ==` / `team_id in`. So even if you could
   set a cross-team owner, that person would never see it.
3. `toggleTodo` gates on `requireTeamDoc(db, "todos", todoId, teamId)`
   (`todos/actions.ts:107`) — exact `team_id` match, so ticking a shared
   rock's milestone from the guest team 404s. Hence `readOnly` on shared rows
   (`rock-row.tsx:319`). `readOnly` is driven by *"is this shared-in"*, not by
   identity — so **the rock's own owner gets a dead checkbox on their own
   rock.**
4. L10 subscribes to `todos where team_id == teamId`
   (`segment-rocks.tsx:111`) with no equivalent of the Rocks page's
   `loadMilestonesForRocks(db, sharedRockIds)` (`rocks/page.tsx:202`). A
   shared-in rock shows `0/0` milestones in L10 but its real milestones on the
   Rocks tab — same rock, two numbers.

### B1. Permission helper (do this first)

`lib/rocks-share.ts` — add alongside `canSetRockStatus`:

```ts
/** May `uid` tick this milestone while viewing `teamId`?
 *  - anyone on the rock's parent team (normal case)
 *  - the milestone's own owner, from any team
 *  - the rock's owner, on a team the rock is shared into
 *  Structural edits (add/remove/retitle a milestone) stay on the parent team. */
export function canTickMilestone(
  rock: ShareableRock,
  milestoneOwnerId: string | null,
  teamId: string,
  uid: string | null,
): boolean
```

Unit tests go in the existing `lib/rocks-share.test.ts`.

This is the *whole* of what a guest gains (resolved item 2): ticking a
milestone assigned to them. Adding, retitling, re-dating or deleting a
milestone runs through `updateRockWithMilestones`, which is already
parent-team-only via `requireTeamDoc` (`actions.ts:355`) — so tick-only needs
no extra guard, just the absence of one.

### B2. Write path

`todos/actions.ts` `toggleTodo` (`:101`): when the todo has a
`source_rock_id`, stop using `requireTeamDoc` for the team match. Instead load
the parent rock and apply `canTickMilestone`; `notFound()` on false. Non-
milestone todos keep the current `requireTeamDoc` path untouched.

Revalidation must cover both teams — mirror what `setRockStatus`
(`actions.ts:110`) already does when `rockTeamId !== teamId`.

### B3. Read path — Home

**Home is already built for this.** `shouldShowHomeRock()`
(`lib/home-board.ts:117`) takes `hasMyOpenMilestone`; `home/page.tsx:227`
already fetches missing parent rocks by id via `db.getAll`, hydrates unknown
owner names, and resolves unknown team names (`:250`). The only thing missing
is that `todos` is sourced solely from `team_id in myTeamIds`
(`home/page.tsx:131`), so a cross-team milestone never enters the array.

Change: add a parallel query and merge/dedupe by doc id.

```ts
db.collection("todos")
  .where("owner_id", "==", user.id)
  .where("completed_at", "==", null)
  .get()
```

**No new index needed** — `(owner_id ASC, completed_at ASC)` already exists in
`firestore.indexes.json`.

Home is display-only (no tick), so nothing else changes. Note the deliberate
widening: the assignee's Home shows the parent rock **and its sibling
milestones** as context (`loadMilestonesForRocks`, server-side). One assignment
gives read-context on the whole rock. Intended — a milestone without its rock
is meaningless — but it is the one place the flow shows more than the single
doc. Filter the merged extras to `source_rock_id != null`
in memory so this does not change the pure-to-do column
(`selectHomeTodos` already excludes milestones, but be explicit).

### B4. Read path — To-Dos page

`todos/page.tsx:50` fetches `todos where team_id == tid`. Same treatment: a
second `owner_id == uid` query, merged, keeping only rows with
`source_rock_id` set (a cross-team *plain* to-do should not appear on a team
page it doesn't belong to). `initialRocks` (`:51`) must also gain the parent
rocks of any cross-team milestone, or the row renders without its rock label.

> **Server merge alone is not enough here — correction to an earlier draft.**
> Unlike Home (fully server-rendered), the To-Dos board hydrates into live
> subscriptions scoped `team_id == teamId` (`todos-board.tsx:201,210`), and
> `useCollection` **replaces** the server payload with the first snapshot
> (`lib/firebase/use-collection.ts:27` — *"`initial` paints first; the first
> onSnapshot result replaces it"*). A cross-team milestone merged only into
> `initialTodos` would paint, then vanish on hydration. The client needs its
> own `owner_id == uid` subscription — which in turn needs B8, or it is
> permission-denied. Same applies to `initialRocks` and the rocks
> subscription (`:217`).

### B5. Read path — L10 (gap 4)

`segment-rocks.tsx:111` — add a second `useCollection` subscription for
shared rocks' milestones:

```ts
where("source_rock_id", "in", sharedRockIds)  // chunk at 30
where("visibility", "==", "team")             // required: per-doc rule
```

`firestore.rules:122` (`sourceRockVisibleToMe`) already permits this read, so
it is a client-query fix only, no rules change. The `visibility == "team"`
clause is mandatory — without it Firestore rejects the whole subscription if
any private todo matches (see the comment at `segment-rocks.tsx:108`).

### B6. Owner picker — default scope + "Open to all" toggle

`rock-modal.tsx:506` seeds milestone owners from the *current team's* roster
only. Replace with a two-scope picker:

- **Default** — rock's team roster ∪ rosters of the teams in
  `shared_team_ids`. Short, and right for the common case.
- **"Open to all"** (a toggle on the assign row) — widens the candidate list to
  the **whole org**.

`getOrgDirectory()` (`lib/firebase/teams.ts:283`) already does exactly this
fetch: every team with its members, user profiles resolved and chunked at 100,
`cache()`-wrapped per request. It backs `/directory` and the members page and
is not admin-gated. So "Open to all" is a picker-scope change, not new backend.

Group the `<select>` by team name and keep it searchable — org-wide on a bank
roster is long, and two people share a first name more often than not.

Server side, `parseMilestones` (`actions.ts:192`) accepts any string as
`owner_id` today. Validate against the resolved candidate set — the org
directory when the toggle was on, the team ∪ shared union when it was not.

> **This does not change the ownership model.** The milestone still gets
> exactly one accountable person; the toggle only widens who is offered. A
> null/`"team"` owner sentinel was deliberately retired for rocks
> (`actions.ts:271` — *"team rocks still need a person"*) and is not
> reintroduced here. An unowned milestone would be filtered out of
> `selectHomeTodos` (`home-board.ts:56`), `rockHasMyOpenMilestone` (`:86`) and
> the Google Tasks push (`lib/google/tasks.ts:517`) — visible to nobody, which
> is the opposite of "open".

**Existing off-roster owners must stay selectable with the toggle off.** The
edit modal seeds rows from the milestone's `owner_id` (`rock-modal.tsx:225`)
but the `<select>` only offers `members` (`:506`). An owner not in that list
renders blank, and the first touch of the dropdown silently reassigns the
milestone to whoever is at the top. Always include each existing row's current
owner as an option, whatever the scope.

**Hard dependency: B8 must ship with this.** Assigning outside the rock's share
graph creates a person who owns work they cannot read.

### B9. Shared-in rows respect who is looking

`readOnly` on a shared-in `RockRow` is set unconditionally
(`rocks/page.tsx:436`, `segment-rocks.tsx:420`). Replace with
`readOnly = !canEditRock(rock, uid, isAdmin)` — false for admins and for
members of the rock's parent team — as a sibling of `canSetRockStatus` in
`lib/rocks-share.ts`.

Mechanical consequence: every action on that row binds to the **viewing**
team today — `deleteRock.bind(null, teamId, …)` (`rock-row.tsx:102`),
`setRockArchived` (`:104`), `EditRockButton teamId={teamId}` (`:218`). For a
shared-in rock they must target `rock.team_id`, or `requireTeamDoc` 404s on
save. The actions themselves need no change — `requireTeamAccess(rock.team_id)`
passes for an admin — only the id they are called with.

### B10. Off-roster milestone owner names

Milestone owner names resolve against the team roster. Once B6 lands, a
milestone owned by someone off that roster renders as "—" on both team
surfaces:

- `rocks/page.tsx:262` — `extraNameIds` collects shared-rock owners and
  status authors; add milestone `owner_id`s.
- `meetings/[meetingId]/page.tsx:646` — `extraOwnerIds` collects shared-rock
  owners only; same addition, threaded through `extraOwnerNames`.

Both already run `loadUsersById` for the extras, so this is a list extension,
not a new fetch.

### B8. Rules — owner-based read path (**required**, not optional)

Two rules currently scope *everything* through team membership, and both break
the moment a milestone is owned outside the rock's share graph:

1. **`todos` read (`firestore.rules:160`)** — the owner clause is nested
   *inside* `isMember(resource.data.team_id)`:
   `isMember(team_id) && (visibility == "team" || owner_id == uid)`. An
   off-team owner matches neither that nor `sourceRockVisibleToMe`. Add a
   standalone clause: `resource.data.owner_id == request.auth.uid`.
2. **`rocks` read (`firestore.rules:133`)** — `isMember(team_id) ||
   rockSharedToMe()`. An off-team milestone owner cannot load the parent rock,
   so the milestone renders with no rock context. Needs an owner-of-a-milestone
   path, or the parent rock must be server-supplied on every surface.

Also mirror B1 on **`todos` update** (`firestore.rules:168`), currently
`isMember(resource.data.team_id)` — that one is defense-in-depth (no client-SDK
code writes todos), but it should not drift from the real gate.

Rejected alternative: auto-adding the assignee's team to `shared_team_ids` on
assignment. It silently re-shares the whole rock with a team the owner never
chose, and burns the 8-share cap (`MAX_SHARED_TEAMS`, `actions.ts:210`) as a
side effect of picking a person.


---

## Sequencing

| # | Work | Depends on |
|---|------|-----------|
| 1 | A2 — drop `toFormRockType`, stop the wipe | — |
| 2 | A1, A3, A4 — flag + gate + UI | 1 |
| 2b | A5 — Company block + pills across all 7 surfaces | 2 |
| 3 | A6 — migration script, run after deploy | 2 |
| 4 | B1 — `canTickMilestone` + tests | — |
| 5 | B2 — `toggleTodo` gate | 4 |
| 6 | B5 — L10 shared milestones (standalone bug fix) | — |
| 7 | B3, B4 — Home / To-Dos read paths | 5 |
| 8 | B8 — rules: owner-based read path | 4 |
| 9 | B6 — owner picker + "Open to all" toggle | 5, 7, 8 |
| 10 | B10 — off-roster owner names on Rocks + L10 | 9 |
| 11 | B9 — shared-in rows editable for admin / parent team | 4 |

A5 (2b) is the largest single piece of Workstream A — the flag itself is a
field and a checkbox, but the Company block touches seven surfaces and the
`isDepartmentRock` rule is deliberately duplicated across `app/` and `lib/`.

Items 1 and 6 are self-contained defect fixes and can ship ahead of everything
else. B6 is last on purpose and now depends on B8: assigning cross-team
milestones before 7 lands creates work nobody can see, and before 8 lands
creates work the assignee cannot read.

## Test plan

- `lib/rocks-share.test.ts` — `canTickMilestone` matrix: parent-team member,
  milestone owner off-team, rock owner on guest team, unrelated guest.
- `lib/home-board.test.ts` — already covers `hasMyOpenMilestone`; add a case
  where the parent rock's team is not in `myTeamIds`.
- New: rock-type tests for `isCompanyRock` across `{legacy "company"}`,
  `{is_company_rock: true}`, `{both}`, `{neither}`.
- New: `rockBucket()` ladder — Company+Individual → `company`;
  Company+Team → `company` (both pills); Team only → `department`; neither →
  `owner`. Assert placement and pills separately, since D1a lets them diverge.
- `lib/l10/rock-order.test.ts` — existing cases pass `isDepartmentRock` as a
  predicate (`:23`); they need updating for the classifier signature. Add a
  case asserting the Company section leads and is never the current speaker.
- `lib/home-board.test.ts:253` already exercises `splitHomeRocksByType` over a
  mixed `rock_type` fixture — extend it for the third bucket.
- Manual, two-user (Daniel + Joe) on the trial deploy: share a Leadership rock
  into ESD, assign a milestone to an ESD-only member, confirm it appears on
  their Home and To-Dos, that they can tick it, and that the Rocks tab and L10
  agree on the `n/m` count.

## Resolved with Brian (2026-09-09)

1. **Company-flagged Individual rock** → its own Company block, separate from
   Department. Both-flagged rocks go to the highest block and keep both pills.
   (D1a / A5.)
2. **Guests cannot add milestones** to a shared rock, and cannot retitle,
   re-date or delete them. They **can tick off a milestone assigned to them**.
   That is exactly what B1's `canTickMilestone` grants and no more.
3. **Company flag is admin-only** — the org-wide `role: "admin"` claim,
   regardless of which team the rock is being created through. Team leaders
   get nothing new. (D2 / A3.)

4. **"Open to all" on the assign-milestone modal** — a picker-scope toggle
   widening the assignable-user pull from team to org. Accepted. It replaces
   B6's plain team∪shared union with default-plus-toggle, and promotes the
   rules work (B8) from optional to required.

5. **Brian is an admin.** The second note is read as an admin already holding
   the permission and blocked by a `readOnly` flag that ignores identity — not
   as a request for guest-side milestone creation. Adds B9; keeps item 2.

Every design question is closed and the plan is buildable as written. One
**data** call remains, and it does not block any code: what `rock_type` legacy
`"company"` rocks migrate to (A6). Recommendation is `"department"`; the row
count may well be zero, in which case it is moot.

---

## Permission reference (for the record)

### `admin` — org-wide, via the Identity Platform `role: "admin"` claim

Granted by HPB to their own admin accounts (`firestore.rules:18`). Satisfies
`requireTeamAccess` and `requireTeamLeader` on **every** team, plus creating
teams (`members/create-team-actions.ts:26`), adding people to the org directory
(`directory/new/page.tsx:11`), and seeing every team in the sidebar
(`lib/firebase/auth.ts:56`). **This is the gate for the Company flag.**

### `leader` — per-team, via `requireTeamLeader()` (`lib/firebase/teams.ts:72`)

Scoped to one team; accepts leader-on-that-team or org admin. Grants member
management (`members/actions.ts`), meeting scheduling / driver / Meet link /
live L10 stage advance (`meetings/actions.ts`), and the Ninety/CSV bulk import
(`import/actions.ts:133`). **Unchanged by this plan** — recorded here only so
the Company-flag decision has its rejected alternative on file.
