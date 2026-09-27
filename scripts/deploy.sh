#!/usr/bin/env bash
# One-command build + deploy: reads the Firebase web config out of an env
# file, tags the image with the current git commit, and hands the rest to
# cloudbuild.yaml (build -> push to Artifact Registry -> roll Cloud Run).
#
#   pnpm ship                 # deploy using .env.prod (live DB)
#   pnpm ship -- --dry-run    # print what would run, run nothing
#
# The env file is the single source of truth for the NEXT_PUBLIC_* values
# baked into the image. Deploys read .env.prod (live database); .env.local is
# the DEV config and points at the sandbox database — that's why it is NOT
# the default here, and why a sandbox database id is refused outright below.
# Deploying to a different project means pointing at a different env file
# (--env-file), not overriding values one by one.
#
# Runtime env is NOT this script's job (Gate 2, audit I-03). Cloud Run's
# container env — plain config (GOOGLE_OAUTH_CLIENT_ID,
# GOOGLE_OAUTH_REDIRECT_URI, ENV_LABEL, ...) and Secret Manager references
# (GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_TASKS_PULL_SECRET, SIGN_IN_ALLOWLIST) —
# is owned by Terraform: terraform/cloud_run.tf + terraform/secrets.tf.
# Secret values are added as Secret Manager versions, never from this
# script or from .env.prod: docs/SECRETS_RUNBOOK.md. The image roll
# (cloudbuild.yaml `gcloud run deploy --image=...`) keeps whatever env the
# service already has.
#
# The former `sync_runtime_env` step (and `--sync-env`) pushed
# GOOGLE_OAUTH_* values from .env.prod with `gcloud run services update
# --update-env-vars`, putting the OAuth client secret in plaintext on every
# revision. It was removed at Gate 2; `--sync-env` now refuses with a pointer
# to Terraform so old muscle memory fails loudly instead of silently.

set -euo pipefail
cd "$(dirname "$0")/.."

REGION=us-east1
SERVICE=eos
ENV_FILE=.env.prod
PROJECT=""
RUNTIME_SA=""
DRY_RUN=false

# Values that must no longer live in the deploy env file: they are Secret
# Manager secrets now (terraform/secrets.tf). Only used to warn — this script
# never reads or prints their values.
RETIRED_SECRET_KEYS=(
  GOOGLE_OAUTH_CLIENT_SECRET
  GOOGLE_TASKS_PULL_SECRET
)

usage() {
  cat <<'USAGE'
Usage: pnpm ship [-- options]
  --project <id>          GCP project (default: NEXT_PUBLIC_FIREBASE_PROJECT_ID from the env file)
  --region <region>       Cloud Run region (default: us-east1)
  --env-file <path>       Env file to read config from (default: .env.prod)
  --service-account <sa>  Runtime SA (default: eos-runtime@<project>.iam.gserviceaccount.com)
  --dry-run               Print the command(s) instead of running them

Runtime env and secrets are managed by Terraform (terraform/cloud_run.tf,
terraform/secrets.tf) — see docs/SECRETS_RUNBOOK.md.
USAGE
}

refuse_sync_env() {
  echo "Refusing: --sync-env was removed at Gate 2 (secrets hardening, audit I-03)."
  echo "Cloud Run env is owned by Terraform now:"
  echo "  - plain config (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_REDIRECT_URI, ENV_LABEL, ...):"
  echo "      terraform/*.tfvars → terraform plan/apply (terraform/cloud_run.tf)"
  echo "  - secrets (GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_TASKS_PULL_SECRET, SIGN_IN_ALLOWLIST):"
  echo "      gcloud secrets versions add <NAME> --data-file=- (docs/SECRETS_RUNBOOK.md)"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --service-account) RUNTIME_SA="$2"; shift 2 ;;
    --sync-env) refuse_sync_env ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

[[ -f "$ENV_FILE" ]] || { echo "Env file not found: $ENV_FILE"; exit 1; }

