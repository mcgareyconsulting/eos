# Team management — operator runbook

> **Purpose:** Commands to wire **org admin**, **sign-in allowlist**, and
> **Firestore rules** for the team-management / directory work. Keep this
> doc handy when the feature branch is open in a PR and you want to run
> tooling against a clean env (e.g. main checkout with up-to-date `node_modules`).
>
> **Test operator account:** `daniel@mcgareyconsulting.com`  
> **Project:** `hpb-eos-prod` (Auth is project-level; data usually sandbox DB)  
> **Sandbox DB:** `hpb-eos-sandbox-db`  
> **Live DB:** `hpb-eos-prod-db` (only via ship / prod env — do not point local here)

---

## 0. Credentials first (`rapt_required` / invalid_grant)

Scripts use **Application Default Credentials** (`gcloud auth application-default login`)
unless `FIREBASE_SERVICE_ACCOUNT_JSON` is set in the env.

```
invalid_grant … error_subtype: "rapt_required"
```

means Google is forcing a **reauth** of your user ADC (Workspace RAPT). Fix:

```bash
# 1) Refresh user login for gcloud (use the Google account that has IAM on hpb-eos-prod)
gcloud auth login

# 2) Re-mint Application Default Credentials (what firebase-admin uses locally)
gcloud auth application-default login

# 3) Confirm project
gcloud config set project hpb-eos-prod
gcloud auth application-default print-access-token >/dev/null && echo "ADC OK"
```

Then retry the script. If RAPT keeps failing (org policy), use a **service
account key** instead (less ideal; rotate after use):

```bash
# In .env.local (never commit):
# FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
```

Admin SDK needs a principal that can call Identity Platform / Firebase Auth
Admin (e.g. `roles/firebaseauth.admin` or owner/editor on the project).

---

## 1. Sign-in allowlist (app session perimeter)

**Local (`.env.local`):**

```bash
SIGN_IN_ALLOWLIST=@highplainsbank.com,daniel@mcgareyconsulting.com
```

Restart `pnpm dev` after editing.

**Cloud Run (deployed app)** — service `eos` in **`us-east1`** (not us-central1):

```bash
gcloud run services list --project=hpb-eos-prod

gcloud run services update eos \
  --project=hpb-eos-prod \
  --region=us-east1 \
  --update-env-vars "^|^SIGN_IN_ALLOWLIST=@highplainsbank.com,daniel@mcgareyconsulting.com"
```

Keep this string in lockstep with `inDomain()` in `firestore.rules`.

---

## 2. Firestore rules (`inDomain` consultant email)

On this branch, rules allow:

- `*@highplainsbank.com`
- `daniel@mcgareyconsulting.com`

Deploy when ready (rules are **project-wide**, both DBs):

```bash
# From a checkout that has the updated firestore.rules
firebase deploy --only firestore:rules --project hpb-eos-prod
```

Until rules are deployed, client SDK live listeners for the new email may still
be denied by the old `inDomain()` list. **Server pages** use the Admin SDK and
are not gated by those rules.

---

## 2b. Reassign user (old Google account → new)

When someone switches Google accounts (e.g. consultant
`mcgareyconsulting@gmail.com` → `daniel@mcgareyconsulting.com`), Firebase
creates a **new uid**. Private to-dos and every `owner_id` stay on the old
uid, so the new login cannot see them — even though Google Tasks may still
have been written under the old connection.

Use **`scripts/reassign-user.ts`** (dry-run by default). Both emails must
already exist in Firebase Auth (sign in once with each if needed).

**Sandbox first:**

```bash
# Resolve + plan (no writes)
pnpm user:reassign \
  --from-email mcgareyconsulting@gmail.com \
  --to-email daniel@mcgareyconsulting.com \
  --database hpb-eos-sandbox-db

# Apply after reviewing the plan
pnpm user:reassign \
  --from-email mcgareyconsulting@gmail.com \
  --to-email daniel@mcgareyconsulting.com \
  --database hpb-eos-sandbox-db \
  --apply
```

**Prod DB** (only when sandbox looks right):

