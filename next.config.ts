import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output traces only the files needed at runtime (including
  // node_modules) into .next/standalone, so the Docker image doesn't need
  // a full `pnpm install` or the source tree. See docs/DEPLOY.md.
  output: "standalone",

  // The feedback tracker's screenshots (ROADMAP N73) are read from disk by
  // their admin-only route, never served from public/. The route reads a
  // computed path, so tracing cannot see the files on its own: list them
  // here and they land in .next/standalone/docs/feedback/screenshots/.
  // Keys are route globs (picomatch), hence the escaped brackets. The
  // Docker build context must carry them too — see the exceptions for this
  // directory in .gcloudignore and .dockerignore.
  outputFileTracingIncludes: {
    "/api/admin/feedback/screenshots/\\[name\\]": ["./docs/feedback/screenshots/*.png"],
  },

  // Version-skew protection. `gcloud run deploy` (cloudbuild.yaml) sends 100%
  // of traffic to the new revision at once and drains the old one, so a tab
  // that was open across a deploy is instantly holding a stale bundle: its
  // chunk URLs 404 and — worse — its Server Action IDs (per-build hashes) are
  // unknown to the new revision. The action then fails and, because it fails
  // inside a transition, Next replaces the whole screen with app/(app)/error.tsx.
  //
  // That is the "Something went wrong" the client hit on the Scorecard on
  // 2026-08-19 (a three-PR deploy day) mid-data-entry. With a deploymentId set,
  // Next stamps assets with `?dpl=` and compares the client's id against the
  // server's on navigation; a mismatch triggers a hard reload onto the new
  // build instead of an error. Baked in at build time (below), so it must be a
  // build arg, not a runtime env.
  //
  // Unset locally — `pnpm dev`/`pnpm build` keep today's behaviour.
  deploymentId: process.env.DEPLOYMENT_ID || undefined,

  // First-party Firebase Auth handler. Mobile browsers (iOS Safari, and
  // Chrome/Firefox with storage partitioning) isolate storage per top-level
  // site, so a sign-in handler on <project>.firebaseapp.com loses its state
  // mid-flow when the app lives on pulse.highplainsbank.com — the user sees
  // "Unable to process request due to missing initial state" (reported by
  // HPB on mobile, 2026-10-19). Proxying /__/auth and /__/firebase through
  // our own origin and building with NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN set to
  // the app's hostname makes the handler same-site. This is Firebase's
  // "proxy auth requests" option:
  // https://firebase.google.com/docs/auth/web/redirect-best-practices
  //
  // Requires `https://<app host>/__/auth/handler` on the Firebase sign-in
  // OAuth client's authorized redirect URIs. See docs/DEPLOY.md.
  async rewrites() {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    if (!projectId) return [];
    const origin = `https://${projectId}.firebaseapp.com`;
    return {
      beforeFiles: [
        { source: "/__/auth/:path*", destination: `${origin}/__/auth/:path*` },
        {
          source: "/__/firebase/:path*",
          destination: `${origin}/__/firebase/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },

  // Security headers on every response (C-08,
  // docs/SECURITY_AUDIT_2026-09-08.md). The Content-Security-Policy is not
  // here: it carries a per-request nonce, so proxy.ts sets it (report-only
  // for now — see lib/csp.ts).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Firebase Auth's signInWithPopup needs to interact with the popup
          // window (to detect close + receive the auth result). Many hosts'
          // default COOP header blocks that. "same-origin-allow-popups" keeps
          // the page isolated from arbitrary cross-origin frames but allows
          // the auth popup to communicate.
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          // Two years, subdomains, preload-eligible. Browsers ignore it over
          // plain http (local dev).
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Enforced clickjacking protection. `frame-ancestors 'none'` is in
        // the CSP too, but that header is Report-Only until the report
        // window closes. Nothing legitimately frames this app except the
        // proxied Firebase Auth iframe (/__/auth/iframe), which the SDK
        // embeds in our own pages — so /__/ is excluded.
        source: "/((?!__/).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default nextConfig;
