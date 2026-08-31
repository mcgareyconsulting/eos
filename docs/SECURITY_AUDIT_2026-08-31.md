# Security audit — static code review (2026-08-31)

Scope: source code only — Next.js app (server actions, API routes, proxy),
`firestore.rules`, Cloud Functions, the custom XLSX/CSV import pipeline,
Dockerfile / cloudbuild / Terraform as code. No live GCP resources were
inspected or touched.

Overall posture is strong: consistent `requireTeamAccess` / `requireTeamLeader`
/ `requireAdmin` guards on every server action, entity/team cross-checks via
`requireTeamDoc`, default-deny Firestore rules, server-side one-time OAuth CSRF
state, HttpOnly session cookies verified with `checkRevoked`, no
`dangerouslySetInnerHTML` sinks beyond a static theme script, no secrets in the
repo, non-root container, least-privilege Terraform IAM. The findings below are
ordered by severity.

---

## H1 — Audit log captures Google OAuth refresh tokens (HIGH)

`functions/src/index.ts` → `auditTopLevelWrites` matches **every** top-level
collection (`{collection}/{docId}`) and stores the full `before`/`after`
document in `audit_log`. The only excluded collection is `audit_log` itself.

`google_tasks_connections/{uid}` (containing `refresh_token` and
`access_token`) and `oauth_csrf_states/{state}` are top-level collections, so
every connect, token refresh (which happens on nearly every push/pull), and
disconnect copies the user's Google refresh token into `audit_log`:

- `firestore.rules` deliberately default-denies clients on
  `google_tasks_connections` ("Clients must never read refresh tokens"), but
  `audit_log` is readable by any holder of the `role: "admin"` claim — so app
  admins can harvest every connected user's Google refresh token from the log.
- The log is append-only, so tokens persist there **after** a user disconnects
  (the delete event's `before` snapshot contains the token too).
- This also undercuts the documented Secret Manager hardening path in
  `lib/google/tasks.ts` — moving live tokens would still leave copies in the log.

**Fix:** bail out of `recordAuditEvent` for `google_tasks_connections` and
`oauth_csrf_states` (alongside the existing `audit_log` guard), or redact
`refresh_token`/`access_token` keys before writing. Additionally, one-time
purge of existing `audit_log` rows for those collections, and rotation
(disconnect/reconnect) for affected users, should be considered at deploy time.

## M1 — Client-side `issue_votes` writes can inflate issue vote counts (MEDIUM)

`firestore.rules` lets a signed-in member create/update/delete their **own**
`issue_votes` docs with no validation of `count`, while `issues.votes` (the
denormalized counter the UI ranks by) is frozen for clients. The server action
`castVote` computes remaining vote credits by summing the caller's
`issue_votes` docs.

A hand-rolled client can therefore: vote via `castVote` (+1 on
`issues.votes`), then delete its own `issue_votes` doc directly through the
client SDK (allowed by rules; `issues.votes` is not decremented), and repeat.
Each cycle permanently adds +1 to `issues.votes` — unbounded inflation of
issue priority, bypassing the 3-credit cap. Updating `count` to an arbitrary
value is likewise allowed by rules.

**Fix:** all real writes go through the Admin SDK, so set `issue_votes` to
`allow create, update, delete: if false;` (keep member read), matching the
pattern used for other server-owned stamps.

## M2 — Sign-in perimeter never checks `email_verified` (MEDIUM, defense-in-depth)

Neither `createSession()` (`lib/firebase/session.ts`) nor the rules'
`inDomain()` check `email_verified`. Today the app only wires up Google
sign-in, whose emails are attested — but the allowlist gate is purely
email-string-based. If any additional Identity Platform provider is ever
enabled (email/password, or another IdP without verified emails), an attacker
can register `anything@highplainsbank.com` unverified and receive a session
plus in-domain read access (org directory, all team names/rosters, user
emails).

**Fix:** in `createSession`, require `decoded.email_verified === true` when the
allowlist is active; mirror `request.auth.token.email_verified == true` in
`inDomain()`. Cheap insurance against a console-side config change.

## M3 — XLSX import: unbounded decompression (zip bomb → OOM) (MEDIUM)

`lib/xlsx.ts:63` inflates entries with `inflateRawSync(buf.subarray(start))`
with no `maxOutputLength`. The upload is capped at 8 MB, but DEFLATE ratios of
~1000:1 mean a crafted workbook can expand toward multiple GB in memory and
OOM the Cloud Run instance (all sheet XML is additionally held as a JS string).
Authenticated members only, but any member can trigger it repeatedly.

**Fix:** pass `{ maxOutputLength: <e.g. 64 MB> }` to `inflateRawSync` and
surface the error as "file too large"; also compare the declared uncompressed
size from the central directory against the same cap before inflating.

## M4 — Import is member-accessible but documented/UI-gated as leader-only (MEDIUM)

`getImportableTeams` (lib/firebase/teams.ts) states imports are "a
leader-or-admin capability, not a membership one" and the UI builds its team
list that way — but the action `importTeamFile`
(`app/(app)/teams/[teamId]/import/actions.ts`) only calls
`requireTeamAccess(teamId)`. Any plain member can invoke the action directly
and:

- bulk-create/overwrite rocks, to-dos, issues, headlines, and scorecard data
  for their team (collision mode `"update"` rewrites existing docs);
- with `createOwners`, write placeholder `/users/import-*` docs **and
  `team_members` roster rows** — membership creation is otherwise strictly
  leader-gated (`addTeamMember` → `requireTeamLeader`).

**Fix:** use `requireTeamLeader(teamId)` in `importTeamFile` so enforcement
matches the documented model.

## L1 — Scheduler pull-route secret compared non-constant-time (LOW)

`app/api/google/tasks/pull/route.ts` checks `auth !== expected`. Use
`crypto.timingSafeEqual` on equal-length buffers to rule out timing side
channels against `GOOGLE_TASKS_PULL_SECRET` on this unauthenticated route.

## L2 — Google→EOS pull fallback ignores ownership (LOW)

`pullCompletionsForOwner` first matches todos by `google_task_id` + owner, but
when that yields nothing it falls back to completing **any** incomplete todo
carrying the id ("owner_id drifted"). Since rules let any team member set
`google_task_id` on their team's todos (it isn't in the frozen-stamp list), a
member can point a todo at a task id in someone else's connected list and have
the sweep mark it complete. Integrity-only impact, small population.

