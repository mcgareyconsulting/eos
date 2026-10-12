# P8a — firestore.rules needed for the to-do model

P8a did not edit `firestore.rules`. The server (Admin SDK) is the real gate:
every to-do write goes through `lib/firebase/todo-gate.ts` (`todoCan` →
`lib/access` `todoAccess` / `milestoneAccess`). Writes stay `allow write: if
false`. What needs rules is the **client reads** (live listeners), which
otherwise keep the server's first paint (`useCollection` logs and holds the
initial rows when a listener is refused).

## The model the read rules must mirror

| To-do | Readable by |
|---|---|
| Team (`visibility != "private"`), no `source_rock_id` | members of `team_id`, the assignee (`owner_id`) from any team, admins |
| Private (`visibility == "private"`) | the creator (`created_by`), the assignee (`owner_id`), admins. **Not** members, **not** leaders |
| Milestone (`source_rock_id`) | unchanged from P6a: full-rock set (parent, audience teams/persons, admins) + its own assignee |

## Client queries P8a adds or relies on

| Where | Query | Today's rule | Change needed |
|---|---|---|---|
| `todos-board.tsx` `createdQuery` | `todos where team_id == T and visibility == "private" and created_by == me` | **refused** (no creator clause) | add the creator clause below |
| `todos-board.tsx` `elsewhereQuery` | `todos where owner_id == me` | allowed (owner clause) | none |
| `todos-board.tsx` / `segment-todos.tsx` `teamQuery`, `mineQuery` | unchanged | allowed | none |
| `todo-peek-modal.tsx` | `todos/{id}` doc read | allowed for owner / member / admin | creator of a private to-do needs the creator clause |
| `entity-comments.tsx` (to-do thread) | `entity_comments where team_id == T and entity_type == "todo" and entity_id == X` | `isMember(team_id)` only | **off-team assignee is refused**; see below |
| `entity-activity.tsx` (to-do trace) | `entity_activity where team_id == T ...` | team-scoped | same gap as comments for the off-team assignee (P11) |

## Rules text

```
match /todos/{id} {
  allow read: if admin()
              // The assignee, from any team (spec §3.1, D1).
              || (authed() && resource.data.owner_id == request.auth.uid)
              // The creator of a private to-do (spec §3.2).
              || (authed() && resource.data.visibility == "private"
                  && resource.data.get('created_by', '') == request.auth.uid)
              || (isMember(resource.data.team_id)
                  && resource.data.visibility == "team")
              || (resource.data.visibility == "team"
                  && sourceRockVisibleToMe(resource.data.source_rock_id));
  allow write: if false;
}
```

`entity_comments` for to-do / milestone threads needs an item-aware read
(this is P11's "item-aware `entity_comments`"). Two problems today:

1. **Gap:** the off-team assignee (and, for milestones, the audience) cannot
   read the thread they are allowed to write in. Comments are filed under
   the to-do's own `team_id` (P8a now always does this, whichever page posted).
2. **Leak (pre-existing):** `isMember(team_id)` lets every member of the
   team read the thread of a *private* to-do they cannot see. P11 must close
   this.

```
function todoThreadReadable(data) {
  let t = get(/databases/$(db)/documents/todos/$(data.entity_id)).data;
  return data.entity_type == 'todo' && (
    t.owner_id == request.auth.uid
    || (t.visibility == 'private' && t.get('created_by', '') == request.auth.uid)
    || (t.visibility != 'private' && isMember(t.team_id))
    || (t.get('source_rock_id', null) != null && rockFullAccessById(t.source_rock_id))
  );
}
allow read: if admin()
             || (resource.data.entity_type != 'todo' && isMember(resource.data.team_id))
             || rockThread(resource.data)
             || todoThreadReadable(resource.data);
```

The client query has to change with it: a to-do thread query constrained
by `team_id` cannot be proven readable per document by a `get()`-based
rule. P11 should switch the to-do thread query to `entity_type == "todo"
and entity_id == X` (as the rock thread already does) when it lands this
rule. Until then the off-team assignee sees an empty thread on the client
but can post (the server accepts it) — flag for the P11 parity tests.

## Rule tests to add (P11)

- off-team assignee reads `todos/{id}` (team and private) — allowed.
- creator (not owner) reads a private to-do and lists `created_by == me` — allowed.
- leader of the team reads a member's private to-do — **denied**.
- member reads the thread of a private to-do on their team — **denied**.
- off-team assignee reads the to-do thread — allowed.
