# syntax=docker/dockerfile:1

# ---- Base -------------------------------------------------------------
# Node LTS on Alpine: small image, meets Next.js 16's engines requirement
# (node >=20.9.0). Corepack (bundled with Node 20/22) pins the exact pnpm
# version so local, CI, and image builds all resolve the same dependency
# tree as pnpm-lock.yaml (lockfileVersion 9 -> pnpm 9.x).
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ---- Dependencies -------------------------------------------------------
# Installed in their own stage/layer so `pnpm install` is only re-run when
# lockfile/manifests change, not on every source edit.
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
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET \
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN=$NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN \
    NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

# ---- Runner ---------------------------------------------------------------
# `output: "standalone"` (next.config.ts) traces only the files each route
# needs -- including a pruned node_modules -- into .next/standalone, plus a
# minimal server.js. public/ and .next/static are NOT included by that trace
# (per Next.js docs) and must be copied in manually. proxy.ts (Next 16's
# middleware replacement) runs on the Node.js runtime by default and IS part
# of the standard server trace, so no separate handling is required for it.
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
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
