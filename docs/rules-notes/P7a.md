# P7a - firestore.rules needed (not applied here)

`scorecard_metrics` read:

    allow read: if isAdmin()
      || resource.data.get('is_public', false) == true
      || isTeamMember(resource.data.team_id)
      || resource.data.get('shared_team_ids', []).hasAny(myTeamIds());

i.e. metric read = home team member + admin + is_public + tracking team via
`hasAny(team_ids)` (no 8-element unroll; no cap on tracking teams).
`scorecard_entries` read inherits: allow if the parent metric (`metric_id`)
is readable by the same predicate. Writes unchanged (server actions via Admin
SDK). The field `shared_team_ids` keeps its name for now.

Migration: existing metrics with non-empty `shared_team_ids` must be
backfilled `is_public: true` (spec section 9) before the rules ship, else
tracking teams keep access via hasAny but the metric board will not list them.
