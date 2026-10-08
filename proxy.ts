import type { NextRequest } from "next/server";
import { gateRequest } from "@/lib/firebase/proxy";
import {
  CSP_REPORT_GROUP,
  CSP_REPORT_PATH,
  buildCsp,
  newNonce,
} from "@/lib/csp";

// Report-only for now (C-08): violations are POSTed to /api/csp-report and
// nothing is blocked. Rename to "Content-Security-Policy" to enforce.
const CSP_HEADER = "Content-Security-Policy-Report-Only";

export function proxy(request: NextRequest) {
  // A fresh nonce per request. Next reads it from the CSP *request* header
  // during render and stamps it on its scripts — see lib/csp.ts.
  const nonce = newNonce();
  const csp = buildCsp({
    nonce,
    authDomain:
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
      "hpb-eos-prod.firebaseapp.com",
    isDev: process.env.NODE_ENV === "development",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(CSP_HEADER, csp);

  const response = gateRequest(request, requestHeaders);
  response.headers.set(CSP_HEADER, csp);
  response.headers.set(
    "Reporting-Endpoints",
    `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`,
  );
  return response;
}

export const config = {
  matcher: [
    // Match all paths except static assets, image optimizer, and public/brand/
    // (logo + sign-in animation must load for signed-out users on /login)
    "/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
