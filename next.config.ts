import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Firebase Auth's signInWithPopup needs to interact with the popup window
  // (to detect close + receive the auth result). Vercel's default COOP header
  // blocks that. "same-origin-allow-popups" keeps the page isolated from
  // arbitrary cross-origin frames but allows the auth popup to communicate.
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