# Last uncommented assignment wins, matching dotenv. Values here are plain
# (no quotes), so no unescaping is needed.
envval() { grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

ENV_PROJECT="$(envval NEXT_PUBLIC_FIREBASE_PROJECT_ID)"
PROJECT="${PROJECT:-$ENV_PROJECT}"
[[ -n "$PROJECT" ]] || { echo "No project: none in $ENV_FILE and no --project given."; exit 1; }

# The baked web config and the deploy target must be the same project — a
# mismatch ships an app whose bundle talks to a different Firebase project
# than the one it's running in, and nothing fails until sign-in does.
if [[ "$PROJECT" != "$ENV_PROJECT" ]]; then
  echo "Refusing: $ENV_FILE is configured for '$ENV_PROJECT' but the deploy target is '$PROJECT'."
  echo "Pass --env-file with that project's config instead."
  exit 1
fi

# The database id is baked into the bundle at build time, so a bundle built
# from sandbox config would ship an app reading/writing test data no matter
# what the service's runtime env says. There is no override flag on purpose:
# if you genuinely mean it, put it in a differently-named env file.
DB_ID="$(envval NEXT_PUBLIC_FIREBASE_DATABASE_ID)"
if [[ "$DB_ID" == *sandbox* ]]; then
  echo "Refusing: $ENV_FILE points at sandbox database '$DB_ID'."
  echo "Deploys read the live-database config (.env.prod)."
  exit 1
fi

# Nudge (not a refusal): secret values left in the deploy env file are the
# laptop copy the audit (I-03) asked to purge. Names only, never values.
LEFTOVER=()
for key in "${RETIRED_SECRET_KEYS[@]}"; do
  if [[ -n "$(envval "$key")" ]]; then LEFTOVER+=("$key"); fi
done
if [[ ${#LEFTOVER[@]} -gt 0 ]]; then
  echo "WARNING: ${ENV_FILE} still holds secret value(s) for: ${LEFTOVER[*]}"
  echo "         They are not used by this script. Once Secret Manager holds them"
  echo "         (docs/SECRETS_RUNBOOK.md), delete those lines from ${ENV_FILE}."
fi

RUNTIME_SA="${RUNTIME_SA:-eos-runtime@${PROJECT}.iam.gserviceaccount.com}"

# Tag = short commit, so "what's running" always answers to "which commit".
# A dirty tree gets a loud suffix rather than a lying tag.
TAG="$(git rev-parse --short HEAD)"
if [[ -n "$(git status --porcelain)" ]]; then
  TAG="${TAG}-dirty"
  echo "WARNING: uncommitted changes — image tagged '${TAG}'. Commit first for a traceable deploy."
fi

SUBS="_REGION=${REGION}"
SUBS+=",_SERVICE=${SERVICE}"
SUBS+=",_REPO=eos"
SUBS+=",_TAG=${TAG}"
SUBS+=",_RUNTIME_SERVICE_ACCOUNT=${RUNTIME_SA}"
for v in API_KEY AUTH_DOMAIN PROJECT_ID STORAGE_BUCKET MESSAGING_SENDER_ID APP_ID HOSTED_DOMAIN DATABASE_ID; do
  SUBS+=",_NEXT_PUBLIC_FIREBASE_${v}=$(envval NEXT_PUBLIC_FIREBASE_${v})"
done

echo "Deploying ${SERVICE} to ${PROJECT} (${REGION}) as ${TAG}"
echo "  config from: ${ENV_FILE}"
echo "  database:    $(envval NEXT_PUBLIC_FIREBASE_DATABASE_ID)"
echo "  runtime SA:  ${RUNTIME_SA}"
echo "  runtime env: unchanged (owned by Terraform)"

CMD=(gcloud builds submit --config cloudbuild.yaml --project "$PROJECT" --substitutions="$SUBS")

if $DRY_RUN; then
  echo; printf '%q ' "${CMD[@]}"; echo
  exit 0
fi

"${CMD[@]}"

echo
echo "Deployed. Service URL:"
gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --format='value(status.url)'
