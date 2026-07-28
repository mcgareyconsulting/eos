# Local development

Run the app on your laptop against the **sandbox Firestore database** — real
Google sign-in, real Firestore, real everything, on disposable data. Hot
reload on every file save, no build, no deploy.

This is the development loop. Ship with `pnpm ship` when it's right
([OPERATIONS.md](OPERATIONS.md)).

## Prerequisites

- **Node 22** and **pnpm**.
- `gcloud` authenticated as an account with access to the project.

## One-time setup

```bash
pnpm install
gcloud auth application-default login    # credentials for the Admin SDK
```

`.env.local` is already configured and **should not be overwritten** — it
points at `hpb-eos-prod` with `NEXT_PUBLIC_FIREBASE_DATABASE_ID=hpb-eos-sandbox-db`.
(Do not `cp .env.example .env.local`; that template is emulator-mode boilerplate
and would blow away this config.) If you're setting up a fresh machine, copy
`.env.local` from another machine or rebuild it from the Firebase console
values — see [DEPLOY.md](DEPLOY.md) §6.2.

## Run it

```bash
pnpm dev        # http://localhost:3000
```

Sign in with Google as your normal account. You'll land on Home with the
sandbox data — the same teams, rocks, and to-dos as live, because the sandbox
was seeded by copying from it.

That's the whole loop: edit a file, save, see it in the browser.

## Two databases, one project

`hpb-eos-prod` holds both:

| Database | Read by | Contents |
|---|---|---|
| `hpb-eos-prod-db` | the deployed Cloud Run service (`.env.prod`) | live client data |
| `hpb-eos-sandbox-db` | `pnpm dev` and every script (`.env.local`) | disposable copy |

Same project, same Auth accounts, same rules and indexes. Only the data
differs. Two consequences worth internalizing:

- **Nothing you do locally can corrupt live data.** Delete a team, run a bad
  import, wipe a collection — the client's app is untouched.
- **`pnpm ship` refuses to build from `.env.local`.** The database id is
  compiled into the bundle, so a sandbox-built image would serve test data
  from the client-facing URL. The guard has no override flag.

### Resetting the sandbox

```bash
pnpm db:copy --from hpb-eos-prod-db --to hpb-eos-sandbox-db --dry-run   # count first
pnpm db:copy --from hpb-eos-prod-db --to hpb-eos-sandbox-db
```

Copies every collection and subcollection, preserving document ids so uids
still line up with Auth. It only writes into databases with `sandbox` in the
id — there is no flag to aim it at live. It's a copy, not a sync:
documents that exist only in the sandbox survive, so `pnpm team:delete` first
if you want an exact mirror.

### Scripts follow `.env.local` too

`pnpm import:csv`, `pnpm team:info`, `pnpm team:delete`, `pnpm accounts:create`
all read `.env.local`, so they hit the **sandbox** by default. Rehearse any
import there, confirm the result with `pnpm team:info`, then re-run against
live by passing `--project`/editing the env — deliberate friction, on purpose.

> **`pnpm accounts:create` is the exception that isn't sandboxed.** Firebase
> Auth is *project*-level, not per-database, so creating an account affects
> both. That's usually what you want (the same person signs into both), but
> it means account creation is not a reversible sandbox experiment.

## Troubleshooting

- **`5 NOT_FOUND` on every read.** `NEXT_PUBLIC_FIREBASE_DATABASE_ID` is
  wrong or missing in `.env.local` — the SDK is talking to a `(default)`
  database that doesn't exist. It should read `hpb-eos-sandbox-db`.
- **"The query requires an index."** A composite index is still building, or
  a new query needs one. Check with
  `gcloud firestore indexes composite list --database=hpb-eos-sandbox-db --project hpb-eos-prod`;
  add it to `firestore.indexes.json` and `firebase deploy --only firestore:indexes`
  (which updates both databases).
- **Sign-in refused.** `SIGN_IN_ALLOWLIST` is a *server* env var; locally it
  comes from `.env.local`. Unset means open sign-in.
- **Wrong Google account, no picker.** The account chooser is forced
  (`prompt: "select_account"` in `lib/firebase/client.ts`). If you still land
  on the wrong account, sign out at accounts.google.com.
- **`pnpm` not found.** `corepack enable` (ships with Node 22).

## Emulator mode (legacy, unsupported)

The code still honors `NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true` and
`pnpm emulators` still works, but **this is not the development path** — the
sandbox database gives you the same isolation without the JVM dependency,
the seed-data divergence, or the "works locally, breaks in the cloud"
surprises that come from the emulator not enforcing the same rules and index
requirements as real Firestore.

It survives in the codebase for one reason: a fully offline demo with no GCP
project at all. If you need that, `pnpm emulators` (requires Java 11+) plus a
separate env file, then `pnpm seed <your-email>`. Don't point `.env.local` at
it.
