import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/firebase/session";
import {
  exchangeCodeForTokens,
  saveConnection,
  resolveRedirectUri,
  appOrigin,
  consumeOAuthState,
  GOOGLE_TASKS_SETTINGS_PATH,
} from "@/lib/google/tasks";

// Handles the OAuth redirect back from Google: validates the CSRF state
// (server-side — see saveOAuthState), exchanges the code for tokens,
// persists the refresh token, and bounces the user back to Settings
// with a status flag.
export async function GET(request: NextRequest) {
  const origin = appOrigin(request.url);
  const session = await verifySession();
  if (!session) {
    const login = new URL("/login", origin);
    login.searchParams.set("next", GOOGLE_TASKS_SETTINGS_PATH);
    return NextResponse.redirect(login);
  }

  const url = new URL(request.url);
  const back = new URL(GOOGLE_TASKS_SETTINGS_PATH, origin);

  const finish = (status: string) => {
    back.searchParams.set("google", status);
    return NextResponse.redirect(back);
  };

  const errorParam = url.searchParams.get("error");
  if (errorParam) return finish("error");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return finish("state_error");
  }

  const stateOk = await consumeOAuthState(state, session.uid);
  if (!stateOk) {
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
      // Tokens are stored under this EOS user's uid so each person gets
      // their own Google Tasks list (not a single shared app account).
      uid: session.uid,
      email: session.email ?? null,
    });
    return finish("connected");
  } catch (e) {
    console.error("[google-tasks] callback failed:", e);
    return finish("error");
  }
}
