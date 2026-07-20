// Google Tasks connector — one-way push (EOS to-dos → Google Tasks).
//
// SCOPE (deliberately minimal, "single user" per current requirements):
//   - ONE connected Google account for the whole app, stored in the admin-only
//     Firestore doc `integrations/google_tasks`. No per-team/per-owner token
//     management, no write-back from Tasks → EOS, no polling.
//   - Every team to-do is mirrored into one "EOS · L10 To-Dos" list in that
//     account. To mirror only a specific owner's to-dos instead, gate the
//     callers in todos/actions.ts on `owner_id` (see note there).
//
// No SDK dependency: OAuth token exchange/refresh and the Tasks REST calls are
// done with plain fetch. Auth is user-OAuth (the Tasks API does not accept a
// bare service account) — a human connects once via /api/google/tasks/connect,
// which stores a refresh token here.
//
// SECURITY: the refresh token lives in Firestore (admin-SDK only; firestore.rules
// denies client reads of `integrations/*`). Fine for a single-user trial; for a
// multi-tenant/prod build move it to Secret Manager and grant the runtime SA
// roles/secretmanager.secretAccessor.

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TASKS_BASE = "https://tasks.googleapis.com/tasks/v1";
const TASKLIST_TITLE = "EOS · L10 To-Dos";

// Read/write access to the user's Google Tasks.
export const GOOGLE_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

// The OAuth redirect URI must be a single, exact, HTTPS value registered on the
// OAuth client — and the connect + callback routes must send the *identical*
// string. Prefer an explicit env var (GOOGLE_OAUTH_REDIRECT_URI); this is the
// one-URI setup and the reliable path on Cloud Run, where TLS terminates at the
// proxy and the request reaches the container as http:// — deriving the URI
// from the request would produce an http:// redirect that Google rejects with
// "doesn't comply with OAuth 2.0 policy". Falls back to the request origin
// (https forced, except localhost) only when the env var is unset, e.g. local
// dev where you haven't set it.
export function resolveRedirectUri(requestUrl: string): string {
  const explicit = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  const u = new URL(requestUrl);
  const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  const scheme = isLocal ? u.protocol : "https:";
  return `${scheme}//${u.host}/api/google/tasks/callback`;
}

// The app's public origin, for building in-app redirects (e.g. back to
// /integrations after the callback). MUST NOT be derived from request.url on
// Cloud Run: inside the container that URL's host is the bind address
// (0.0.0.0:8080), so a relative redirect would send the browser to
// http://0.0.0.0:8080/... (ERR_CONNECTION_REFUSED). Reuses the pinned redirect
// URI's origin when set; falls back to the (correct) request host locally.
export function appOrigin(requestUrl: string): string {
  return new URL(resolveRedirectUri(requestUrl)).origin;
}

type Connection = {
  refresh_token: string;
  access_token?: string | null;
  access_token_expiry?: number | null; // epoch ms
  tasklist_id?: string | null;
  connected_by_uid?: string | null;
  connected_email?: string | null;
};

