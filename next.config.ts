import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output traces only the files needed at runtime (including
  // node_modules) into .next/standalone, so the Docker image doesn't need
  // a full `pnpm install` or the source tree. See docs/DEPLOY.md.
  output: "standalone",

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
