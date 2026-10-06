# Custom domain: pulse.highplainsbank.com

Puts the app on `https://pulse.highplainsbank.com` with a Cloud Run domain
mapping (`terraform/domain.tf`). Short-term path: the mapping is a Preview
feature and has no Cloud Armor or IAP. The long-term front door is a load
balancer (audit I-01); see [Later: load balancer](#later-load-balancer).

Who does what: **HPB** = the bank's DNS / Google Workspace admin.
**Operator** = whoever runs Terraform (today `daniel@mcgareyconsulting.com`).

## Phase 1: serve the hostname

The old `*.run.app` URL keeps working throughout. Nothing in the app
changes in this phase.

1. **Verify the domain (HPB + operator).** Google only lets a verified
   owner map a domain. In [Google Search Console](https://search.google.com/search-console)
   add a **Domain** property for `highplainsbank.com` (or a URL-prefix
   property for `https://pulse.highplainsbank.com`) and verify it with the
   TXT record it shows, added at the bank's DNS. Then add the operator's
   account as an **Owner** (Settings → Users and permissions). If the
   operator verifies it themselves, HPB only adds the TXT record.
   - Check: `gcloud domains list-user-verified` (as the operator) lists the domain.
2. **Create the mapping (operator).** Add to `terraform/terraform.tfvars`:

   ```hcl
   custom_domain = "pulse.highplainsbank.com"
   ```

   `terraform plan` must show **1 to add, 0 to change, 0 to destroy**
   (`google_cloud_run_domain_mapping.app[0]`). Apply, then:

   ```bash
   terraform output custom_domain_dns_records   # re-run `terraform refresh` if empty
   ```

3. **Add the DNS record (HPB).** For a subdomain this is one record:

   | Name | Type | Value |
   |---|---|---|
   | `pulse` | `CNAME` | `ghs.googlehosted.com.` |

   Remove any other record for `pulse` first (an earlier A/CNAME pointing at
   Google is what returns the 404 before the mapping exists). If the
   domain has **CAA** records, they must allow `pki.goog` and
   `letsencrypt.org`, or the certificate never issues.
4. **Wait for the certificate.** Usually 15–60 minutes after DNS resolves,
   up to 24 hours.
   - Check: `gcloud beta run domain-mappings describe --domain=pulse.highplainsbank.com --region=us-east1 --project=hpb-eos-prod`
     shows `CertificateProvisioned: True` and `Ready: True`;
     `curl -sI https://pulse.highplainsbank.com/login` returns 200.

## Phase 2: make sign-in and Google Tasks work on the hostname

Do this once Phase 1's check passes, in one sitting.

1. **Firebase Auth authorized domain.** Firebase Console → Authentication
   → Settings → Authorized domains → **Add domain**
   `pulse.highplainsbank.com`. Keep the `run.app` host. Without this,
   Google sign-in on the new hostname fails with `auth/unauthorized-domain`.
   Leave `authDomain` (`hpb-eos-prod.firebaseapp.com`) unchanged.
2. **Tasks OAuth client redirect URI.** APIs & Services → Credentials →
   **`…-7eue…` "Google Tasks API (dev+prod)"** (not the `ui7v` Firebase
   client) → Authorized redirect URIs → **add**
   `https://pulse.highplainsbank.com/api/google/tasks/callback`. Keep the
   `run.app` one. Save. Changes can take a few minutes to apply.
3. **Point the app's callback at the hostname (operator).** In
   `terraform/terraform.tfvars`:

   ```hcl
   google_oauth_redirect_uri = "https://pulse.highplainsbank.com/api/google/tasks/callback"
   ```

   `terraform plan`: 0 add, **1 change** (Cloud Run env
   `GOOGLE_OAUTH_REDIRECT_URI` only), 0 destroy. Apply; a new revision rolls.
4. **Verify on `https://pulse.highplainsbank.com`:** fresh sign-in in a
   private window; Settings → Google Tasks → reconnect, then a sync.
5. **Tell users the new address.** The session cookie is per hostname, so
   people sign in once on the new address.

After step 3, starting the Tasks connect from the **old** `run.app` URL
fails at the callback, because Google returns the browser to the new
hostname where that user has no session yet. Either retire the old URL
for users at the same time, or add a host redirect (`*.run.app` →
`pulse.highplainsbank.com`) in `proxy.ts` — a follow-up, not done yet.

## Rollback

- Phase 2: set `google_oauth_redirect_uri` back to the `run.app` callback and
  apply. The Console additions (authorized domain, extra redirect URI) are
  harmless to leave.
- Phase 1: remove the bank's DNS record. The mapping has
  `prevent_destroy`; delete it deliberately (remove the guard, set
  `custom_domain = ""`, apply) only if the hostname is being abandoned.

## Later: load balancer

When the Global External Application Load Balancer (Cloud Armor, IAP,
`internal-and-cloud-load-balancing` ingress) is built for I-01:

1. Issue its certificate in **Certificate Manager with DNS authorization**
   (HPB adds one more CNAME, `_acme-challenge.pulse…`) so it is ACTIVE
   before traffic moves.
2. HPB switches `pulse` from the CNAME to an **A record** for the LB's IP.
3. Once traffic is on the LB, delete the domain mapping.

The hostname, Firebase authorized domain and OAuth redirect URI don't
change, so there are no app changes the second time.
