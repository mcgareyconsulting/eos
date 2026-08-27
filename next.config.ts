import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output traces only the files needed at runtime (including
  // node_modules) into .next/standalone, so the Docker image doesn't need
  // a full `pnpm install` or the source tree. See docs/DEPLOY.md.
  output: "standalone",

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

  // Firebase Auth's signInWithPopup needs to interact with the popup window
  // (to detect close + receive the auth result). Many hosts' default COOP
  // header blocks that. "same-origin-allow-popups" keeps the page isolated
  // from arbitrary cross-origin frames but allows the auth popup to communicate.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
