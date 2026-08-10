# Operations — how this system runs and how to change it

The one-page mental model. Every section links to the detailed runbook; this
doc is for orientation, not copy-paste.

## What runs where

The entire system lives in a single GCP project. Nothing runs outside Google
Cloud — no Vercel, no third-party hosting.

| GCP service | What it does here |
|---|---|
| **Cloud Run** | Runs the app itself (service `eos`) — a containerized Next.js server. Scales to zero when idle, scales up on traffic. This is the URL people visit. |
| **Firestore** | The live database. All teams, rocks, to-dos, scorecard data, issues. Prod uses a **named** database (`hpb-eos-prod-db`), not the default one. |
| **Firebase Auth** | Google sign-in. No passwords exist anywhere — people sign in with their `@highplainsbank.com` Google account, and a server-side allowlist decides who gets a session. |
| **Cloud Build** | Turns the source code into a container image. Runs Google-side; nothing is built on a laptop. |
| **Artifact Registry** | Stores the built container images, tagged by git commit, so any previous version can be redeployed. |
| **IAM / service accounts** | The app runs as a dedicated least-privilege service account (`eos-runtime@…`) that can read/write Firestore and write logs — nothing else. |
| **Terraform** | The infrastructure above (APIs, registry, service account, Cloud Run service, optional security levers) is declared as code in [`terraform/`](../terraform/README.md), so it can be reviewed and reproduced instead of clicked together. |

Deferred, by design: the BigQuery warehouse and the Firestore audit-log Cloud
Function (see `ROADMAP.md`). The audit function must not be deployed until its
triggers are pointed at the named database.

**Shipped separately:** Monday **todo archive** Cloud Function
(`archiveStaleTodos`) — `0 3 * * 1` America/Chicago. Moves pure completed
to-dos from before this week's Monday onto Archived. Deploy:
`firebase deploy --only functions:archiveStaleTodos --project <PROJECT_ID>`.
Param `FIRESTORE_DATABASE_ID` defaults to `hpb-eos-prod-db`.

## Environments

| | Project | Firestore DB | Who signs in |
|---|---|---|---|
| **Client demo** ("prod") | `hpb-eos-prod` (client's GCP org) | `hpb-eos-prod-db` | `@highplainsbank.com` + mcgareyconsulting |
| **Local dev** | your machine, `pnpm dev` | `hpb-eos-sandbox-db` (same project, test data) | you |
| **Trial** | `hpb-eos` (McGarey GCP) | `(default)` | open for testing |

Local dev and the deployed app share a GCP project but **not a database**:
`.env.local` (what `pnpm dev` and all data scripts read) points at the
sandbox database, `.env.prod` (what `pnpm ship` reads) points at the live
one. Breaking things locally can't touch live data, and the deploy script
refuses to build from sandbox config. Refresh the sandbox from live at any
time with `pnpm db:copy --from hpb-eos-prod-db --to hpb-eos-sandbox-db`.

Deployments can carry a visible marker so you always know which one you're
looking at: set `ENV_LABEL` (and optionally `ENV_LABEL_TONE`) on the Cloud Run
service and a badge/banner appears in the UI. It's a runtime env var — adding,
changing, or removing it is one command, no rebuild:

```bash
gcloud run services update eos --region us-east1 --project <PROJECT_ID> \
  --update-env-vars ENV_LABEL="DEMO"       # or --remove-env-vars ENV_LABEL
```

## How a change ships

First, make the change (duh). What happens next depends on which of four kinds
of change it is — they have different blast radii and different tools.

### 1. App code (pages, components, logic)

```
edit code → pnpm test → pnpm dev to eyeball it → commit → pnpm ship
```

**Local testing needs no deploy and no emulator.** `pnpm dev` runs the app on
`http://localhost:3000` — real sign-in, hot reload on every file save, and the
**sandbox** database (via `.env.local`), so nothing you do locally can corrupt
live data. Iterate there; deploy when it's right. (Requires `gcloud auth
application-default login` once, so the server side has credentials.)

The deploy step is one command:

```bash
pnpm ship                # build + push + roll Cloud Run, config from .env.prod
pnpm ship -- --dry-run   # print what would run, run nothing
```

`scripts/deploy.sh` reads the `NEXT_PUBLIC_*` config from `.env.prod` (the
live-database config — it refuses to build from sandbox config, so a deploy
can never ship an app pointed at test data), tags the image with the current
git commit, and runs Cloud Build — which builds, pushes to Artifact Registry,
and rolls the Cloud Run service. It refuses to deploy config for one project
into another, and flags a dirty working tree in the image tag.

After a successful roll it also **merges** a small allowlist of runtime keys
from the same env file onto the Cloud Run service (today:
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_REDIRECT_URI` — only keys that are set). Other service env
(`SIGN_IN_ALLOWLIST`, `ENV_LABEL`, …) is left alone. To push those keys
without a rebuild:

