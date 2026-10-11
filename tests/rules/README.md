# tests/rules

Emulator tests for the real `firestore.rules`. Unlike `spikes/`, these are
permanent and run against the app's own rules file.

Covers: every client read the app makes (see the `READS` table) is allowed for
a team member and denied for a non-member and anonymous callers; shared lists
have no 8-team cap; notifications are readable only by their `user_id`; and
every collection rejects client set/update/delete/create, including with an
admin-claim token.

Not covered: the Admin SDK (bypasses rules), `inDomain()` email checks, and
whether the app's real queries match `READS` (keep it in sync by hand when a
listener changes).

## Run

Needs Java (JDK 11+) and the repo's `firebase-tools`. First run downloads the
emulator jar to `~/.cache/firebase/emulators/`. Run from the repo root:

    pnpm test:rules

The `demo-` project id keeps it offline. It is deliberately outside the
default `pnpm test` glob, which needs no emulator.
