# Local development — zero-cloud (Firebase emulators)

Run the **entire app on your laptop with no GCP project and no credentials.**
Auth and Firestore run locally in the Firebase Emulator Suite, so you can review
changes, click through every screen, and rehearse the demo without waiting on
any cloud setup.

This is the fastest way to look at what's built and the safety net for demo day
(see [DEMO_DAY.md](DEMO_DAY.md)).

## Prerequisites

- **Node 22** and **pnpm** (already required by the app).
- **Java 11+** — the Firebase emulators run on the JVM. Check with `java -version`.
  If missing: macOS `brew install openjdk`, or install any Temurin/OpenJDK 11+.
- `firebase-tools` is a dev dependency, so `pnpm install` pulls it in — no global
  install needed. (First `pnpm emulators` run downloads the emulator jars once.)

## One-time setup

```bash
pnpm install
cp .env.example .env.local     # ships in emulator mode — no editing needed
```

`.env.local` arrives preset for the emulators:
`NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true` plus the two `*_EMULATOR_HOST` lines.
The project id is `demo-hpb-eos` — the `demo-` prefix is Firebase's convention
for "emulator only, can never touch a real project."

## Run it (three terminals)

```bash
# 1 — emulators (Auth :9099, Firestore :8080, Emulator UI :4000)
pnpm emulators

# 2 — the app
pnpm dev

# 3 — seed the demo data (run once; re-run any time for a clean slate)
pnpm seed leader@highplainsbank.com
```

Then open <http://localhost:3000>:

1. You'll be redirected to `/login`. Click **Sign in with Google**.
2. A **local emulator** account screen opens (not real Google). Sign in as
   **`leader@highplainsbank.com`** — the same address you seeded — either by
   picking it from the list or via **Add new account**.
3. You land on **Home** with every screen populated.

> **Why that email?** The emulator keys users by email, so seeding
> `leader@highplainsbank.com` and signing in as `leader@highplainsbank.com` line
> up on the same uid. If you'd rather sign in first as some other address, that
> works too — just re-run `pnpm seed <that-email>` afterward. The seed is
> idempotent and always attaches your account to the "Demo Team" as leader.

## Handy

- **Inspect data live:** Emulator UI at <http://127.0.0.1:4000> — browse Auth
  users and Firestore documents, edit them by hand.
- **Clean slate:** re-run `pnpm seed …`. It clears the Demo Team's data first.
- **Emulator data is in-memory.** Stopping the emulators (Ctrl-C) wipes both
  Auth users and Firestore. Just restart and re-seed — takes seconds.

### Audit-log trigger (optional)

`pnpm emulators` stays lean — **auth + firestore only** — which is all the app
needs and the fastest thing to boot for a demo. To also run the audit-log
Cloud Function (the `onWrite` Firestore trigger that mirrors every change into
the `audit_log` collection — see [DEPLOY.md](DEPLOY.md) §4), use:

```bash
pnpm emulators:all      # builds functions/ + runs auth, firestore, functions
```

Then every write — from the app, `pnpm seed`, or a hand-edit in the Emulator
UI — appends an immutable row to `audit_log`, exactly as it will in production.
A full seed produces ~170 audit rows; browse them at
<http://127.0.0.1:4000/firestore>. Requires the same **Java 11+** as the other
emulators (the functions themselves run on the host's Node).

## What to look at (recent ninety.io drift changes)

- **Scorecard** — 13-week grid, KPIs grouped into ninety-style sections
  (Customer, Deposit & Loan Volume, Risk & Compliance); add/rename a group inline.
- **Rocks** — Company / Department / Individual type badges (company first),
  milestone progress chips, editable descriptions.
- **Issues** — Urgent / High / Medium / Low priority badges, ranked by priority
  then votes; edit owner/priority/description from the row.
- **Meetings** — conclude a meeting and rate **the meeting** 1–10 (not peers);
  the recap and history show the average plus each person's rating.
- **Home** — milestones due within 7 days surface alongside your to-dos.

## Pointing at a real Firebase project instead

When you have a real project (staging or the client's), edit `.env.local`:

- set `NEXT_PUBLIC_FIREBASE_USE_EMULATOR=false`
- delete the two `*_EMULATOR_HOST` lines
- fill the `NEXT_PUBLIC_FIREBASE_*` values from the Firebase console
- run `gcloud auth application-default login` so the admin SDK / seed have creds

Then `pnpm dev` and `pnpm seed <your-login-email>` hit the real project. See
[DEMO_DAY.md](DEMO_DAY.md) for the full go-live sequence and
[DEPLOY.md](DEPLOY.md) for the Cloud Run deploy.
