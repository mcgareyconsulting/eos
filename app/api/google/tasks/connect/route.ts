import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/firebase/session";
import {
  googleOAuthConfigured,
  GOOGLE_TASKS_SCOPE,
  resolveRedirectUri,
  appOrigin,
} from "@/lib/google/tasks";

const STATE_COOKIE = "g_tasks_oauth_state";

// Kicks off the Google OAuth consent flow for the Tasks connector. Gated on a
// valid EOS session so a random visitor can't initiate a connection. The
// redirect URI is derived from the request origin, so the same code works on
// localhost and Cloud Run — just register both callback URLs on the OAuth
// client.
export async function GET(request: NextRequest) {
  const session = await verifySession();
  if (!session)
    return NextResponse.redirect(new URL("/login", appOrigin(request.url)));

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

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min to complete consent
  });
  return res;
}
