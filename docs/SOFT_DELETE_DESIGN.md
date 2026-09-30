# Gate 5 — Soft delete, trash retention, and the audit trail

**Status:** design, agreed in principle 2026-09-30 (daniel). Not built.
**Supersedes:** the two-write delete stamp shipped in Gate 4 (C-07), which
stays in place until this lands and becomes the delete write itself.
**Retention numbers below are proposals awaiting HPB sign-off** — see
`docs/HARDENING_LOG.md` Decisions.

## Why

Gate 4 made every delete name its actor by writing `deleted_by` to the
document and then deleting it: two writes, two audit rows, and the
information the bank actually wants ("Jane deleted this rock on the 14th,
here is what it said") lives only in the audit log's `before` snapshot.
Recovery means an operator reading `audit_log` and re-creating the
document by hand.

A soft delete keeps the document, so:

- one write per delete, one audit row, actor on the row itself;
- restore is a first-class action instead of an operator procedure;
- the record and everything hanging off it (milestones, comments, votes,
  ratings) stay coherent until a scheduled purge removes them together;
- "how long do we keep deleted records" becomes an explicit, auditable
  policy instead of "forever, in a log only admins can read".

## Two ways to do it in Firestore

### A. In place: `deleted_at` on the document

The textbook approach: add `deleted_at` / `deleted_by` to every business
document, filter it out everywhere, purge later.

What it costs here, specifically:

- **Firestore has no default query scope and rules are not filters.** A
  list query either includes `where("deleted_at", "==", null)` or it
  returns deleted rows. If rules deny reading deleted docs to members (they
  must, or a hand-rolled query leaks the trash), then every client query
  that forgets the clause fails outright with permission-denied. Server
  loaders (Admin SDK) bypass rules, so a forgotten clause there leaks
  silently.
- **`== null` only matches documents that carry the field.** Every existing
  document in ~12 collections needs a `deleted_at: null` backfill before any
  filtered query sees it — the same trap F4 hit with `archived_at`, and
  legacy rows are still not fully backfilled for that.
- **Composite indexes.** Every query that combines `team_id` (or `owner_id`,
  `rock_id`, …) with the new clause and an `orderBy` needs a new entry in
  `firestore.indexes.json`. There are 88 `.where(` sites today.
- **Read paths are scattered.** Archive exclusion is done in memory in ~24
  page/component/lib files rather than at the query. Soft delete would
  either copy that pattern into all of them or move all of them to
  query-level filtering. Both are a wide, easy-to-miss change to the live app.

Effort L, and the risk is the bad kind: a missed filter shows deleted data.

### B. Relocate: move the document to a `trash` collection

On delete, one batch:

1. `trash/{collection}__{id}` ← the full document plus
   `{ source_collection, source_id, deleted_by, deleted_at, purge_after }`,
   and the same for every cascade child (a rock's milestones and comments,
   an issue's votes and comments, a meeting's ratings) with a
   `deleted_with` back-reference to the parent;
2. delete the originals.

Nothing that reads live data changes. `trash` is a new collection with
one rule (`admin()` read, no client writes), one index, no backfill.
Restore is the mirror batch. The cascade is naturally coherent: children
move with the parent and come back with it.

What it costs:

- The audit trigger sees a delete on the original without `deleted_by` on
  it (the stamp is on the trash copy, written in the same batch). Fix: for a
  delete event with no stamp, the trigger reads `trash/{collection}__{id}`
  and takes `deleted_by` from there — one extra read per delete event,
  only on deletes. Rows still name the actor; `actor_source: "trash"`.
- A restored document's audit history is split across a delete row, a
  trash create row, a trash delete row and a re-create row. That is more
  honest than it is confusing (the trail shows the round trip), but the
  admin trash view should link them.
- Any place that resolves an entity by id from a foreign key (a to-do's
  `source_issue_id`, a notification's entity link, an activity row) now
  finds nothing instead of a document flagged deleted — which is what it
  finds today after a hard delete, so no regression.

Effort M, and the failure mode is benign: a bug in the move leaves a
document in place rather than showing deleted data.

### Recommendation: **B**

It is the smaller and safer change for this codebase, it gives the same
audit and restore properties, and Firestore's native TTL handles the purge
for free. The one property A has that B lacks — a deleted document staying
addressable at its original path — is not something anything in EOS relies
on. If a later requirement wants deleted rows visible in place (e.g. a
"show deleted" toggle in the app rather than an admin trash page), revisit.

## Retention

Two clocks, kept separate on purpose:

| What | Proposed | Mechanism | Why |
|---|---|---|---|
| Deleted records (`trash`) | **1 year** from `deleted_at` | Firestore TTL policy on `purge_after` (a Timestamp = `deleted_at` + 365 d) | Long enough that "we deleted that last quarter, get it back" always works; short enough that the live database doesn't accrete everything ever removed. Changing the number later is a backfill of `purge_after`, not a code change |
| Audit log (`audit_log`) | **7 years**, matching the archive bucket | Firestore TTL on a `purge_after` field set by the trigger | The audit log is what an examiner asks for; it should outlive the records it describes. Today it is kept indefinitely; 7 years aligns it with the export archive's retention policy (also awaiting HPB's confirmation of that figure) |
| Archived records (`archived_at`) | unchanged, kept | — | Archive is a product state (visible in Archived tabs), not a deletion |

TTL deletes fire within ~24 h of the timestamp, are billed as ordinary
deletes, and trigger the audit function like any other delete — so the
purge itself is logged, with `before.deleted_by` still naming the person
who deleted it and the purge attributable to TTL (no auth context, no
stamp on the delete, trash doc gone: `actor_source: null`, entity type
`trash`). Both TTL policies are Terraform resources
(`google_firestore_field` with `ttl_config`) in `terraform/firestore.tf`.

Both numbers go to HPB as proposals. Until they answer, build with the
values above but leave the TTL resources gated on a variable
(`enable_retention_ttl`, default false), same pattern as the other levers.

## What "delete" means in the app after this

Three states, distinct on purpose:

| State | Who sees it | Reversible | Set by |
|---|---|---|---|
| Active | team | — | — |
| Archived (`archived_at`) | team, in Archived tabs | yes, by the team | Monday sweep, manual archive |
| Deleted (in `trash`) | org admins, in an admin Trash page | yes, by an admin (or the team leader for their own team's rows) | Delete button (confirmed, as today) |
| Purged | nobody; `audit_log` keeps the snapshot | no | TTL after 1 year |

The confirm-before-delete dialogs stay. Their copy changes from "This
can't be undone" to "An admin can restore it for a year" — a small change
that a reviewer will read as the policy being real.

## Scope of the build

1. **`lib/firebase/trash.ts`** — `moveToTrash(db, uid, { collection, id, children })`
   and `restoreFromTrash(db, uid, trashId)`; both single batches; children
   declared per entity type in one table (rock → todos where `rock_id`,
   entity_comments; issue → issue_votes, entity_comments; meeting →
   effectiveness_scores; scorecard_group → nothing, metrics get
   `group: null` as today; team_member, agenda, headline, todo, comment,
   metric → no children). `purge_after` computed from a single constant.
2. **Delete actions** (the 12 sites that call `deleteStamp` today) call
   `moveToTrash` instead of stamp-then-delete. `deleteStamp` is removed
   from `lib/firebase/stamp.ts`; `stamp` stays.
3. **Rules:** `match /trash/{id}` — `allow read: if admin()`, no writes.
   Index: `source_collection ASC, deleted_at DESC` for the admin page.
4. **Audit trigger:** `stampedActor` falls back to the trash copy on a
   delete with no stamp; `trash` itself is *not* excluded from auditing
   (a trash create/delete is the deletion record). Set `purge_after` on
   every `audit_log` row.
5. **Admin Trash page** (`/admin/trash`): list by collection, filter by
   team, show title / deleted by / when / purges on, Restore button with
   confirm. Team leaders get the same list scoped to their team under
   Members → Trash (optional, second pass).
6. **Terraform:** two `google_firestore_field` TTL resources behind
   `enable_retention_ttl`; a `trash_retention_days` variable used only for
   documentation (the app owns the constant; keep them equal).
7. **Purge is TTL only.** No Cloud Function sweeps trash. The daily
   freshness checker gains one line: count of trash docs past
   `purge_after` by more than 48 h (TTL falling behind or disabled).
8. **Scripts:** `scripts/restore-from-trash.ts` for the operator path when
   the admin page isn't enough (bulk restore after a bad import delete).
9. **Docs:** `docs/HARDENING_LOG.md` Gate 5 table; `docs/OPERATIONS.md` or
   `TEAM_MGMT_OPS.md` restore procedure; the client-facing data-retention
   line in the security report.

Not in scope: N38 (deactivate user) — related but a different lever (block
sign-in, keep data, never delete the person). Soft-deleting `users` docs
is deliberately excluded; a departed person's history must stay readable.

## Open questions for HPB

1. Confirm 1 year for deleted records and 7 years for the audit log, or
   name their own figures (their records-retention schedule wins).
2. Should team leaders be able to restore their own team's deletions, or
   admins only? (Design assumes admins; leader restore is cheap to add.)
3. Is there any category of record that must be hard-deleted on request
   (a data-subject request, a legal hold release)? If yes, the audit
   log's `before` snapshots are the thing to design for, not trash.

## Estimate

M: about two days of build plus the admin page, on sandbox first. It
depends on nothing in Gate 2. Sequence after the current Gate 4 branch
merges, so the delete-action changes are one clean diff on top of the
stamp helper rather than a merge of two rewrites of the same lines.