```bash
pnpm ship -- --sync-env
```

Because images are tagged by commit, "what's running" always answers to
"which commit," and rollback is redeploying a previous tag — old images stay
in Artifact Registry. (Raw gcloud equivalent: `DEPLOY.md` §6.2.)

**Ship from `main`, not a feature branch.** There's one Cloud Run service and
it's what the client sees. `pnpm ship` runs fine from a worktree, but
deploying unmerged code means the running tag can point at a commit that gets
rebased away, and the next deploy from `main` silently reverts it. Develop on
a branch against the sandbox, PR, merge, then ship.

### 2. Runtime configuration (no rebuild)

Server-only settings — the sign-in allowlist, the environment label — are env
vars on the Cloud Run service. Changing one takes effect on the next revision,
about 30 seconds, no build:

```bash
gcloud run services update eos --region us-east1 --project <PROJECT_ID> \
  --update-env-vars "^|^SIGN_IN_ALLOWLIST=@highplainsbank.com,daniel@mcgareyconsulting.com"
```

(The `^|^` prefix makes `|` the delimiter so the value's own commas survive —
gcloud otherwise splits on them.)

**The trap to know:** anything named `NEXT_PUBLIC_*` is **not** runtime config.
Those values are baked into the JavaScript bundle when the image is built —
changing one means a rebuild (change type 1), and setting it as a runtime env
var does nothing. This is the single most common way to make a change that
silently doesn't take.

### 3. Database rules and indexes

Firestore's security rules (`firestore.rules`) and composite indexes
(`firestore.indexes.json`) live in the repo and deploy with the Firebase CLI:

```bash
firebase deploy --only firestore:rules,firestore:indexes --project <PROJECT_ID>
```

Rules are the enforcement layer for who can read/write what — treat edits with
the same care as auth code. Details and the named-database caveat: `DEPLOY.md` §3.2.

### 4. Infrastructure (service accounts, IAM, registry, security levers)

Declared in `terraform/`. The loop is always plan-then-apply, and the plan
output is the review artifact:

```bash
cd terraform
terraform plan -var="project_id=<PROJECT_ID>" -var="region=us-east1" -out=change.tfplan
# read the plan — it says exactly what will be created/changed/destroyed
terraform apply change.tfplan
```

Never `apply` without reading the plan. Plan files embed state (including env
vars), so they're gitignored — don't share them.

## Data operations

People and historical data are managed with repo scripts (all read
`.env.local` for which project/database to talk to — check that before
running anything):

| Command | Purpose |
|---|---|
| `pnpm accounts:create "Name <email>"` | Pre-create sign-in accounts so imported data attaches to the right person before their first login. Sends no email; the account activates on first Google sign-in. |
| `pnpm import:csv …` | Back-import ninety.io exports (rocks, scorecard, to-dos). Handles xlsx and csv; see `CSV_IMPORT.md` for owner-aliasing and history cutoffs. |
| `pnpm team:info` | Inspect a team — members, counts, ids. The "what does the database actually say" tool. |
| `pnpm team:delete` | Remove a team and its data. Destructive; it prompts. |
| `pnpm db:copy --from <db> --to <db>` | Copy every document between Firestore databases — refreshing the sandbox from live. Only writes into databases with `sandbox` in the id. |

Adding a new user, end to end: `accounts:create` with their email → they sign
in with Google at the app URL → they appear under the team (or request to
join). If they have historical CSV data, import it with `--owner-alias`
pointing their CSV name at their email **before** telling them to sign in.

## Access needed to operate this

- **Deploy code / change runtime config:** Cloud Run Admin + permission to use
  Cloud Build (Editor covers both).
- **Change IAM / run Terraform:** Project IAM Admin + Service Account Admin on
  top of Editor — Editor alone deliberately cannot grant roles.
- **Rules, Auth settings, authorized domains:** Firebase Admin (or Editor +
  Firebase console access).
- **Data scripts:** Application Default Credentials
  (`gcloud auth application-default login`) as an account with Firestore and
  Firebase Auth admin access.

## Where the detail lives

- [`DEPLOY.md`](./DEPLOY.md) — full first-time standup runbook, every command
- [`CUTOVER_CHECKLIST.md`](./CUTOVER_CHECKLIST.md) — moving trial → client project, the validated diff
- [`CSV_IMPORT.md`](./CSV_IMPORT.md) — importer flags, formats, and gotchas
- [`CLIENT_GCP_SETUP.md`](./CLIENT_GCP_SETUP.md) — what the client's team provides (non-engineer checklist)
- [`terraform/README.md`](../terraform/README.md) — infrastructure module
- [`ROADMAP.md`](./ROADMAP.md) — what's decided, deferred, and blocked
