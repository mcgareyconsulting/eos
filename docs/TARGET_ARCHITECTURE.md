# EOS target architecture — VPC-centric, bank-grade (2026-09-08)

Companion to `SECURITY_AUDIT_2026-09-08.md`. That document says what is
wrong today; this one says where we are going and in what order.

**Driver.** HPB leadership wants security clarity and a VPC/subnet-centric
posture. The current design (public `*.run.app` URL, app-layer sign-in as
the only gate, secrets as plain env vars, Terraform state on a laptop) was a
deliberate MVP trade-off documented in `HPB_IAM_REQUEST.md`. It is no longer
the target. The app is also expected to keep growing — more modules, more
integrations, BigQuery as a warehouse target, possibly SSO changes — so the
target has to be a platform, not a one-off hardening of one Cloud Run
service.

---

## 1. Principles

1. **Two perimeters, not one.** Identity gates *people* (Workspace SSO, MFA,
   context-aware access). Network gates *data* (private ingress, VPC egress,
   VPC Service Controls). Today only the first exists, and it is enforced
   inside the app rather than in front of it.
2. **No public surface.** No public IP, no `allUsers` invoker, no
   `*.run.app` hostname in use. One front door: a Global External Application
   Load Balancer with Cloud Armor and Identity-Aware Proxy.
3. **No long-lived credentials.** Service-account key creation disabled by
   org policy. CI authenticates with Workload Identity Federation.
   Service-to-service calls use OIDC tokens, never shared bearer strings.
   The few real secrets live in Secret Manager and are mounted, not pasted.
4. **Everything is code and applied by a pipeline.** Terraform state in a
   versioned, CMEK-encrypted GCS bucket. Deploys from Cloud Build, not
   `pnpm ship` on a laptop. Firestore rules and indexes deploy from the same
   pipeline.
5. **Environments are projects.** `hpb-eos-dev`, `hpb-eos-stage`,
   `hpb-eos-prod` under one folder, with the same Terraform module and
   different tfvars. Prod is never the place a change is seen first.
6. **Audit by default.** Cloud Audit Logs (Admin Activity + Data Access),
   the app's own row-level audit log, and log sinks to a retention-locked
   bucket and to BigQuery. Security Command Center on, alerts routed.

## 2. Honest note on "VPC maxing" a serverless stack

Firestore, Identity Platform, Secret Manager, BigQuery and Google Tasks are
Google APIs. They do not sit in a subnet, so "put the database in the VPC"
does not literally apply. The VPC-centric equivalent, which is what
regulated GCP customers actually run, is:

| Goal | Mechanism |
| --- | --- |
| App has no public IP | Cloud Run ingress `internal-and-cloud-load-balancing`; only the LB can reach it |
| App traffic to Google APIs never touches the public internet | Direct VPC egress from Cloud Run into a subnet + Private Google Access + Cloud DNS private zone pointing `*.googleapis.com` at the `restricted.googleapis.com` VIP |
| Google APIs only answer from inside the bank's boundary | VPC Service Controls perimeter around the project(s) with access levels for the LB path, CI and named operators |
| Nothing else can egress | VPC firewall default-deny egress; Cloud NAT only if a non-Google endpoint is ever needed (none today) |

If leadership's intent is *subnet-resident* data stores (Cloud SQL / AlloyDB
private IP), that is a re-platform of the data layer, not a hardening step.
Firestore's realtime listeners are the core of the L10 meeting experience;
a Postgres path would need a separate realtime layer. Recommendation: do not
re-platform now. Build the perimeter above, which delivers the same control
objectives, and revisit the data layer only if the requirements stack
demands it.

## 3. Target topology (production)

