import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/firebase/session";
import {
  googleOAuthConfigured,
  GOOGLE_TASKS_SCOPE,
  resolveRedirectUri,
  appOrigin,
  saveOAuthState,
} from "@/lib/google/tasks";

// Kicks off the Google OAuth consent flow for the current EOS user's Tasks
// connector. Gated on a valid session so a random visitor can't initiate a
// connection; the resulting tokens are stored under that user's uid. Prefer
// GOOGLE_OAUTH_REDIRECT_URI in prod; locally the redirect falls back to the
// request origin — register both callback URLs on the OAuth client.
//
// Cloud Run serves the same service on multiple hostnames (e.g.
// *.a.run.app and *.run.app). CSRF state is stored server-side (not only a
// cookie) so a host mismatch can't break the callback. We still bounce onto
// the pinned redirect origin before starting OAuth so the Firebase session
// cookie and the callback share a host (sessions are also host-scoped).
export async function GET(request: NextRequest) {
  const canonicalOrigin = appOrigin(request.url);
  const browserHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    "";
  const browserProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    "https";
  if (browserHost) {
    const browserOrigin = `${browserProto}://${browserHost}`;
    if (browserOrigin !== canonicalOrigin) {
      return NextResponse.redirect(
        new URL("/api/google/tasks/connect", canonicalOrigin),
      );
    }
  }

  const session = await verifySession();
  if (!session) {
    const login = new URL("/login", canonicalOrigin);
    login.searchParams.set("next", "/api/google/tasks/connect");
    return NextResponse.redirect(login);
  }

  if (!googleOAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.",
      },
      { status: 500 },
    );
  }

  const redirectUri = resolveRedirectUri(request.url);
  const state = crypto.randomUUID();
  await saveOAuthState(state, session.uid);

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", process.env.GOOGLE_OAUTH_CLIENT_ID!);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_TASKS_SCOPE);
  // offline + consent so Google returns a refresh token (needed for
  // server-side pushes after the browser session ends). select_account also
  // forces the account chooser, so the user picks which Google account to
  // connect instead of Google silently defaulting to the one already signed in.
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "select_account consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
