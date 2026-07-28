#!/usr/bin/env bash
# One-command build + deploy: reads the Firebase web config out of an env
# file, tags the image with the current git commit, and hands the rest to
# cloudbuild.yaml (build -> push to Artifact Registry -> roll Cloud Run).
#
#   pnpm ship                 # deploy to the project .env.local points at
#   pnpm ship -- --dry-run    # print the gcloud command, run nothing
#
# The env file is the single source of truth for the NEXT_PUBLIC_* values —
# the same config local `pnpm dev` runs against is what gets baked into the
# image, so localhost and the deployed service can't drift apart. Deploying
# to a different project therefore means pointing at a different env file
# (--env-file), not overriding values one by one.
#
# Runtime env vars on the service (SIGN_IN_ALLOWLIST, ENV_LABEL, ...) are
# untouched: the deploy step runs `gcloud run deploy` without --set-env-vars,
# which preserves whatever is already set on the service.

set -euo pipefail
cd "$(dirname "$0")/.."

REGION=us-east1
SERVICE=eos
ENV_FILE=.env.local
PROJECT=""
RUNTIME_SA=""
DRY_RUN=false

usage() {
  cat <<'USAGE'
Usage: pnpm ship [-- options]
  --project <id>          GCP project (default: NEXT_PUBLIC_FIREBASE_PROJECT_ID from the env file)
  --region <region>       Cloud Run region (default: us-east1)
  --env-file <path>       Env file to read NEXT_PUBLIC_* config from (default: .env.local)
  --service-account <sa>  Runtime SA (default: eos-runtime@<project>.iam.gserviceaccount.com)
  --dry-run               Print the build command instead of running it
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --service-account) RUNTIME_SA="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

[[ -f "$ENV_FILE" ]] || { echo "Env file not found: $ENV_FILE"; exit 1; }

# Last uncommented assignment wins, matching dotenv. Values here are plain
# (no quotes, no commas), so no unescaping is needed.
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