```
HPB staff (Workspace account, MFA, managed device)
   │  https://eos.highplainsbank.com
   ▼
Cloud DNS (public zone)  ─►  Global External Application LB
                              ├─ Google-managed cert, HTTP→HTTPS redirect, HSTS
                              ├─ Cloud Armor policy
                              │    OWASP CRS preconfigured rules (sqli/xss/rce/lfi)
                              │    rate limit per IP, adaptive protection
                              │    optional: allow only HPB office/VPN egress ranges
                              ├─ Identity-Aware Proxy
                              │    principal: group hpb-eos-users@highplainsbank.com
                              │    access level (Access Context Manager): HPB IPs / managed devices
                              └─ Serverless NEG
                                     │
                                     ▼
                         Cloud Run service `eos`  (hpb-eos-prod, us-east1)
                           ingress: internal + LB only     min instances: 1
                           SA: eos-runtime (datastore.user, logWriter, secretAccessor on named secrets, firebaseauth.admin*)
                           secrets: Secret Manager references, not env values
                           Direct VPC egress → subnet eos-run-us-east1 (VPC hpb-eos-vpc), egress ALL via VPC
                                     │
                    ┌────────────────┼──────────────────────┐
                    ▼                ▼                       ▼
        Private Google Access   VPC firewall            Cloud Scheduler
        DNS: *.googleapis.com → default-deny egress     OIDC token (scheduler SA)
        restricted.googleapis.com   (allow 199.36.153.4/30) → eos /api/google/tasks/pull
                    │                                    (or an internal-only `eos-worker` service)
   ┌────────────────┼─────────────────────────────────────────────┐
   ▼                ▼                 ▼               ▼           ▼
Firestore        Secret Manager   Identity         BigQuery     Artifact Registry
hpb-eos-prod-db  (OAuth secret,   Platform         (warehouse   (CMEK, vuln scanning,
CMEK, PITR,       pull secret     Google/Workspace  project)     Binary Authorization)
scheduled backups, retired→OIDC)  provider only,
delete protection                 blocking fn: hd + email_verified → claim hpb=true

Cloud Functions gen2 (audit triggers, Monday sweep): same VPC egress, ingress internal.

═══════════════ VPC Service Controls perimeter: hpb-eos-prod (+ warehouse project via bridge) ═══════════════
   restricted services: firestore, secretmanager, run, cloudfunctions, eventarc, artifactregistry,
   bigquery, logging, storage, cloudkms, cloudscheduler
   access levels: LB/IAP path, Cloud Build WIF pool, named operators (consultant) from allowed IPs

Bitbucket Pipelines ──WIF (no keys)──► Cloud Build (SA eos-build) ──► Artifact Registry ──► Cloud Run (no-traffic revision → canary → 100%)
Terraform state: gs://hpb-eos-tfstate (versioning, CMEK, uniform access, in hpb-eos-infra or prod)
Log sinks: _Default → retention-locked bucket (≥1y); audit_log + Data Access logs → BigQuery dataset for the bank's SIEM
```

\* `firebaseauth.admin` is only needed for `createSessionCookie`; see audit
finding I-06 for narrowing options.

## 4. Identity and session model

| Today | Target |
| --- | --- |
| Any Google account can mint a Firebase ID token for the project; the app refuses a *session* unless `SIGN_IN_ALLOWLIST` matches | Identity Platform **blocking function** (`beforeSignIn`) rejects any token whose `hd` is not `highplainsbank.com` or whose email is unverified, and stamps a custom claim `hpb: true`. Non-HPB accounts never get a token at all. |
| `firestore.rules` hardcodes the consultant's personal email in `inDomain()` | Rules check `request.auth.token.hpb == true`. Consultant access is an HPB-issued Workspace account (or IAP group membership + GCP IAM), never a hardcoded gmail. |
| 5-day session cookie, no idle timeout, sign-out only clears the cookie | 8–12 h session, `revokeRefreshTokens` on sign-out, Workspace offboarding disables the Firebase user (nightly reconciliation job or Directory push), `checkRevoked` already on. |
| Admin role set by a laptop script (`set-admin-role.ts`) | Admin claims managed from an in-app admin console gated by IAP group **and** admin claim, with every change audit-logged. Scripts retired or run from a Cloud Run job. |
| IAP absent | IAP is the outer gate (who may reach the app at all); Firebase session remains the inner gate (who the app thinks you are and what team/role you hold). Both stay. |

