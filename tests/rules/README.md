# tests/rules

Emulator tests for the real `firestore.rules`. Unlike `spikes/`, these are
permanent and run against the app's own rules file.

- `firestore.rules.test.ts` — smoke matrix: the app's client reads allowed for
  a team member and denied for a non-member and anonymous callers; shared
  lists have no 8-team cap; notifications are readable only by their
  `user_id`; the feedback tracker (`feedback_items` + its `activity`, and its
  comment threads in `entity_comments`) is readable by no client, admin
  claim included (server-only, behind its access list); every collection rejects client set/update/delete/create,
  including with an admin-claim token.
- `parity.rules.test.ts` — the rules against the server access modules
  (`lib/access/**`) on one set of fixtures:
  1. every fixture document × every viewer (admin, parent leader, parent
     member, audience team, audience person, off-team assignee, private
     creator, outsider): a document read is allowed exactly when the module's
     `canSee` (threads: `canComment`) says so;
  2. every live client query shape (`SHAPES`, plus threads and the activity
     trace), run by every viewer from every team page they can open: it must
     be allowed and return exactly the matching documents the module allows;
  3. hand-rolled queries the UI never makes (unpinned `visibility`, whole
     collections, threads by `team_id`, the directory) are refused;
  4. the lookup budget (scorecard entries chunked at `RULES_GET_IN_LIMIT`).

When a listener changes, update `SHAPES` (parity) by hand: nothing checks the
app's real queries against it.

Note: Firestore proves a list query against its filters, not each stored
document; an unfiltered field read with `.get(field, default)` takes the
default. A rule clause that a default makes TRUE can therefore over-return
on a hand-rolled list. The parity suite pins the one known case (legacy
private milestones, see "KNOWN GAP").

Not covered: the Admin SDK (bypasses rules).

## Run

Needs Java (JDK 11+) and the repo's `firebase-tools`. First run downloads the
emulator jar to `~/.cache/firebase/emulators/`. Run from the repo root:

    pnpm test:rules

The `demo-` project ids keep it offline. It is deliberately outside the
default `pnpm test` glob, which needs no emulator.
