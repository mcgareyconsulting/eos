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

## Who you'll want in the loop

Most of this lands on your IT/cloud team, but four other people get asked
for something along the way:

- **Your Google Workspace admin** — employee sign-in runs through Workspace (§3).
- **Whoever owns your DNS** — only if you want a custom domain at launch (§4).
- **Compliance / risk** — data retention and the vendor-review process (§9).
- **Finance** — the billing account and a monthly budget number (§1, §8).

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
| **Scoped path** | A custom role covering just: Service Usage Admin, IAM Admin, Cloud Run Admin, Artifact Registry Admin (+ Compute/KMS/Audit Config Admin only if you want us running the optional security add-ons in §5 for you) | Smaller footprint, more setup time up front — pick this if your security review requires least-privilege from day one |

**Why:** an IAM grant, not a handoff. You see exactly what's been given,
can narrow it later, and can pull it at any time from your own Console —
nothing to track down or rotate elsewhere if access ever needs to end.
(How and when this access *ends* is spelled out in §9.)

## 3. Confirm your Firebase project and sign-in domain

- [ ] Confirm whether we're using an existing Firebase project tied to the
      GCP project above, or creating a new one.
- [ ] Confirm the **Google Workspace domain** used for employee sign-in
      (defaults to `highplainsbank.com` in the current build). App access is
      gated to that domain via Google SSO only.
- [ ] Pick the **Firestore database location** — either a single region
      (e.g. `us-central1`, colocated with the app) or the **US multi-region**
      (`nam5`), which replicates the database across multiple US regions for
      a stronger availability and durability guarantee. This choice is
      **permanent** for the database.

**Our recommendation on the location:** the US multi-region (`nam5`). At
your data size the cost premium is pennies, and it's the strongest
durability answer to give a security review. If your BigQuery conventions
from the Jack Henry migration pin everything to a single region, tell us
now and we'll match that instead.

**Why:** you already run identity, MFA, and offboarding through Workspace.
Signing in through it means EOS doesn't need a second password system to
maintain, and access already tracks your real employee roster. The database
location is called out because it's the one setting in this list that can't
be changed later without a migration.

## 4. Make a few build decisions

- [ ] **CI/CD:** Google Cloud Build (already scaffolded — see
      `cloudbuild.yaml`) or GitHub Actions? Cloud Build is the path of
      least resistance today; both work fine. (This connects to where the
      source code lives long-term — see §9.)
- [ ] **Sizing:** a rough sense of expected concurrent users, so we can set
      sensible Cloud Run min/max instance counts. The real choice here:
      scale to zero when idle (free overnight, but the first person in on
      Monday morning waits a few seconds for a cold start) or keep one
      instance warm (~$10–15/mo, always instant). For a meeting tool with a
      predictable morning spike, **we recommend one warm instance.**
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
| **Tier 0 — baseline** (on by default, no action needed) | Dedicated least-privilege service account, Secret Manager, default-deny Firestore rules, domain-restricted sign-in, Cloud Audit Logs, full application audit trail (every create/update/delete on every record), **scheduled database backups to your own storage bucket, uptime + error monitoring, billing budget alerts**, Security Command Center Standard | Free / near-free |
| **Tier 1 — recommended for a bank** | Web Application Firewall (Cloud Armor) + DDoS protection, customer-managed encryption keys (CMEK), Firestore point-in-time recovery (~7 days), Data Access audit logging, load balancer in front of the app | ~$40–75/mo total |
| **Tier 2 — enterprise / regulatory** | VPC Service Controls perimeter, Security Command Center Premium, Access Transparency, Assured Workloads | Quote on request — mostly design/ops effort, not per-resource fees |

For context: the app itself costs roughly **$10–30/mo** to run at your
scale (one warm instance ~$10–15, database a few dollars, builds and
storage pennies). The tiers above stack on top of that.

