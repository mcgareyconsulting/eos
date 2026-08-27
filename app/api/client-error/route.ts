import { NextResponse } from "next/server";

/**
 * Sink for errors caught by the app's error boundaries.
 *
 * app/(app)/error.tsx runs in the browser, so its console.error() went
 * nowhere we could read — when the client reported "Something went wrong" on
 * the Scorecard on 2026-08-19 there was no server-side trace to match it
 * against, and the boundary had already swallowed the only identifying
 * detail (the digest). This writes one structured line to stdout, which Cloud
 * Run forwards to Cloud Logging.
 *
 * Next already logs *server* errors with their digest, so for a Server
 * Component or Server Action failure this line is the join key: filter Cloud
 * Logging on the digest to get the real stack. For a pure client-side error
 * (a chunk that 404s after a deploy, a render crash) there is no digest and
 * no server log — this line is the only record there will ever be.
 */

// Unauthenticated by design: an expired session is itself a thing worth
// logging, and requiring auth would drop exactly the errors we most want. The
// endpoint only writes to the log, so the exposure is log noise — bounded
// below by a hard body cap and a per-instance rate limit.
const MAX_BODY_BYTES = 8_000;
const MAX_FIELD_CHARS = 2_000;
const RATE_LIMIT_PER_MINUTE = 60;

let windowStart = 0;
let windowCount = 0;

function overRateLimit(now: number): boolean {
  if (now - windowStart > 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount > RATE_LIMIT_PER_MINUTE;
}

function field(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return value.slice(0, MAX_FIELD_CHARS);
}

export async function POST(request: Request) {
  if (overRateLimit(Date.now())) {
    return new NextResponse(null, { status: 429 });
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let body: unknown;
  try {
    const text = (await request.text()).slice(0, MAX_BODY_BYTES);
    body = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return new NextResponse(null, { status: 400 });
  }
  const payload = body as Record<string, unknown>;

  // Cloud Logging parses a JSON line on stdout into a structured entry;
  // `severity` and `message` are the fields it promotes, the rest become
  // jsonPayload and are filterable (e.g. jsonPayload.digest="...").
  console.error(
    JSON.stringify({
      severity: "ERROR",
      message: `[client] ${field(payload.message) ?? "unknown error"}`,
      kind: "client-error",
      digest: field(payload.digest),
      // Which build the browser was running. Compare against the serving
      // revision's own DEPLOYMENT_ID to confirm a version-skew failure rather
      // than guessing at it from deploy timestamps.
      clientDeploymentId: field(payload.deploymentId),
      serverDeploymentId: process.env.DEPLOYMENT_ID ?? null,
      path: field(payload.path),
      stack: field(payload.stack),
      userAgent: field(request.headers.get("user-agent")),
    }),
  );

  return new NextResponse(null, { status: 204 });
}
