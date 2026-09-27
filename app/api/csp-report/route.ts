import { NextResponse } from "next/server";
import { parseCspReports, rateLimiter } from "@/lib/csp-report";

/**
 * Sink for Content-Security-Policy violation reports (C-08). proxy.ts sends
 * the policy as Content-Security-Policy-Report-Only with `report-uri` and
 * `report-to` pointing here, so this is how we learn what enforcing it would
 * break. One structured line per violation to stdout, which Cloud Run
 * forwards to Cloud Logging (filter jsonPayload.kind="csp-report").
 *
 * Public and unauthenticated like /api/client-error — browsers send reports
 * without credentials. It only writes to the log, bounded by a body cap and a
 * per-instance rate limit, and always answers 204 with no body: nothing from
 * the request is ever echoed back.
 */
const MAX_BODY_BYTES = 16_000;
const overRateLimit = rateLimiter(60);

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
    body = JSON.parse((await request.text()).slice(0, MAX_BODY_BYTES));
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;
  for (const v of parseCspReports(body)) {
    console.warn(
      JSON.stringify({
        severity: "WARNING",
        message: `[csp] ${v.directive ?? "unknown directive"} ${v.blockedUri ?? "unknown"}`,
        kind: "csp-report",
        ...v,
        serverDeploymentId: process.env.DEPLOYMENT_ID ?? null,
        userAgent,
      }),
    );
  }

  return new NextResponse(null, { status: 204 });
}
