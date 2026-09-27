import { createHash } from "node:crypto";

// Content-Security-Policy for every proxied response (C-08,
// docs/SECURITY_AUDIT_2026-09-08.md). Shipped as
// Content-Security-Policy-Report-Only: browsers report violations to
// /api/csp-report and block nothing. Flip the header name in proxy.ts to
// enforce once the reports come back clean.
//
// Scripts: a per-request nonce (proxy.ts) plus 'strict-dynamic', the pattern
// in node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.
// Next reads the nonce back out of the request's CSP header (report-only
// counts) and stamps it on its own framework and inline flight scripts; code
// those scripts load (Firebase's gapi loader for the sign-in popup) inherits
// trust through 'strict-dynamic'. The one inline script we write ourselves —
// the pre-paint theme script in app/layout.tsx — is allowed by its sha256
// hash instead of a nonce, so the root layout doesn't have to read request
// headers. Hosts and 'self' listed next to 'strict-dynamic' are ignored by
// CSP3 browsers and only matter to older ones.
//
// Styles: 'unsafe-inline' is accepted. React `style={…}` attributes can't
// carry a nonce, and style injection is not a script-execution path.

/** app/layout.tsx's pre-paint theme script. Its hash is in script-src. */
export const THEME_SCRIPT = `(() => {
  try {
    const t = localStorage.getItem('theme');
    const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (t === 'dark' || (!t && sysDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (_) {}
})();`;

export function scriptHash(source: string): string {
  return `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`;
}

/** Where browsers POST violation reports (app/api/csp-report/route.ts). */
export const CSP_REPORT_PATH = "/api/csp-report";
/** `report-to` group name, declared by the Reporting-Endpoints header. */
export const CSP_REPORT_GROUP = "csp-endpoint";

/** Fresh per request: 128 random bits, base64. */
export function newNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
    "base64",
  );
}

export function buildCsp(opts: {
  nonce: string;
  /** Firebase authDomain — hosts the sign-in popup handler and its iframe. */
  authDomain: string;
  isDev: boolean;
}): string {
  const { nonce, authDomain, isDev } = opts;
  const authOrigin = `https://${authDomain}`;
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    [
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      scriptHash(THEME_SCRIPT),
      "https://apis.google.com",
      // React's dev build uses eval for server error stacks; never in prod.
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:"],
    // next/font self-hosts Nunito Sans at build time: no Google Fonts origin.
    ["font-src", "'self'"],
    [
      "connect-src",
      "'self'",
      // Firestore, Identity Toolkit, Secure Token — the Firebase client SDK.
      "https://*.googleapis.com",
      "https://*.firebaseio.com",
      "wss://*.firebaseio.com",
      authOrigin,
      // Dev server hot reload.
      ...(isDev ? ["ws:"] : []),
    ],
    // signInWithPopup talks to the popup through an iframe on authDomain.
    ["frame-src", "'self'", authOrigin, "https://accounts.google.com"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ["report-uri", CSP_REPORT_PATH],
    ["report-to", CSP_REPORT_GROUP],
  ];
  return directives.map((d) => d.join(" ")).join("; ");
}
