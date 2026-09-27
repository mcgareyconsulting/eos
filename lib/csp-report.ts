// Parsing for the CSP violation report sink (app/api/csp-report/route.ts).
//
// Browsers send two shapes:
//   - `report-uri` (application/csp-report): {"csp-report": {"document-uri", …}}
//   - `report-to` (application/reports+json): [{type: "csp-violation", body: {documentURL, …}}]
// Both are reduced to the few fields worth a log line. Everything is
// attacker-controllable (the endpoint is public), so values are
// length-capped, URLs lose their query string and fragment (an OAuth callback
// URL carries a `code`), and script samples / the original policy (it holds
// the nonce) are dropped.

export type CspViolation = {
  documentUri: string | null;
  blockedUri: string | null;
  directive: string | null;
  disposition: string | null;
  sourceFile: string | null;
  line: number | null;
};

const MAX_FIELD_CHARS = 500;
export const MAX_REPORTS_PER_REQUEST = 10;

function text(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return value.slice(0, MAX_FIELD_CHARS);
}

/** Origin + path of a URL; keywords like "inline" / "eval" pass through. */
export function redactUrl(value: unknown): string | null {
  const s = text(value);
  if (s === null) return null;
  try {
    const u = new URL(s);
    if (u.protocol === "data:" || u.protocol === "blob:") return `${u.protocol}…`;
    return `${u.origin}${u.pathname}`.slice(0, MAX_FIELD_CHARS);
  } catch {
    // Not a URL: "inline", "eval", "self", or junk. Keep only a bare token.
    return /^[a-z-]{1,32}$/i.test(s) ? s : null;
  }
}

function line(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function parseCspReports(body: unknown): CspViolation[] {
  const out: CspViolation[] = [];
  if (Array.isArray(body)) {
    for (const r of body.slice(0, MAX_REPORTS_PER_REQUEST)) {
      if (typeof r !== "object" || r === null) continue;
      const rec = r as Record<string, unknown>;
      if (rec.type !== "csp-violation") continue;
      const b = (rec.body ?? {}) as Record<string, unknown>;
      out.push({
        documentUri: redactUrl(b.documentURL ?? rec.url),
        blockedUri: redactUrl(b.blockedURL),
        directive: text(b.effectiveDirective),
        disposition: text(b.disposition),
        sourceFile: redactUrl(b.sourceFile),
        line: line(b.lineNumber),
      });
    }
    return out;
  }
  if (typeof body === "object" && body !== null) {
    const r = (body as Record<string, unknown>)["csp-report"];
    if (typeof r === "object" && r !== null) {
      const c = r as Record<string, unknown>;
      out.push({
        documentUri: redactUrl(c["document-uri"]),
        blockedUri: redactUrl(c["blocked-uri"]),
        directive: text(c["effective-directive"] ?? c["violated-directive"]),
        disposition: text(c.disposition),
        sourceFile: redactUrl(c["source-file"]),
        line: line(c["line-number"]),
      });
    }
  }
  return out;
}

/**
 * Fixed one-minute window, per instance — the same limiter as
 * /api/client-error. Returns a checker; true means "drop this request".
 */
export function rateLimiter(perMinute: number) {
  let windowStart = 0;
  let windowCount = 0;
  return (now: number): boolean => {
    if (now - windowStart > 60_000) {
      windowStart = now;
      windowCount = 0;
    }
    windowCount += 1;
    return windowCount > perMinute;
  };
}
