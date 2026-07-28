#!/usr/bin/env bash
# One-command build + deploy: reads the Firebase web config out of an env
# file, tags the image with the current git commit, and hands the rest to
# cloudbuild.yaml (build -> push to Artifact Registry -> roll Cloud Run).
#
#   pnpm ship                 # deploy using .env.prod (live DB)
#   pnpm ship -- --dry-run    # print what would run, run nothing
#   pnpm ship -- --sync-env   # only push runtime keys from the env file
#                             # (no rebuild) — useful for GOOGLE_OAUTH_* etc.
#
# The env file is the single source of truth for the NEXT_PUBLIC_* values
# baked into the image. Deploys read .env.prod (live database); .env.local is
# the DEV config and points at the sandbox database — that's why it is NOT
# the default here, and why a sandbox database id is refused outright below.
# Deploying to a different project means pointing at a different env file
# (--env-file), not overriding values one by one.
#
# After a successful image roll, runtime keys listed in RUNTIME_ENV_KEYS are
# copied from the env file onto the Cloud Run service (when present). Other
# service env (SIGN_IN_ALLOWLIST, ENV_LABEL, ...) is left alone.

set -euo pipefail
cd "$(dirname "$0")/.."

REGION=us-east1
SERVICE=eos
ENV_FILE=.env.prod
PROJECT=""
RUNTIME_SA=""
DRY_RUN=false
SYNC_ENV_ONLY=false

# Server-only keys that may be copied from the env file onto Cloud Run after
# a successful deploy. Add names here when a new runtime secret/config should
# ride along with pnpm ship. Values must not contain '|' (delimiter below).
RUNTIME_ENV_KEYS=(
  GOOGLE_OAUTH_CLIENT_ID
  GOOGLE_OAUTH_CLIENT_SECRET
  GOOGLE_OAUTH_REDIRECT_URI
)

usage() {
  cat <<'USAGE'
Usage: pnpm ship [-- options]
  --project <id>          GCP project (default: NEXT_PUBLIC_FIREBASE_PROJECT_ID from the env file)
  --region <region>       Cloud Run region (default: us-east1)
  --env-file <path>       Env file to read config from (default: .env.prod)
  --service-account <sa>  Runtime SA (default: eos-runtime@<project>.iam.gserviceaccount.com)
  --sync-env              Only push RUNTIME_ENV_KEYS from the env file onto Cloud Run (no rebuild)
  --dry-run               Print the command(s) instead of running them
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --service-account) RUNTIME_SA="$2"; shift 2 ;;
    --sync-env) SYNC_ENV_ONLY=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

[[ -f "$ENV_FILE" ]] || { echo "Env file not found: $ENV_FILE"; exit 1; }

# Last uncommented assignment wins, matching dotenv. Values here are plain
# (no quotes), so no unescaping is needed.
envval() { grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

# Copy RUNTIME_ENV_KEYS that are set in the env file onto the Cloud Run
# service. Uses --update-env-vars (merge) so unrelated service env is kept.
# Prints key names only — never values.
sync_runtime_env() {
  local pairs=()
  local key val
  for key in "${RUNTIME_ENV_KEYS[@]}"; do
    val="$(envval "$key")"
    [[ -n "$val" ]] || continue
    if [[ "$val" == *"|"* ]]; then
      echo "Refusing: $key contains '|' which breaks the env-var delimiter."
      exit 1
    fi
    pairs+=("${key}=${val}")
  done

  if [[ ${#pairs[@]} -eq 0 ]]; then
    echo "No runtime keys to sync (none of ${RUNTIME_ENV_KEYS[*]} set in ${ENV_FILE})."
    return 0
  fi

  # ^|^ = use | as separator so values may contain commas.
  local joined
  joined="$(IFS='|'; echo "${pairs[*]}")"
  local names=()
  for key in "${RUNTIME_ENV_KEYS[@]}"; do
    [[ -n "$(envval "$key")" ]] && names+=("$key")
  done

  echo "Syncing runtime env onto ${SERVICE}: ${names[*]}"
  local cmd=(
    gcloud run services update "$SERVICE"
    --project "$PROJECT"
    --region "$REGION"
    --update-env-vars "^|^${joined}"
  )
  if $DRY_RUN; then
    # Don't print secret values on dry-run — only show which keys would ship.
    echo "  (dry-run) would update: ${names[*]}"
    return 0
  fi
  "${cmd[@]}"
}

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

RUNTIME_SA="${RUNTIME_SA:-eos-runtime@${PROJECT}.iam.gserviceaccount.com}"

# Env-only path: push runtime keys without rebuilding the image.
if $SYNC_ENV_ONLY; then
  echo "Syncing runtime env for ${SERVICE} in ${PROJECT} (${REGION}) from ${ENV_FILE}"
  sync_runtime_env
  exit 0
fi

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

CMD=(gcloud builds submit --config cloudbuild.yaml --project "$PROJECT" --substitutions="$SUBS")

if $DRY_RUN; then
  echo; printf '%q ' "${CMD[@]}"; echo
  sync_runtime_env
  exit 0
fi

"${CMD[@]}"

echo
echo "Deployed. Service URL:"
gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --format='value(status.url)'

# Keep Cloud Run runtime keys in lockstep with the env file (merge-only).
sync_runtime_env
