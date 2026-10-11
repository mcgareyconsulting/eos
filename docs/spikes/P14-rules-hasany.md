# Spike P14: `hasAny()` on `users/{uid}.team_ids`

Decision D2 in `docs/PERMISSIONS_BUILD_GRAPH.md`. Date: 2026-10-11.

## Verdict: PASS (verified on the emulator)

One `get()` of the caller's profile plus `hasAny()` authorizes every live
client query shape the app uses, and denies a caller who is not on the team.
The 8-team cap on shared lists is not needed with this rule.

| Query shape (client SDK) | User on team T | User not on T |
|---|---|---|
| `where("shared_team_ids", "array-contains", T)`, `getDocs` | **PASS** (allowed, 2 docs) | **PASS** (denied) |
| same query as a live `onSnapshot` listener | **PASS** (allowed) | **PASS** (denied) |
| `where("team_id", "==", T)`, `getDocs` and `onSnapshot` | **PASS** (allowed, 2 docs) | **PASS** (denied) |
| `getDoc` by id, doc shared into T | **PASS** (allowed) | **PASS** (denied) |
| `getDoc` by id, doc shared into **20** teams, T at index 15 | **PASS** (allowed) | **PASS** (denied) |
| `getDoc` by id, owned by T, no `shared_team_ids` field | **PASS** (allowed) | **PASS** (denied) |

Fail-closed cases, all denied as expected: a profile with no `team_ids`, no
profile at all, unauthenticated, and an unfiltered collection read. A query
on a team the caller is not on (`array-contains "team-B"`) is denied even when
each matching doc is readable through another team. That is expected (rules
are not filters), and the app always queries by a team the viewer is on.

The owner-write guard (below) was tested too: a user can update their own
profile fields but cannot add to `team_ids`, cannot create a profile with it,
and cannot sneak it in with a merge `setDoc`.

Both forms passed the same assertions: the literal rule text from the brief,
and the defensive form proposed below.

### Evidence

- `pnpm spike:p14`: 31 tests, 31 pass, 0 fail (`spikes/p14-hasany.test.ts`
  against `spikes/p14-hasany.rules`).
- Negative control: replacing the `hasAny(...)` clause in the defensive rule
  with `true` makes 10 of the 31 tests fail (the "denied" assertions), so the
  test tells the two cases apart.
- Environment: firebase-tools 15.23.0, `cloud-firestore-emulator-v1.21.0.jar`,
  OpenJDK Temurin 26.0.1, `@firebase/rules-unit-testing` 6.0.0, client
  `firebase` 12.x. Demo project `demo-p14-hasany`, fully offline.
- Caveat: this is the emulator's rules engine. It is the same evaluator that
  production uses, but check one shared-rock listener on the sandbox DB once
  P2/P11 deploy.

## Rule to carry into P2 / P11

Written for the app's `firestore.rules` (whose database wildcard is `{db}`).
Firestore caches repeat `get()`s of the same document within one request,
so calling the helper more than once in a rule should cost one lookup. The
spike did not measure this. Check it in P2 if a rule gets close to 10.

```
// The caller's teams, server-maintained from team_members
// (lib/firebase/membership.ts). One document lookup, any number of teams.
function myTeamIds() {
  return get(/databases/$(db)/documents/users/$(request.auth.uid)).data.get('team_ids', []);
}

// Replaces the 8-way unroll. No cap: a doc can be shared into any number of
// teams.
function listSharedToMe(data) {
  return data.get('shared_team_ids', []).hasAny(myTeamIds());
}
```

and, to use it for owner-team checks on a list query as well:

```
resource.data.team_id in myTeamIds()
```

`isMember(teamId)` (one `exists()` on `team_members/{team}__{uid}`) can stay
for single-team checks. `team_members` is still the source of truth, and
`exists()` there is never stale.

**Required in the same change: lock `team_ids` against the owner.** Today
`match /users/{uid}` allows `write: if uid == request.auth.uid || admin()`,
so once rules trust `team_ids`, any user could add any team to their own
profile. Replace it with:

```
match /users/{uid} {
  allow read:   if inDomain();
  allow create: if admin() || (uid == request.auth.uid
                  && !('team_ids' in request.resource.data));
  allow update: if admin() || (uid == request.auth.uid
                  && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['team_ids']));
  allow delete: if admin();
}
```

(The spike tested the owner branches. `admin()` and `inDomain()` are the app's
existing helpers. Whether the owner may delete their own profile is a P2
decision. Deleting it only removes their own access.)

Order of rollout: deploy the server sync (this branch), run
`pnpm users:backfill-team-ids --database <db>` (dry run first, then
`--apply`), and only then deploy rules that read `team_ids`. If the rules go
first, every shared read fails closed until the backfill runs.

The share libraries' 8-cap constants (`lib/rocks-share.ts`,
`lib/scorecard-share.ts`) can be raised or removed in the same P2/P11 change
that swaps `listSharedToMe`, and not before.

## Fallback (not needed, recorded for completeness)

If list queries had failed:

1. **Per-team projection.** Rules cannot see which team a query asked for,
   so a per-team listener needs data shaped per team. Write each share as
   `team_shares/{teamId}/rocks/{rockId}` from the share libraries and gate
   that path with `isMember(teamId)`, one `exists()` per read.
2. **Server-pushed data.** Serve shared rocks and measurables from a server
   action or route that uses the Admin SDK and filters by `team_members`,
   and drop the client listener for shared items. You lose live updates for
   shared rows, or you poll for them.

Neither is needed. The `hasAny()` rule works for the live listeners as they
are written today.