```bash
pnpm user:reassign \
  --from-email mcgareyconsulting@gmail.com \
  --to-email daniel@mcgareyconsulting.com \
  --database hpb-eos-prod-db \
  --apply
```

After apply:

1. Full sign-out in the app, then sign in as the **new** email  
2. Confirm private to-dos on Home + team To-Dos  
3. Re-grant org admin on the new email if the old account had it:
   `pnpm admin:set-role --email daniel@mcgareyconsulting.com --apply`  
4. Settings → Google Tasks: reconnect if the OAuth row did not move  
5. Optional: disable/delete the old Auth user in Firebase Console once
   you no longer need it (script does **not** delete Auth)

One team only: add `--team <teamId>`. Keep old roster row: `--keep-from-membership`.

---

## 3. Grant org admin claim (`role: "admin"`)

### On this feature branch (script present)

```bash
cd /path/to/eos-worktree/feature/team-management

# Dry-run
pnpm admin:set-role --email daniel@mcgareyconsulting.com

# Apply
pnpm admin:set-role --email daniel@mcgareyconsulting.com --apply
```

### From main (or any tree without the script)

If packages live on main and this branch only adds the script, either:

**A)** Copy/run the script against main’s deps:

```bash
# From feature branch, after ADC works:
pnpm admin:set-role --email daniel@mcgareyconsulting.com --apply
```

**B)** Or run a one-shot with `tsx` + firebase-admin from **main** (same ADC):

```bash
cd /path/to/eos   # main, with node_modules

# Requires: dotenv, firebase-admin (already app deps)
pnpm tsx -e '
import { config } from "dotenv";
config({ path: ".env.local" });
import { getAdminAuth } from "./lib/firebase/admin.ts";
const email = "daniel@mcgareyconsulting.com";
const auth = getAdminAuth();
const u = await auth.getUserByEmail(email);
const next = { ...(u.customClaims ?? {}), role: "admin" };
await auth.setCustomUserClaims(u.uid, next);
console.log("OK", u.uid, next);
'
```

(If `getUserByEmail` fails: sign in once with that Google account so Auth
creates the user, or `pnpm accounts:create "Daniel McGarey <daniel@mcgareyconsulting.com>"`.)

**After any claim change:** sign out of the app and sign back in so the session
cookie includes `role: "admin"`.

**Revoke admin:**

```bash
pnpm admin:set-role --email daniel@mcgareyconsulting.com --role normal --apply
```

---

## 4. Smoke checklist (team management)

| Step | Expect |
|------|--------|
| Sign in as `daniel@mcgareyconsulting.com` | Session allowed (allowlist) |
| Sidebar shows **Admin** badge | Claim on session |
| **Members → All teams** | Org directory (all teams + members) |
| **Members → New team** | Name → invite leader → Done (admin) |
| Open another team’s scorecard as admin | Works (god mode) |
| Sign in as non-member non-admin | Directory “View only”; team data 404 |
| Leader **Members → Add member** | Pre-provisions; no email sent |

---

## 5. PR vs ops split

| In the PR (code) | Ops (this doc / Cloud Console) |
|------------------|--------------------------------|
| Members directory + create-team wizard | `SIGN_IN_ALLOWLIST` on Cloud Run |
| `requireAdmin` / access helpers | Admin custom claim on your user |
| `firestore.rules` `inDomain` email | `firebase deploy --only firestore:rules` |
| `scripts/set-admin-role.ts` | ADC reauth when `rapt_required` |

You can merge/code-review the feature while running claim/allowlist steps from
any machine that has IAM + working ADC pointed at `hpb-eos-prod`.

---

## 6. Quick reference — env keys

| Key | Where | Example |
|-----|--------|---------|
| `SIGN_IN_ALLOWLIST` | `.env.local`, Cloud Run | `@highplainsbank.com,daniel@mcgareyconsulting.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `.env.local` | `hpb-eos-prod` |
| `NEXT_PUBLIC_FIREBASE_DATABASE_ID` | `.env.local` | `hpb-eos-sandbox-db` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | optional local | SA key JSON one-liner |