**Fix:** either drop the ownerless fallback or add `google_task_id` to the
todos stamp-freeze in rules.

## L3 — Leader invite overwrites existing `/users` profile fields (LOW)

`writeMembership` (lib/team-invite.ts) merges leader-typed
`display_name`/`first_name`/`last_name`/`email` onto `/users/{uid}` even when
the account already exists — a leader adding an existing colleague to a second
team can silently rename them org-wide. Only write profile fields when the
user doc doesn't already have them.

## L4 — Housekeeping

- `tmp-dupes.ts` (repo root): ad-hoc ops script with a hard-coded production
  team id; should live in `scripts/` or be deleted.
- `/api/client-error` rate limit is per-instance and in-memory — fine for the
  stated log-noise bound, just noting it doesn't survive scale-out (each
  instance grants its own 60/min).
- `inDomain()` in `firestore.rules` duplicates `SIGN_IN_ALLOWLIST` by hand
  (already documented); drift weakens the read perimeter silently — worth a
  deploy-time check.

---

## Explicitly checked, no issue found

- **Server-action authorization**: every exported action in all 11 action
  modules resolves a guard (`requireTeamAccess`/`requireTeamLeader`/
  `requireAdmin`/`requireFirebaseUser`) before touching Firestore, and
  cross-team smuggling is blocked by `requireTeamDoc` / in-transaction
  team checks (`castVote`, `setRockStatus`, milestone `existingIds` check in
  `updateRockWithMilestones`, comment author check in `deleteEntityComment`).
- **OAuth flow**: server-side one-time CSRF state bound to uid with TTL and
  delete-on-read; redirect URI pinned via env (no open-redirect from
  request-derived values); tokens never returned to clients.
- **Session handling**: HttpOnly, Secure (prod), SameSite=Lax cookie; session
  cookie verified with `checkRevoked: true`; allowlist enforced server-side at
  the single `createSession` chokepoint.
- **XSS**: rich text renders from a parsed AST (`components/rich-text.tsx`);
  the only `dangerouslySetInnerHTML` is a static theme constant in
  `app/layout.tsx`.
- **Secrets**: nothing tracked beyond `.env.example`; deploy script keeps
  secrets out of build args (runtime env sync); client bundle only carries
  public Firebase web config.
- **Infra as code**: non-root runtime user, standalone output, distinct
  build/runtime SAs with narrow roles in Terraform; public ingress is a
  documented, deliberate lever with the IAP alternative spelled out.
