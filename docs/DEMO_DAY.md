# Demo day runbook

Goal: a working demo in front of the client, fastest path first. There are two
plans — **run both if you can**: Plan A is your guaranteed safety net, Plan B is
the "real thing" once the GCP project exists.

---

## Plan A — Local emulator demo (works right now, zero cloud) ✅ do this first

No GCP, no credentials, no network dependency. This runs entirely on your
laptop and is immune to whatever happens with the client's GCP setup during the
meeting. **Get this running before you leave** so you always have something to
show.

```bash
pnpm install
cp .env.example .env.local          # ships in emulator mode
pnpm emulators                      # terminal 1
pnpm dev                            # terminal 2
pnpm seed leader@highplainsbank.com # terminal 3, once
```

Open <http://localhost:3000> → **Sign in with Google** → sign in as
`leader@highplainsbank.com` in the emulator screen → you're on a fully seeded
Home. Full walkthrough script: [DEMO.md](DEMO.md). Setup details and
troubleshooting: [LOCAL_DEV.md](LOCAL_DEV.md).

For the multiplayer beat, open a second/incognito window and sign in as one
of the seeded teammates (e.g. `sarah.chen@highplainsbank.com`) — the seed
creates real emulator Auth accounts for them, so votes and the "Discussing
now" pin sync live between the two windows.

Requires **Java 11+** on your laptop (`java -version`) for the emulators —
verify this tonight, not in the parking lot.

Time: ~5 minutes.

---

## Plan B — Real Firebase project (the client's GCP)

This is what you're actually setting up together. It only becomes runnable once
a few things exist on their side. Fastest route to a live demo is to run the app
**locally against the real project** (skip the Cloud Run build), then do the full
Cloud Run deploy as a follow-up.

### B0. Prerequisites the client must complete first

Walk these from [CLIENT_GCP_SETUP.md](CLIENT_GCP_SETUP.md) §1–§3. Minimum to get
a demo running:

1. **GCP project created** (e.g. `hpb-eos-prod`) and you granted access
   (Editor is fine to start; scope down later — §2 of that doc).
2. **Firebase enabled** on the project, **Authentication → Google sign-in
   turned on**, and your account's domain added to **Authorized domains**.
3. **Firestore database created** (pick the location — `nam5` is the
   recommendation; it's **permanent**, so confirm before clicking).

### B1. Point your local app at the real project

```bash
# authenticate the admin SDK / seed to the real project
gcloud auth application-default login
gcloud config set project <PROJECT_ID>
```

Edit `.env.local`:

- `NEXT_PUBLIC_FIREBASE_USE_EMULATOR=false`
- delete the two `*_EMULATOR_HOST` lines
- fill the `NEXT_PUBLIC_FIREBASE_*` values from **Firebase console → Project
  settings → General → Your apps → Web app** (create a Web app if there isn't one)
- optionally `NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN=highplainsbank.com`

### B2. Push the security rules (once)

```bash
firebase deploy --only firestore:rules,firestore:indexes --project <PROJECT_ID>
```

### B3. Sign in once, then seed

```bash
pnpm dev
```

Open the app, **Sign in with Google** as your real `@highplainsbank.com`
account (this creates your Auth user). Then:

```bash
pnpm seed <your-login-email>
```

Reload — you're on a seeded demo backed by the real project. **This is a live
demo you can show without a full deploy.**

> **Multiplayer caveat:** on the real project the synthetic teammates are
> Firestore-only (display names, no real sign-in) — you can't sign in as one
> like you can on the local emulator. Showing the live-sync beat here needs a
> second real `@highplainsbank.com` Workspace account that has joined via
> `/join` and been approved by the leader.

### B4. (Follow-up) Deploy to Cloud Run

Not needed for the demo, but the real hosting target. Full runbook:
[DEPLOY.md](DEPLOY.md) — Artifact Registry, least-privilege runtime service
account, `gcloud builds submit`, custom domain. Budget 30–60 min the first time.

---

## Order of operations for the meeting

1. **Before the meeting:** confirm Plan A runs on your laptop (Java installed,
   `pnpm emulators` + seed + sign-in all work).
2. **Open the meeting on the demo** — run Plan A so the conversation is anchored
   to something real on screen while GCP provisions in the background.
3. **Walk [CLIENT_GCP_SETUP.md](CLIENT_GCP_SETUP.md)** and get the §1–§3 items
   done live (project, IAM grant, Google sign-in, Firestore location). These are
   the only blockers for Plan B.
4. **If time allows,** do B1–B3 to show the app on their real project.
5. **After the meeting:** B4 (Cloud Run deploy) + the remaining
   CLIENT_GCP_SETUP decisions (security tier, custom domain, backups).

## Watch-outs

- **Firestore location is permanent.** Don't click through it — confirm `nam5`
  (or their choice) deliberately.
- **`NEXT_PUBLIC_FIREBASE_*` are baked in at build time.** For local `pnpm dev`
  a `.env.local` edit + restart is enough; for Cloud Run they must be passed as
  build substitutions (DEPLOY.md §6).
- **Seed by your login email**, not a guessed UID — it guarantees the data lands
  on a team your account can see.
- **Emulator data is ephemeral** — restarting the emulators wipes it; just
  re-seed. The real project persists.