function clientCreds(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Whether GOOGLE_OAUTH_CLIENT_ID/SECRET are present (env-configured). */
export function googleOAuthConfigured(): boolean {
  return clientCreds() !== null;
}

function connectionRef() {
  return getAdminDb().collection("integrations").doc("google_tasks");
}

async function getConnection(): Promise<Connection | null> {
  const snap = await connectionRef().get();
  const data = snap.data() as Connection | undefined;
  return data?.refresh_token ? data : null;
}

/** Connection status for UI (no secrets returned). */
export async function getTasksStatus(): Promise<{
  configured: boolean;
  connected: boolean;
  email: string | null;
}> {
  const conn = await getConnection().catch(() => null);
  return {
    configured: googleOAuthConfigured(),
    connected: !!conn,
    email: conn?.connected_email ?? null,
  };
}

// --- OAuth (called from the connect/callback route handlers) ---------------

/** Exchange an authorization code for tokens. Throws on non-2xx. */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}> {
  const creds = clientCreds();
  if (!creds) throw new Error("Google OAuth not configured");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Persist a freshly-authorized connection (overwrites any prior one). */
export async function saveConnection(params: {
  refreshToken: string;
  accessToken: string;
  expiresInSec: number;
  uid: string | null;
  email: string | null;
}): Promise<void> {
  await connectionRef().set(
    {
      refresh_token: params.refreshToken,
      access_token: params.accessToken,
      access_token_expiry: Date.now() + params.expiresInSec * 1000,
      connected_by_uid: params.uid,
      connected_email: params.email,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

// --- Token / tasklist plumbing ---------------------------------------------

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const creds = clientCreds();
  if (!creds) throw new Error("Google OAuth not configured");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  await connectionRef().set(
    {
      access_token: json.access_token,
      access_token_expiry: Date.now() + json.expires_in * 1000,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return json.access_token;
}

async function tasksFetch(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${TASKS_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Tasks API ${path} -> ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return {};
  return res.json();
}

// Resolve a usable access token + the EOS tasklist id, refreshing/creating as
// needed. Returns null when no account is connected.
async function getAuthContext(): Promise<
  { token: string; tasklistId: string } | null
> {
  // Short-circuit before any Firestore read when the connector isn't even
  // configured — keeps the to-do write path free of overhead everywhere the
  // integration is off (prod, emulator, unconfigured trials).
  if (!googleOAuthConfigured()) return null;

  const conn = await getConnection();
  if (!conn) return null;

  let token = conn.access_token ?? null;
  const expiry = conn.access_token_expiry ?? 0;
  // Refresh a minute early to avoid mid-call expiry.
  if (!token || Date.now() > expiry - 60_000) {
    token = await refreshAccessToken(conn.refresh_token);
  }

  const tasklistId = conn.tasklist_id ?? (await ensureTaskList(token));
  return { token, tasklistId };
}

async function ensureTaskList(accessToken: string): Promise<string> {
  const listing = await tasksFetch("/users/@me/lists", accessToken);
  const items = (listing.items ?? []) as { id: string; title: string }[];
  const existing = items.find((l) => l.title === TASKLIST_TITLE);
  let id = existing?.id;
  if (!id) {
    const created = await tasksFetch("/users/@me/lists", accessToken, {
      method: "POST",
      body: JSON.stringify({ title: TASKLIST_TITLE }),
    });
    id = created.id as string;
  }
  await connectionRef().set(
    { tasklist_id: id, updated_at: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return id;
}

// --- Public push API (called from todos/actions.ts) ------------------------

export type TodoMirror = {
  title: string;
  notes?: string | null;
  dueDate?: string | null; // "YYYY-MM-DD"
  completed: boolean;
};

// Create or update the mirrored Google Task for a to-do. Returns the Google
// task id (new or existing), or null if not connected / not configured.
// NEVER THROWS — Google being unreachable must not break an EOS to-do write.
// Callers pass the *complete* current to-do state (title, notes, due, status)
// so a PATCH can't accidentally revert an unspecified field (e.g. reopen a
// completed task on a title-only edit).
export async function upsertTaskForTodo(
  todo: TodoMirror,
  existingTaskId?: string | null,
): Promise<string | null> {
  try {
    const auth = await getAuthContext();
    if (!auth) return null;

    const body: Record<string, unknown> = {
      title: todo.title,
      status: todo.completed ? "completed" : "needsAction",
    };
    if (todo.notes) body.notes = todo.notes;
    // Tasks API stores only the date portion of `due` (RFC 3339).
    if (todo.dueDate) body.due = `${todo.dueDate}T00:00:00.000Z`;

    const result = existingTaskId
      ? await tasksFetch(
          `/lists/${auth.tasklistId}/tasks/${existingTaskId}`,
          auth.token,
          { method: "PATCH", body: JSON.stringify(body) },
        )
      : await tasksFetch(`/lists/${auth.tasklistId}/tasks`, auth.token, {
          method: "POST",
          body: JSON.stringify(body),
        });

    return (result.id as string) ?? existingTaskId ?? null;
  } catch (e) {
    console.error("[google-tasks] upsert failed:", e);
    return null;
  }
}

// Delete the mirrored Google Task. No-op if there's no mirror or no connection.
// Never throws.
export async function deleteTaskForTodo(
  existingTaskId: string | null | undefined,
): Promise<void> {
  if (!existingTaskId) return;
  try {
    const auth = await getAuthContext();
    if (!auth) return;
    await tasksFetch(
      `/lists/${auth.tasklistId}/tasks/${existingTaskId}`,
      auth.token,
      { method: "DELETE" },
    );
  } catch (e) {
    console.error("[google-tasks] delete failed:", e);
  }
}
