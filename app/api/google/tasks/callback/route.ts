import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/firebase/session";
import {
  exchangeCodeForTokens,
  saveConnection,
  resolveRedirectUri,
  appOrigin,
} from "@/lib/google/tasks";

const STATE_COOKIE = "g_tasks_oauth_state";

// Handles the OAuth redirect back from Google: validates the CSRF state,
// exchanges the code for tokens, persists the refresh token, and bounces the
// user back to /integrations with a status flag. The state cookie is always
// cleared on the way out.
export async function GET(request: NextRequest) {
  const origin = appOrigin(request.url);
  const session = await verifySession();
  if (!session) return NextResponse.redirect(new URL("/login", origin));

  const url = new URL(request.url);
  const back = new URL("/integrations", origin);

  const finish = (status: string) => {
    back.searchParams.set("google", status);
    const res = NextResponse.redirect(back);
    res.cookies.delete(STATE_COOKIE);
    return res;
  };

  const errorParam = url.searchParams.get("error");
  if (errorParam) return finish("error");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return finish("state_error");
  }

  const redirectUri = resolveRedirectUri(request.url);
  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    if (!tokens.refresh_token) {
      // Google only returns a refresh token on first consent (or with
      // prompt=consent). If it's missing, the connect route's prompt=consent
      // should have forced it — surface it rather than saving a dead record.
      return finish("no_refresh");
    }
    await saveConnection({
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresInSec: tokens.expires_in,
      uid: session.uid,
      email: session.email ?? null,
    });
    return finish("connected");
  } catch (e) {
    console.error("[google-tasks] callback failed:", e);
    return finish("error");
  }
}
