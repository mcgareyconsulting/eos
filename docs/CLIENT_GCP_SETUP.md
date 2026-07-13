# GCP Setup Checklist — for High Plains Bank

**Purpose:** what we need from your side to deploy EOS into your own Google
Cloud environment. This is the client-facing companion to the engineering
runbook in [`DEPLOY.md`](./DEPLOY.md) and [`../terraform/README.md`](../terraform/README.md) —
read this one first; hand those to whoever on your team will actually run
commands.

## The short version

EOS runs entirely inside High Plains Bank's own GCP org — nothing lands on
consultant infrastructure or a third party (the Vercel-hosted demo is being
retired at cutover). To move from demo to a real deployment, we need a small
number of things from your team: a GCP project, IAM access granted to us,
a handful of decisions, and — for a later phase, not blocking today —
your BigQuery conventions.

**On "keys": there mostly aren't any.** This app is built to avoid exported
service-account credentials entirely — Cloud Run authenticates to
Firestore/Auth using its own attached identity (Application Default
Credentials), not a JSON key file passed around over email or checked into a
repo. What you're actually granting us is **IAM access on a GCP project**,
which you can review, scope, and revoke at any time from your Cloud Console.
The one piece of "config" that looks key-shaped — the Firebase web SDK
values — is public client configuration, not a secret; see the callout in
[§3](#3-firebase-project--sign-in).

---

## What we need from you

### 1. A GCP project

- [ ] Either designate an existing GCP project for EOS, or create a new one
      in your org (suggested ID: `hpb-eos-prod`).
- [ ] Confirm billing is enabled on that project.
- [ ] Send us the **Project ID** (not the display name — the ID is
      immutable and what every command below keys off).

### 2. Access for us — an IAM grant, not a credential file

Grant the named account(s) below IAM access on the project. No
service-account key is created or exported as part of this — access is a
revocable role binding you control in Cloud Console → IAM at any time.

| Option | What it is | Tradeoff |
|---|---|---|
| **Fast path (recommended to start)** | `roles/editor` on the project, granted to `[names/emails to be provided at kickoff]` | Broad but standard for an initial buildout; easy to grant, easy to review, easy to narrow later |
| **Scoped path** | A custom role covering just: Service Usage Admin, IAM Admin, Cloud Run Admin, Artifact Registry Admin (+ Compute/KMS/Audit Config Admin only if you want us running the optional security add-ons in §5 for you) | Smaller footprint, more setup time up front — pick this if your security review requires least-privilege from day one |

Either way: **we do not need, and will not ask for, a downloadable
service-account key.** If a request for one ever comes through, that's a
sign something's wrong with the setup — flag it.

### 3. Firebase project + sign-in

- [ ] Confirm we're using an existing Firebase project tied to the GCP
      project above, or creating a new one.
- [ ] Confirm the **Google Workspace domain** used for employee sign-in
      (defaults to `highplainsbank.com` in the current build). App access is
      gated to that domain via Google SSO only — there is no separate
      password system and no email allowlist to maintain.

> **Why the Firebase values aren't secret:** Firebase Console → Project
> Settings → Your apps hands out an API key, auth domain, project ID, etc.
> These get compiled into the app's public JavaScript bundle — any visitor's
> browser can already see them. They identify *which* Firebase project the
> app talks to; they don't grant access to it. Security comes from the
> sign-in domain restriction above and Firestore's server-side rules, not
> from keeping these values hidden.

### 4. A few build decisions

- [ ] **CI/CD:** Google Cloud Build (already scaffolded — see
      `cloudbuild.yaml`) or GitHub Actions? Cloud Build is the path of least
      resistance today; GitHub Actions is fine too but needs Workload
      Identity Federation set up instead (still no exported keys).
- [ ] **Sizing:** rough expected concurrent users, so we can set sensible
      Cloud Run min/max instance counts (currently placeholder 0–2, i.e.
      scales to zero when idle).
- [ ] **Custom domain**, if wanted at launch (e.g. `eos.highplainsbank.com`).
      Not a blocker — can be added after go-live once we know who owns DNS.

### 5. Security posture — pick a starting tier

None of these are required to run the app; they're add-ons layered on top of
a baseline that's already least-privilege by default (dedicated service
account, no exported keys, default-deny Firestore rules, domain-restricted
sign-in, full audit logging of every data change). Dollar figures are
ballparks — we'll verify against current GCP pricing before anything is
quoted for real.