**Why:** the baseline is already bank-reasonable at zero extra cost.
Everything past that is a real, recurring cost, so it's a deliberate choice
rather than something that shows up on a bill unexplained. Our suggestion:
start on Tier 0, layer in Tier 1 ahead of go-live per your security review.
(Backups, monitoring, and budget alerts used to be an afterthought in plans
like this — we've moved them into the baseline because they're nearly free
and they're the first three questions any review asks.)

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

## 7. Cutover from the demo

The demo you've been using runs on our infrastructure with its own
database. Before go-live there's one decision on your side:

- [ ] **Demo data: migrate or fresh start?** If your team has been entering
      real teams, rocks, issues, or to-dos into the demo, we can export
      that data and import it into your new environment at cutover.

**Our recommendation:** fresh start. A clean slate at go-live means no
migration risk and no demo artifacts in your production data — unless real
work is genuinely living in the demo, in which case tell us and we'll
schedule the export/import as a cutover step.

**Our commitment at cutover:** we decommission the demo end-to-end —
retire its hosting, revoke every credential it used, and delete (or hand
over) its database. After cutover, nothing of EOS exists outside your GCP
org.

## 8. Who runs it after go-live

The app is designed so HPB self-administers day-to-day. Four things make
that real:

- [ ] **An alerts destination.** Give us an email or group (e.g.
      `it-alerts@highplainsbank.com`) — uptime, error, and budget alerts go
      there, not to us, from day one.
- [ ] **A self-administration handoff session.** Before go-live we run a
      working session with your team leads: create the real teams, assign
      leaders, grant your admin accounts, and hand over the short
      "make someone an admin" runbook. After that, administration is yours
      and our involvement is by invitation.
- [ ] **Staging before production.** **We recommend** a second copy of the
      app (`eos-staging`, a few dollars a month) in the same project, so
      every change is verified there before it touches the version your
      teams actually meet in. We'd stand this up before the first
      production deploy.
- [ ] **Patching ownership.** Someone has to rebuild and redeploy when a
      security update lands in the app's dependencies. **Our
      recommendation:** we own it through the buildout — monthly updates,
      out-of-band for anything critical — and at handoff you choose:
      continue under a light maintenance arrangement, or we train your team
      and hand over the runbook. Decide before go-live, not after.

**Why:** "who gets paged and who patches" is the part of every deployment
that gets discovered instead of decided. Deciding it now is free; deciding
it during an incident is not.

## 9. For your risk & compliance team

Worth putting in front of the right people now — none of it blocks the
deploy, and one item is usually the longest pole in the tent:

- **Our access is time-bound.** Treat the §2 grant as reviewable: check it
  quarterly, remove it at engagement end. Our own offboarding is an
  explicit item on the handoff checklist — you shouldn't have to remember
  to un-grant us.
- **Source code access.** **Our recommendation:** your team gets read
  access to the source repository from day one, and ownership transfers to
  an HPB-controlled account at handoff. (This also feeds the §4 CI
  decision — if you'd rather builds trigger from your own GitHub
  organization, GitHub Actions edges out Cloud Build.)
- **Data retention.** EOS will hold internal performance data, and issues
  or to-dos can contain customer-identifying details. The audit trail is
  append-only and currently keeps everything. **Our recommendation:** have
  compliance confirm a retention schedule (banks commonly hold seven
  years) when the BigQuery conventions land — we'll enforce it in the
  warehouse and put the live copy on a matching expiry.
- **Vendor review.** If third-party access to a bank system triggers your
  vendor-risk process (questionnaire, NDA, background checks), start that
  paperwork now — it's routinely the slowest item on this whole list, and
  nothing here needs to wait for it except final go-live sign-off.

---

## What happens once we have the above

1. **We provision the infrastructure as code** (Terraform) against your
   project — including the baseline monitoring, budget alerts, and
   scheduled backups from §5/§8. *Why:* you get a reviewable plan of
   exactly what gets created before it's created; nothing done by hand
   that can't be reproduced or handed to your own team later.
2. **We deploy the app to Cloud Run** in your project — staging copy
   first, then production — backed by your Firestore database, gated by
   your Workspace sign-in domain. *Why Cloud Run:* EOS is a low-traffic
   internal tool, not a public product; it scales to zero when idle and
   needs no servers for anyone to patch or manage.
3. **We turn on the audit-log trigger** so every data change (create,
   update, delete — including admin/console edits) is captured. *Why a
   trigger, not app-level logging:* every write passes through this one
   layer, so it's the one place nothing can slip past; for a bank, "the
   audit log can't be worked around" is what matters.
4. **We hand you the Cloud Run URL** (or your custom domain, once DNS is
   pointed) for a first look, then run the §8 handoff session before wider
   rollout.
5. **We layer in whichever security tier you've chosen** from §5, and
   execute the §7 demo decommission at cutover.

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

## Open decisions

Tracked in `docs/ROADMAP.md`; repeated here for visibility. The first five
gate the initial deploy; the rest gate go-live or later phases.

- [ ] Which GCP project (§1)
- [ ] Named accounts to grant IAM access to (§2)
- [ ] Firestore database location — single region or `nam5` multi-region (§3)
- [ ] Cloud Build vs. GitHub Actions (§4)
- [ ] Sizing — warm instance or scale-to-zero (§4)
- [ ] Security tier selection (§5) — before go-live
- [ ] Demo data: migrate or fresh start (§7) — before cutover
- [ ] Alerts destination (§8) — before go-live
- [ ] Staging copy (§8, recommended) — before go-live
- [ ] Patching/maintenance ownership at handoff (§8)
- [ ] Audit-data retention schedule (§9) — with the BigQuery conventions
- [ ] BigQuery conventions, once available (§6) — not urgent