## 5. Secrets, CI/CD and supply chain

- **Secret Manager** for `GOOGLE_OAUTH_CLIENT_SECRET`, `SIGN_IN_ALLOWLIST`
  (until the blocking function replaces it), anything future. Cloud Run
  mounts them by reference; the runtime SA gets `secretAccessor` on each
  secret, not project-wide.
- **Retire `GOOGLE_TASKS_PULL_SECRET`.** Cloud Scheduler calls the pull
  route with an OIDC token; the route verifies the Google-signed ID token's
  audience and the caller SA. No shared string to leak or rotate.
- **Dedicated build SA** `eos-build` with `run.developer`, `artifactregistry.writer`,
  `iam.serviceAccountUser` on the runtime SA only. Stop using the Compute
  Engine default SA (it carries Editor on most projects).
- **Workload Identity Federation** pool for Bitbucket Pipelines. No SA keys
  anywhere; enforce with `iam.disableServiceAccountKeyCreation` and
  `iam.disableServiceAccountKeyUpload`. Delete the
  `FIREBASE_SERVICE_ACCOUNT_JSON` code path in `lib/firebase/admin.ts`.
- **Artifact Registry vulnerability scanning** on; pin base images by
  digest; **Binary Authorization** requires an attestation from `eos-build`
  before Cloud Run will run an image.
- **Rollout**: deploy `--no-traffic`, smoke test the tagged revision via the
  LB, shift 10% → 100%; rollback is a traffic flip.
- **Dependency hygiene** in CI: `pnpm audit --prod` fails the build on high
  or critical; Renovate/Dependabot on the client repo.

## 6. Data protection and audit

- Firestore: **CMEK** (bank-owned key ring, 90-day rotation), **PITR** on,
  **scheduled daily backups** with 30+ day retention to a bucket in the
  perimeter, **delete protection** on the database.
- **Data Access audit logs** on for Firestore, Secret Manager, BigQuery,
  Identity Toolkit. Cost is real on read-heavy paths; sample or scope if needed.
- App `audit_log`: keep the Cloud Function trigger, but every server action
  stamps `actor_uid` on the document so Admin SDK writes are attributable.
  Stream `audit_log` to BigQuery; prune Firestore copies after 90 days.
- Log sinks: project `_Default` → bucket with **retention lock**; security
  logs → BigQuery dataset the bank's SIEM can read.
- Security Command Center (Standard is free; Premium/Enterprise if the bank
  already licenses it at org level), with findings routed to a bank channel.
- Retention/deletion policy for user PII (names, emails, Google Tasks
  tokens) written down and enforced by a job.

## 7. Org policies to request from HPB's cloud team

| Constraint | Value | Why |
| --- | --- | --- |
| `iam.disableServiceAccountKeyCreation` | enforce | no exportable credentials |
| `iam.disableServiceAccountKeyUpload` | enforce | same |
| `iam.allowedPolicyMemberDomains` | HPB customer ID only | blocks `allUsers` and outside identities (currently `allValues: ALLOW` per `HPB_IAM_REQUEST.md`) |
| `run.allowedIngress` | `internal-and-cloud-load-balancing` | no service can be made public again |
| `run.allowedVPCEgress` | `all-traffic` | every Cloud Run service routes through the VPC |
| `cloudfunctions.allowedIngressSettings` | `ALLOW_INTERNAL_ONLY` | functions never public |
| `compute.vmExternalIpAccess` | deny all | belt-and-braces; no VMs expected |
| `compute.restrictVpcPeering` / `compute.skipDefaultNetworkCreation` | enforce | no default network |
| `storage.uniformBucketLevelAccess` | enforce | no ACL surprises on backup/state buckets |
| `gcp.resourceLocations` | `in:us-locations` | data residency |

