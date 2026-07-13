# Your GCP Setup Checklist

What we need from your team, in order, to move EOS from demo to a real
deployment inside your own Google Cloud environment — and why each step is
what it is. Share the technical runbooks
([`DEPLOY.md`](./DEPLOY.md), [`../terraform/README.md`](../terraform/README.md))
with whoever will actually run commands; this one's for the people deciding
what to grant.

EOS runs entirely inside your own GCP org — nothing lands on outside
infrastructure or a third party (the demo you've been using is hosted
elsewhere and gets retired once this is live).

---

## 1. Stand up (or designate) a GCP project

- [ ] Either designate an existing GCP project for EOS, or create a new one
      in your org (suggested ID: `hpb-eos-prod`).
- [ ] Confirm billing is enabled on that project.
- [ ] Send over the **Project ID** (not the display name — the ID is
      immutable and what every command in the runbook keys off).

**Why:** everything below — the app, its database, the build pipeline —
deploys into this one project. Nothing else can start until it exists and
billing is on.

## 2. Grant us access on that project

Grant the named account(s) below IAM access on your project, in your Cloud
Console → IAM.

| Option | What it is | Tradeoff |
|---|---|---|
| **Fast path (recommended to start)** | `roles/editor` on the project, granted to `[names/emails to be provided at kickoff]` | Broad but standard for an initial buildout; easy to grant, easy to review, easy to narrow later |
| **Scoped path** | A custom role covering just: Service Usage Admin, IAM Admin, Cloud Run Admin, Artifact Registry Admin (+ Compute/Audit Config Admin only if you want us running the optional security add-ons in §5 for you) | Smaller footprint, more setup time up front — pick this if your security review requires least-privilege from day one |

**Why:** an IAM grant, not a handoff. You see exactly what's been given,
can narrow it later, and can pull it at any time from your own Console —
nothing to track down or rotate elsewhere if access ever needs to end.

## 3. Confirm your Firebase project and sign-in domain

- [ ] Confirm whether we're using an existing Firebase project tied to the
      GCP project above, or creating a new one.
- [ ] Confirm the **Google Workspace domain** used for employee sign-in
      (defaults to `highplainsbank.com` in the current build). App access is
      gated to that domain via Google SSO only.

**Why:** you already run identity, MFA, and offboarding through Workspace.
Signing in through it means EOS doesn't need a second password system to
maintain, and access already tracks your real employee roster.

## 4. Make a few build decisions

- [ ] **CI/CD:** Google Cloud Build (already scaffolded — see
      `cloudbuild.yaml`) or GitHub Actions? Cloud Build is the path of least
      resistance today.
- [ ] **Sizing:** a rough sense of expected concurrent users, so we can set
      sensible Cloud Run min/max instance counts (currently placeholder
      0–2, i.e. scales to zero when idle).
- [ ] **Custom domain**, if you want one at launch (e.g.
      `eos.highplainsbank.com`). Not a blocker — can be added after go-live
      once we know who owns DNS on your side.

**Why:** these three set the shape of the deploy — where builds run, how
much the app costs to run idle vs. busy, and what URL people land on. Easy
to change later, but worth deciding once up front.

## 5. Choose a starting security tier

None of these are required to run the app — the baseline (below) is already
least-privilege by default. Dollar figures are ballparks; we'll verify
against current GCP pricing before anything is quoted for real.

| Tier | Included | Cost |
|---|---|---|
| **Tier 0 — baseline** (on by default, no action needed) | Dedicated least-privilege service account, Secret Manager, default-deny Firestore rules, domain-restricted sign-in, Cloud Audit Logs, full application audit trail (every create/update/delete on every record), Security Command Center Standard | Free / included |
| **Tier 1 — recommended for a bank** | Web Application Firewall (Cloud Armor) + DDoS protection, customer-managed encryption keys (CMEK), Firestore point-in-time recovery (~7 days), Data Access audit logging, load balancer in front of the app | ~$40–75/mo total |
| **Tier 2 — enterprise / regulatory** | VPC Service Controls perimeter, Security Command Center Premium, Access Transparency, Assured Workloads | Quote on request — mostly design/ops effort, not per-resource fees |

**Why:** the baseline is already bank-reasonable at zero extra cost.
Everything past that is a real, recurring cost, so it's a deliberate choice
rather than something that shows up on a bill unexplained. Our suggestion:
start on Tier 0, layer in Tier 1 ahead of go-live per your security review.

## 6. Later, not needed yet: your BigQuery conventions

EOS data is headed into the same BigQuery warehouse as your Jack Henry
migration, on a nightly batch (not real-time — more on that below). It's
waiting on your BigQuery conventions: dataset naming, region, partitioning
standard, PII handling policy, retention policy, and who gets read access.
**Not a blocker for today's deploy** — just flagging it for whenever those
conventions solidify.

**Why nightly, not real-time:** BigQuery is built for queries over history,
not instant reads. EOS runs on a weekly cadence (meetings, scorecards), so
a warehouse copy doesn't need sub-second freshness. The live app experience
already runs on Firestore's real-time updates, at no extra cost — the
nightly BigQuery sync is purely for your cross-source reporting.

---

## What happens once we have the above

1. **We provision the infrastructure as code** (Terraform) against your
   project. *Why:* you get a reviewable plan of exactly what gets created
   before it's created — nothing done by hand that can't be reproduced or
   handed to your own team later.
2. **We deploy the app to Cloud Run** in your project, backed by your
   Firestore project, gated by your Workspace sign-in domain. *Why Cloud
   Run:* EOS is a low-traffic internal tool, not a public product — Cloud
   Run scales to zero when idle and needs no servers for anyone to patch or
   manage.
3. **We turn on the audit-log trigger** so every data change (create,
   update, delete — including admin/console edits) is captured. *Why a
   trigger, not app-level logging:* every write passes through this one
   layer, so it's the one place nothing can slip past — for a bank, "the
   audit log can't be worked around" is what matters.
4. **We hand you the Cloud Run URL** (or your custom domain, once DNS is
   pointed) for a first look before wider rollout.
5. **We layer in whichever security tier you've chosen** from §5.

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
