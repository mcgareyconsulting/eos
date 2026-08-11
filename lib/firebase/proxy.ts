import { NextResponse, type NextRequest } from "next/server";

// Middleware-friendly auth gate. Runs in Next's Edge runtime, so it cannot
// import firebase-admin (Node-only). Instead it just checks for the session
// cookie's presence — cryptographic verification happens at the page level
// via requireFirebaseUser, which redirects to /login if the cookie is invalid.
// Net effect: same security, no Edge-runtime conflicts.
export function gateRequest(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  // Session-less paths. /api/google/tasks/pull is called by Cloud Scheduler
  // (or curl) with Authorization: Bearer $GOOGLE_TASKS_PULL_SECRET — the
  // route handler enforces the secret; middleware only needs to not bounce
  // to /login before that runs.
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/api/google/tasks/pull";

  const hasSession = request.cookies.has("__firebase_session");

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
