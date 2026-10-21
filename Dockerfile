# syntax=docker/dockerfile:1

# ---- Base -------------------------------------------------------------
# Node LTS on Alpine: small image, meets Next.js 16's engines requirement
# (node >=20.9.0). Corepack (bundled with Node 20/22) pins the exact pnpm
# version so local, CI, and image builds all resolve the same dependency
# tree as pnpm-lock.yaml. Pinned to match package.json's "packageManager"
# field (pnpm 10.x — the lockfile is still format v9 ("lockfileVersion:
# 9.0"); pnpm 10 didn't bump the lockfile format from pnpm 9).
#
# Pinned by digest (in addition to the tag) so a `node:22-alpine` re-push
# upstream can't silently change what this build pulls. Tag kept alongside
# for readability; digest is the index (multi-arch) digest, verified via
# `docker buildx imagetools inspect node:22-alpine` on 2026-09-27.
# Re-verify periodically with the same command and update both digest
# occurrences (base + runner below) together.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ---- Dependencies -------------------------------------------------------
# Installed in their own stage/layer so `pnpm install` is only re-run when
# lockfile/manifests change, not on every source edit.
#
# Deliberately NOT `--prod`: this single install feeds BOTH the builder
# stage (which needs typescript, tailwindcss/@tailwindcss/postcss, eslint —
# all devDependencies — to run `pnpm build`) and, via
# `COPY --from=deps /app/node_modules`, is the only node_modules the builder
# stage gets. Adding `--prod` here would strip those dev deps and break the
# build. It's still safe from an image-size/attack-surface standpoint: the
# runner stage never copies from `deps` — it only copies
# `.next/standalone` (Next's `output: "standalone"` trace, which prunes
# node_modules down to runtime-only packages) plus `.next/static` and
# `public/`. Dev dependencies never reach the final runtime image.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- Build ---------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are public web config (not secrets) but they are
# inlined into the client JS bundle at build time, so they must be present
# as build args/env here rather than only at deploy time.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN
# Optional: set only when the project's Firestore DB is named (not "(default)").
ARG NEXT_PUBLIC_FIREBASE_DATABASE_ID

# Version-skew protection (next.config.ts `deploymentId`). Must be unique per
# build: Next stamps it onto asset URLs and compares it on navigation, so two
# different builds sharing an id would defeat the check. cloudbuild.yaml passes
# ${_TAG}-${BUILD_ID}. Left empty for local builds, which then behave as before.
ARG DEPLOYMENT_ID

# Fail fast instead of shipping a build that 500s at first sign-in:
# cloudbuild.yaml defaults every _NEXT_PUBLIC_FIREBASE_* substitution to ""
# and `docker build` succeeds fine with empty values baked into the client
# bundle — the breakage only shows up at runtime. STORAGE_BUCKET/
# MESSAGING_SENDER_ID/HOSTED_DOMAIN are genuinely optional (not every app
# uses Storage/FCM, and the hosted-domain restriction may not apply); the
# other four are required for the Firebase JS SDK to initialize at all.
RUN set -eu; \
    missing=""; \
    [ -n "$NEXT_PUBLIC_FIREBASE_API_KEY" ] || missing="$missing NEXT_PUBLIC_FIREBASE_API_KEY"; \
    [ -n "$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN" ] || missing="$missing NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"; \
    [ -n "$NEXT_PUBLIC_FIREBASE_PROJECT_ID" ] || missing="$missing NEXT_PUBLIC_FIREBASE_PROJECT_ID"; \
    [ -n "$NEXT_PUBLIC_FIREBASE_APP_ID" ] || missing="$missing NEXT_PUBLIC_FIREBASE_APP_ID"; \
    if [ -n "$missing" ]; then \
      echo "ERROR: missing required build arg(s):$missing" >&2; \
      echo "Pass them via --substitutions in 'gcloud builds submit' (see docs/DEPLOY.md §6.2)." >&2; \
      exit 1; \
    fi

ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET \
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN=$NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN \
    NEXT_PUBLIC_FIREBASE_DATABASE_ID=$NEXT_PUBLIC_FIREBASE_DATABASE_ID \
    DEPLOYMENT_ID=$DEPLOYMENT_ID \
    NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

# Guarantee a public/ dir exists so the runner-stage COPY below never fails.
# Next.js `output: "standalone"` does not emit public/; the app now ships
# public/brand/ (logo + sign-in animation), but if public/ were ever emptied an
# unconditional `COPY /app/public` would abort the build with "stat app/public:
# file does not exist". mkdir -p is a no-op when public/ exists.
RUN mkdir -p public

# ---- Runner ---------------------------------------------------------------
# `output: "standalone"` (next.config.ts) traces only the files each route
# needs -- including a pruned node_modules -- into .next/standalone, plus a
# minimal server.js. public/ and .next/static are NOT included by that trace
# (per Next.js docs) and must be copied in manually. proxy.ts (Next 16's
# middleware replacement) runs on the Node.js runtime by default and IS part
# of the standard server trace, so no separate handling is required for it.
# Same pinned base + digest as above (see comment there) — keep both in sync.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runner
WORKDIR /app

# Redeclared here so the same --build-arg lands in the runtime stage too:
# app/api/client-error/route.ts reads DEPLOYMENT_ID at request time to record
# which build was *serving* alongside the build the browser was running.
ARG DEPLOYMENT_ID

ENV NODE_ENV=production \
    DEPLOYMENT_ID=$DEPLOYMENT_ID \
    NEXT_TELEMETRY_DISABLED=1

# Non-root runtime user (Cloud Run best practice; avoids running as root
# inside the container even though Cloud Run itself is sandboxed).
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# Cloud Run injects PORT (default 8080) and expects the container to bind
# 0.0.0.0, not localhost.
ENV PORT=8080 \
    HOSTNAME=0.0.0.0
EXPOSE 8080

CMD ["node", "server.js"]
