# EOS

A self-hosted alternative to ninety.io for running [EOS](https://www.eosworldwide.com/) — Level 10 meetings, Scorecard, Rocks, To-Dos, Issues, Headlines, and a personal Home dashboard. Built for High Plains Bank.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Firebase (Firestore + Firebase Auth) · GCP (Cloud Run).

## Features

- **Home** — every open to-do and active rock across all your teams, yours first.
- **Scorecard** — weekly KPIs on a 13-week rolling grid, grouped into sections; on-/off-track coloring, per-metric owners and goals.
- **Rocks** — quarterly goals with owners, status (on/off-track, done, cancelled), append-only status history, and milestones.
- **To-Dos** — 7-day action items, team or private, assignable, with due dates.
- **Issues** — team issues ranked by votes (3 credits per person), worked through live during the meeting.
- **Headlines** — customer wins, employee news, and cascading messages.
- **Level 10 Meeting** — a live, timed orchestrator with **custom agendas** (stage order + durations; pick template at Start). Default Level 10 is Segue → Scorecard → Rocks → Headlines → To-Dos → Issues → Conclude (90 min). Shared segment state, meeting-rating (each attendee rates the meeting 1–10), and a post-meeting recap.

## Setup

> **Just want to run it locally?** The fastest path needs **no cloud project at
> all** — see **[docs/LOCAL_DEV.md](docs/LOCAL_DEV.md)**, which runs Firebase Auth
> + Firestore in local emulators. The steps below configure a **real** Firebase
> project (for staging/production / a deployed demo).

### 1. Install deps

```bash
pnpm install
```

### 2. Configure Firebase

This app uses a single Firebase project for Firestore + Auth.

1. In the [Firebase Console](https://console.firebase.google.com/): create a project (or use the existing HPB one).
2. **Authentication → Sign-in method →** enable **Google** and set "Restrict by domain" to `highplainsbank.com`. App access is HPB SSO only — no external allowlist (see [Security](#security)).
3. **Project Settings → General → Your apps → Web app** — copy the config values.
4. Copy `.env.example` to `.env.local`, then fill in the `NEXT_PUBLIC_FIREBASE_*`
   values. `.env.example` **ships in emulator mode**, so for a real project set
   `NEXT_PUBLIC_FIREBASE_USE_EMULATOR=false` and delete the two `*_EMULATOR_HOST`
   lines (see the comments in the file).

```bash
cp .env.example .env.local
```

### 3. Admin credentials (server / scripts)

Server code and the seed script use the Firebase Admin SDK. Locally, authenticate once with Application Default Credentials:

```bash
gcloud auth application-default login
```

(In production on Cloud Run, ADC is injected automatically — leave the admin env vars blank. See `.env.example` for the service-account alternatives.)

### 4. Run

```bash
pnpm dev
```

Open <http://localhost:3000>. You'll be redirected to `/login` — sign in with Google.

### 5. Seed demo data

The seed populates **every screen** for a believable bank leadership team (4 teammates, rocks + milestones, a 13-week scorecard, ranked issues, to-dos, headlines, and a completed meeting). It's idempotent — re-run it for a clean slate between demos.

```bash
pnpm seed <your-login-email>      # or pass your UID
```

Pass the **email or UID of the account you sign in to the app with** — using your login email guarantees the data lands on a team your account can actually see. The seed finds (or creates) a team named "Demo Team", makes you its leader, and fills it. (Get a UID from **Firebase Console → Authentication → Users** if you prefer.)

See **[docs/DEMO.md](docs/DEMO.md)** for the 5–10 minute walkthrough script.

### 6. Import real data (optional)

To seed a team from a client's actual numbers instead of the synthetic demo
set, `pnpm import:csv` loads scorecards, rocks, and milestones from
ninety.io-style CSV, TSV, or .xlsx exports (or any spreadsheet with the same
columns):

```bash
pnpm import:csv --team "Enterprise Systems & Data" --create-team \
  --leader <your-login-email> \
  --scorecard scorecard.csv --rocks rocks.csv --milestones milestones.csv --dry-run
```

`--create-team` creates the team, `--leader` puts your account on it, and every
distinct `Owner` in the files becomes a team member — so an export is enough to
stand up a whole team.

See **[docs/CSV_IMPORT.md](docs/CSV_IMPORT.md)** for the column reference,
owner matching, and re-run behavior. Templates live in
[`scripts/csv-templates/`](scripts/csv-templates).

## Deploy (Cloud Run)

The app deploys to Cloud Run in the client's GCP project — see
**[docs/DEPLOY.md](docs/DEPLOY.md)** for the full runbook (required APIs,
Artifact Registry, least-privilege runtime service account, `gcloud builds
submit` via `cloudbuild.yaml`, Firestore rules deploy, Firebase Auth domain
restriction, and optional security levers).

For what the client needs to do on their end to get a real deployment
rolling (GCP project, IAM access, sign-in domain, security tier), send them
**[docs/CLIENT_GCP_SETUP.md](docs/CLIENT_GCP_SETUP.md)**.

## Onboarding flow

- Sign-in is Google OAuth → an HttpOnly session cookie (`lib/firebase/session.ts`); `proxy.ts` gates every route.
- **Members** has two tabs: **This team** (roster + meeting settings) and **All teams** (org directory of every team/roster). Membership is **invite-only**.
- **Org admin** (`role: "admin"` custom claim): Members → All teams → New team (name → invite leader → Done). Admins have god-mode access to all team data.
- **Team leader**: on Members, pre-provisions members (name + email). No invite email is sent; people sign in with Google when ready.
- Grant admin claim: `pnpm admin:set-role --email you@highplainsbank.com --apply` (then sign out/in).

## Security

**Directory vs data:** `teams`, `team_members`, and `users` are readable org-wide (soft directory). Rocks, issues, todos, headlines, scorecard, meetings, etc. require **team membership** or the **admin** claim — mirrored by `requireTeamAccess()` / `requireTeamLeader()` / `requireAdmin()` on the server.

The **sign-in perimeter** is the server-enforced `SIGN_IN_ALLOWLIST` checked in `createSession()` (`lib/firebase/session.ts`): a comma-separated list of allowed domains (`@highplainsbank.com`) and exact emails (the consultant's account, for the duration of the engagement). Accounts outside it are refused a session — the client-side `hd` hint and the provider's domain restriction are not used for enforcement, since neither can express "domain plus one account". Unset, sign-in is open (emulator/trial). As defense-in-depth, the broad org/user/team reads in `firestore.rules` (`inDomain()`) mirror the same perimeter — keep the two in lockstep. Admin in-app is the Identity Platform `role: "admin"` custom claim. Consultant / operator administration happens at the **GCP IAM + Admin SDK layer** (HPB-granted), which bypasses these rules and needs no app login.

## Project structure

```
app/
  (auth)/login/                 — Google sign-in
  join/                         — legacy; redirects to /directory (invite-only)
  (app)/                        — auth-gated route group
    layout.tsx                  — sidebar shell
    home/                       — personal dashboard
    directory/                  — legacy redirect → Members → All teams
    teams/[teamId]/
      scorecard/ rocks/ todos/
      issues/ headlines/
      members/                  — This team | All teams tabs; admin new-team
      meetings/                 — agenda templates + meeting history
      meetings/[meetingId]/     — live meeting orchestrator (segment components)
components/                     — app shell, shared UI
lib/
  firebase/                     — admin, client, auth, session, teams helpers
  l10/segments.ts               — built-in stage tools (labels, default timings)
  l10/agenda.ts                 — agenda templates + meeting agenda snapshots
  dates.ts  scorecard.ts        — date bucketing + metric formatting
scripts/seed-demo.ts            — comprehensive demo seed
firestore.rules                 — security rules
proxy.ts                        — Next.js 16 proxy: session refresh + route gating
```