## 8. Growth: how the platform absorbs the next two years

- **New modules** ship as routes in the same Next.js service until they need
  their own scaling or runtime; then they become additional Cloud Run
  services behind the same LB with path routing, same VPC, same perimeter.
  Service-to-service calls use IAM-authenticated Cloud Run invocations.
- **Background work** (BigQuery sync, Google Tasks pull, archive sweeps)
  moves to a Cloud Run *job* / internal-only `eos-worker` service triggered
  by Scheduler with OIDC, so the user-facing service never carries a public
  route for a machine caller.
- **Data warehouse**: nightly Firestore export → BigQuery in the bank's
  warehouse project, joined to the perimeter with a VPC-SC bridge. Row-level
  audit stream lands in the same dataset.
- **SSO changes** (roadmap N52): Identity Platform supports SAML/OIDC
  providers; the blocking function is where `hd`/`email_verified` policy
  lives, so adding a provider does not reopen the perimeter.
- **Shared VPC**: if HPB runs a host project, `hpb-eos-*` become service
  projects and the subnets above are carved from the bank's ranges; the
  design does not change.
- **AI features (deferred)**: Vertex AI is in-perimeter and reachable over
  the restricted VIP; the API-key AI Studio path stays retired.

## 9. Phased plan

| Phase | Scope | Effort | Recurring cost |
| --- | --- | --- | --- |
| **0 — Stop the bleeding** (this week, no infra change) | Upgrade Next.js ≥16.2.11; fix code findings (email_verified, session TTL + revoke, timing-safe compare, actor stamping); move secrets to Secret Manager refs; Terraform state to GCS; API-key restrictions | 2–3 days | ~$0 |
| **1 — Front door** | Custom domain, Global External ALB, Cloud Armor (CRS + rate limit), IAP with Workspace group, Cloud Run ingress internal+LB, drop `allUsers`, HSTS/CSP headers | 1–2 weeks | ~$25–50/mo (LB forwarding rule + Armor policy) |
| **2 — No public surface** | Dedicated VPC + subnet, Direct VPC egress, Private Google Access + restricted VIP DNS, firewall deny-egress, Scheduler → OIDC, dedicated build SA + WIF, Binary Authorization, org policies above | 1–2 weeks | ~$0–10/mo |
| **3 — Regulator-ready data** | VPC-SC perimeter (+ bridge to warehouse), CMEK on Firestore/AR/buckets, PITR + scheduled backups + delete protection, Data Access logs, retention-locked sinks, SCC routing, blocking function replaces allowlist and hardcoded rules email | 2–3 weeks (perimeter dry-run first) | ~$10–40/mo + log volume |
| **4 — Platform for growth** | dev/stage/prod projects, Cloud Build promotion pipeline with canary, `eos-worker` internal service, admin console for roles, offboarding automation, BigQuery pipeline inside perimeter | ongoing | dev/stage compute at idle-to-zero |

Phases 1–3 are the "VPC/subnet" ask. Phase 0 is independent and should not
wait for any of them.

## 10. Decisions needed from HPB

1. **IAP in front, or Firebase-only?** Recommendation: both (IAP outer, Firebase inner).
2. **Network allowlist at Cloud Armor** (office/VPN egress only) or **device/context-aware access via IAP**? Depends on whether staff use EOS off-network.
3. **Where the perimeter boundary sits**: EOS project alone, or EOS + warehouse project together.
4. **Who owns the KMS keys** and the Terraform state bucket (bank cloud team vs. app team).
5. **Consultant access model** post-cutover: HPB-issued Workspace account vs. IAP group + time-boxed IAM.
6. **Session length** the bank's policy requires (drives the 8 h vs 12 h choice).