| Tier | Included | Cost |
|---|---|---|
| **Tier 0 — baseline** (on by default, no action needed) | Least-privilege service account with zero exported keys, Secret Manager, default-deny Firestore rules, domain-restricted sign-in, Cloud Audit Logs, full application audit trail (every create/update/delete on every record), Security Command Center Standard | Free / included |
| **Tier 1 — recommended for a bank** | Web Application Firewall (Cloud Armor) + DDoS protection, customer-managed encryption keys (CMEK), Firestore point-in-time recovery (~7 days), Data Access audit logging, load balancer in front of the app | ~$40–75/mo total |
| **Tier 2 — enterprise / regulatory** | VPC Service Controls perimeter, Security Command Center Premium, Access Transparency, Assured Workloads | Quote on request — mostly design/ops effort, not per-resource fees |

We'd suggest starting on Tier 0 for the initial buildout (fully functional,
nothing missing for day-to-day use) and layering in Tier 1 ahead of go-live
per your security review. Tier 2 is worth a conversation but isn't a
day-one need.

### 6. Later phase, not needed yet — BigQuery conventions

We know EOS data is headed into the same BigQuery warehouse as your Jack
Henry migration. That pipe (nightly batch sync, date-partitioned, includes a
full change-history audit log) is scoped and ready to build — it's waiting
on your BigQuery conventions: dataset naming, region, partitioning
standard, PII handling policy, retention policy, and who gets read access.
**Not a blocker for today's deploy** — just flagging it so it's on your
radar for whenever that migration's conventions solidify.

---

## What happens once we have the above

1. **We provision the infrastructure as code** (Terraform) against your
   project — you get a reviewable plan/diff before anything is created, not
   a black box.
2. **We deploy the app to Cloud Run** in your project, backed by your
   Firestore project, gated by your Workspace sign-in domain.
3. **We turn on the audit-log trigger** so every data change (create,
   update, delete — including admin/console edits) is captured, independent
   of app code.
4. **We hand you the Cloud Run URL** (or your custom domain, once DNS is
   pointed) for a first look before wider rollout.
5. **We layer in whichever security tier you've chosen** from §5.

## What you're explicitly not being asked for

- No exported service-account JSON keys, ever. If your org policy team wants
  to enforce this org-wide (`constraints/iam.disableServiceAccountKeyCreation`),
  we can point them at the org policy to flip — that's a call for your cloud
  team to make, not something we set unilaterally.
- No app data or credentials stored outside your GCP project.
- No AI/LLM features calling out to third-party model APIs — that
  functionality has been pulled from the app pending a Vertex-AI-only
  redesign inside your GCP perimeter, if and when it's revived.

---

## For your IT / cloud team (technical detail)

The above is deliberately light on commands. Once the checklist items are
settled, your engineers (or ours, with the access from §2) can follow:

- [`docs/DEPLOY.md`](./DEPLOY.md) — full manual runbook: APIs, Artifact
  Registry, the runtime service account, Firestore rules deploy, Firebase
  Auth configuration, the audit-log Cloud Function, and the build/deploy
  command itself.
- [`terraform/README.md`](../terraform/README.md) — the same footprint as
  code, meant for review before granting access: what's managed, what's
  deliberately left to the console, prerequisites, and the security-lever
  Terraform flags backing the §5 tiers above.
- [`docs/ROADMAP.md`](./ROADMAP.md) — longer-running architecture notes,
  including the Firestore → BigQuery data flow design referenced in §6.

## Open items blocking full rollout

Tracked in `docs/ROADMAP.md`; repeated here for visibility:

- [ ] Which GCP project (§1)
- [ ] Named accounts to grant IAM access to (§2)
- [ ] Cloud Build vs. GitHub Actions (§4)
- [ ] Traffic/sizing expectations (§4)
- [ ] Security tier selection (§5)
- [ ] BigQuery conventions, once available (§6) — not urgent
