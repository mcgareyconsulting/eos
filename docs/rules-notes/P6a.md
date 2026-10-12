# P6a — firestore.rules needed for the rocks model

P6a did not edit `firestore.rules`. The server (Admin SDK) is the real gate
and already enforces the model below through `lib/access/rock.ts`. The
client reads that still go through the rules are:

- `segment-rocks.tsx` live queries: `rocks where team_id == T`,
  `rocks where audience_team_ids array-contains T`, and (until P13)
  `rocks where shared_team_ids array-contains T`; `todos where team_id == T
  and visibility == "team"`; `rock_status_updates where team_id == T`.
- `components/entity-comments.tsx`: `entity_comments where entity_type ==
  "rock" and entity_id == R`.

If the rules refuse a live query, `useCollection` keeps the server-rendered
rows. The `audience_team_ids` subscription therefore degrades safely until
these rules ship.

## Data model the rules must read

| Field | On | Meaning |
|---|---|---|
| `audience_team_ids: string[]` | rock | Teams in the audience. No cap. |
| `audience_user_ids: string[]` | rock | Persons in the audience. |
| `private: bool` | rock | No audience, no blocks. |
| `shared_team_ids` / `team_only` | rock | LEGACY. Read as fallbacks until P13. A save deletes them. |
| `milestone_owner_ids` | rock | LEGACY. No longer a grant. A save deletes it. |
| `team_hidden` | todo | LEGACY. No meaning. A save deletes it. |

## Rules text (uses the P14 `hasAny` pattern on `users/{uid}.team_ids`)

```
function myTeamIds() {
  return get(/databases/$(db)/documents/users/$(request.auth.uid)).data.get('team_ids', []);
}
// lib/access/rock.ts isPrivateRock: the new field wins, else legacy team_only.
function rockIsPrivate(data) {
  return data.get('private', data.get('team_only', false)) == true;
}
// lib/access/rock.ts audienceTeamIdsOf: the new field when present (even
// empty), else legacy shared_team_ids. A private rock has none.
function rockAudienceTeams(data) {
  return rockIsPrivate(data) ? []
    : ('audience_team_ids' in data ? data.audience_team_ids
       : data.get('shared_team_ids', []));
}
// seesFullRock: parent team ∪ audience teams ∪ audience persons ∪ admin.
function rockFullAccess(data) {
  return authed() && (
    data.team_id in myTeamIds()
    || rockAudienceTeams(data).hasAny(myTeamIds())
    || (!rockIsPrivate(data)
        && data.get('audience_user_ids', []).hasAny([request.auth.uid]))
  );
}

match /rocks/{id} {
  allow read: if admin() || rockFullAccess(resource.data);
  // Writes stay server-only in practice (all rock writes are server
  // actions). Keep the client write rule at parent team / admin; do NOT
  // widen it to the audience — the server gates audience edits and the
  // leader-only audience/private fields.
  allow update, delete: if admin() || isMember(resource.data.team_id);
  allow create: if admin() || isMember(request.resource.data.team_id);
}

match /rock_status_updates/{id} {
  // Filed under the parent team; the audience reads by rock id.
  allow read: if admin()
              || isMember(resource.data.team_id)
              || rockFullAccessById(resource.data.rock_id);
  allow create: if admin()
                || (isMember(request.resource.data.team_id)
                    && request.resource.data.user_id == request.auth.uid);
}

match /todos/{id} {
  allow read: if admin()
              // A milestone (or to-do) assignee reads their own item, from
              // any team: this is the ONLY read an outside assignee has —
              // never the rock, its other milestones, history or thread.
              || (authed() && resource.data.owner_id == request.auth.uid)
              || (isMember(resource.data.team_id)
                  && resource.data.visibility == "team")
              // The audience reads every team-visible milestone of the rock.
              || (resource.data.visibility == "team"
                  && rockFullAccessById(resource.data.source_rock_id));
  // (writes unchanged)
}

// entity_comments for entity_type == "rock": read iff
// rockFullAccessById(resource.data.entity_id). Drop the old clauses that
// granted the rock owner and `milestone_owner_ids`.
```

Changes from the deployed rules:

1. Remove the `milestone_owner_ids` and `owner_id == uid` clauses from
   `rockFullAccess`. Assignees read only their milestone via
   `todos.owner_id`.
2. Replace the 8-index `listSharedToMe` unroll for rocks with `hasAny` on
   `myTeamIds()` (the P14 spike). Remove the 8-cap note: the app no longer
   caps the audience. Scorecard still uses `listSharedToMe` until its own
   package.
3. Add `audience_user_ids` (persons) and `private`.
4. `sourceRockVisibleToMe` becomes `rockFullAccessById` (the audience,
   including persons).
5. Prerequisite (P14): `users/{uid}.team_ids` must not be client-writable.

## Indexes

Single-field `array-contains` on `rocks.audience_team_ids` and
`rocks.audience_user_ids` (automatic single-field indexes; no composite
index needed).
