# IAM request — `hpb-eos-prod` (for HPB's GCP admin)

**From:** Daniel McGarey (`daniel@mcgareyconsulting.com`, currently
`roles/editor` on the project)
**Date:** 2026-07-27 · **Needed by:** Tue 2026-07-29 EOD to demo from this
project Wednesday; otherwise the demo runs from our trial environment and
this becomes a Thursday item.

## Context

We provisioned the EOS app's infrastructure in `hpb-eos-prod` today via
Terraform: required APIs, an Artifact Registry repo, a least-privilege
runtime service account (`eos-runtime@hpb-eos-prod.iam.gserviceaccount.com`),
and the Cloud Run service (`eos`, us-east1). All of that succeeded.

What did **not** succeed: the 8 IAM bindings that let the app and its build
pipeline actually run. `roles/editor` deliberately cannot modify IAM policy,
so these need someone with IAM-admin rights in your org.

Two ways to resolve — **either one works**; Option A is one grant and lets
us manage the rest as reviewable Terraform, Option B keeps all IAM changes
in your hands.

## Option A — grant Daniel temporary IAM rights (preferred)

```bash
gcloud projects add-iam-policy-binding hpb-eos-prod \
  --member=user:daniel@mcgareyconsulting.com --role=roles/resourcemanager.projectIamAdmin
gcloud projects add-iam-policy-binding hpb-eos-prod \
  --member=user:daniel@mcgareyconsulting.com --role=roles/iam.serviceAccountAdmin
gcloud projects add-iam-policy-binding hpb-eos-prod \
  --member=user:daniel@mcgareyconsulting.com --role=roles/run.admin
```

Three roles because the bindings sit at three levels: project policy
(`projectIamAdmin`), the runtime service account's policy
(`serviceAccountAdmin`), and the Cloud Run service's policy (`run.admin`).
Revoke all three after cutover is confirmed — the app does not depend on
Daniel's personal access. This also unblocks the upcoming Bitbucket → Cloud
Build connection (its secrets need an IAM grant to the Cloud Build agent).

## Option B — apply the 8 bindings yourselves

Everything the app needs, nothing more. The `eos-runtime` SA is the app's
own identity; `580850228782-compute@…` is the project's Compute Engine
default SA, which Cloud Build uses to deploy.

```bash
# Runtime SA — what the app itself may do
gcloud projects add-iam-policy-binding hpb-eos-prod \
  --member=serviceAccount:eos-runtime@hpb-eos-prod.iam.gserviceaccount.com --role=roles/datastore.user
gcloud projects add-iam-policy-binding hpb-eos-prod \
  --member=serviceAccount:eos-runtime@hpb-eos-prod.iam.gserviceaccount.com --role=roles/logging.logWriter
gcloud projects add-iam-policy-binding hpb-eos-prod \
  --member=serviceAccount:eos-runtime@hpb-eos-prod.iam.gserviceaccount.com --role=roles/firebaseauth.admin

# Cloud Build deploy identity — what a build may do
gcloud projects add-iam-policy-binding hpb-eos-prod \
  --member=serviceAccount:580850228782-compute@developer.gserviceaccount.com --role=roles/run.admin
gcloud projects add-iam-policy-binding hpb-eos-prod \
  --member=serviceAccount:580850228782-compute@developer.gserviceaccount.com --role=roles/artifactregistry.writer
gcloud projects add-iam-policy-binding hpb-eos-prod \
  --member=serviceAccount:580850228782-compute@developer.gserviceaccount.com --role=roles/logging.logWriter
gcloud iam service-accounts add-iam-policy-binding \
  eos-runtime@hpb-eos-prod.iam.gserviceaccount.com --project=hpb-eos-prod \
  --member=serviceAccount:580850228782-compute@developer.gserviceaccount.com \
  --role=roles/iam.serviceAccountUser

# Public access to the app URL (sign-in is enforced in the app; see note)
gcloud run services add-iam-policy-binding eos \
  --project=hpb-eos-prod --region=us-east1 \
  --member=allUsers --role=roles/run.invoker
```

Trade-off vs Option A: our Terraform (running as Editor) can never manage
these bindings, so future IAM changes also route through you.

## Note on the `allUsers` binding

The last binding makes the app URL publicly reachable — access control is
Google sign-in inside the app (HPB Workspace accounts + Daniel), not network
restriction. We verified (2026-07-27) that the effective
`constraints/iam.allowedPolicyMemberDomains` policy on this project is
`allValues: ALLOW` — i.e. your org does not enforce Domain Restricted
Sharing here, so this binding is permitted and needs no exception. If your
security review would rather not have a public URL at all, the alternative
is fronting the service with a Load Balancer + Identity-Aware Proxy — say
the word and we'll plan for that instead.
