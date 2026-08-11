// Google Tasks connector — two-way **completion** sync for pure to-dos.
//
// SCOPE (per-user OAuth):
//   - Each EOS user connects their own Google account. Tokens live in the
//     admin-only Firestore doc `google_tasks_connections/{uid}`. No shared
//     app-wide connection.
//   - EOS → Google: create/update/delete mirrored tasks in the owner's
//     "EOS · L10 To-Dos" list (title, notes, due, completed status).
//   - Google → EOS: when a mirrored task is completed in Google Tasks, set
//     `completed_at` on the linked EOS to-do. Field edits in Google (title,
//     due, notes) and un-complete are ignored — EOS stays source of truth
//     for fields. Google Tasks has no webhooks; pull runs on Settings /
//     To-Dos load, "Sync now", and POST /api/google/tasks/pull (scheduler).
//   - If the owner hasn't connected, push/pull are no-ops (EOS writes still
//     succeed).
//
// No SDK dependency: OAuth token exchange/refresh and the Tasks REST calls are
// done with plain fetch. Auth is user-OAuth (the Tasks API does not accept a
// bare service account) — each human connects via /api/google/tasks/connect,
// which stores a refresh token under their uid.
//
// SECURITY: refresh tokens live in Firestore (admin-SDK only; firestore.rules
// default-denies client access to `google_tasks_connections/*`). Fine for a
// small org; for a multi-tenant/prod hardening pass move tokens to Secret
// Manager and grant the runtime SA roles/secretmanager.secretAccessor.

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
// /settings after the callback). MUST NOT be derived from request.url on
// Cloud Run: inside the container that URL's host is the bind address
// (0.0.0.0:8080), so a relative redirect would send the browser to
// http://0.0.0.0:8080/... (ERR_CONNECTION_REFUSED). Reuses the pinned redirect
// URI's origin when set; falls back to the (correct) request host locally.
export function appOrigin(requestUrl: string): string {
  return new URL(resolveRedirectUri(requestUrl)).origin;
}

/** In-app page that owns the Google Tasks connector UI. */
export const GOOGLE_TASKS_SETTINGS_PATH = "/settings";

type Connection = {
  refresh_token: string;
  access_token?: string | null;
  access_token_expiry?: number | null; // epoch ms
  tasklist_id?: string | null;
  connected_by_uid?: string | null;
  connected_email?: string | null;
  last_pull_at_ms?: number | null;
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

function connectionRef(uid: string) {
  return getAdminDb().collection("google_tasks_connections").doc(uid);
}

async function getConnection(uid: string): Promise<Connection | null> {
  const snap = await connectionRef(uid).get();
  const data = snap.data() as Connection | undefined;
  return data?.refresh_token ? data : null;
}

/** Connection status for the given EOS user (no secrets returned). */
export async function getTasksStatus(uid: string): Promise<{
  configured: boolean;
  connected: boolean;
  email: string | null;
  lastPullAtMs: number | null;
}> {
  const configured = googleOAuthConfigured();
  if (!configured) {
    return {
      configured: false,
      connected: false,
      email: null,
      lastPullAtMs: null,
    };
  }
  const conn = await getConnection(uid).catch(() => null);
  return {
    configured: true,
    connected: !!conn,
    email: conn?.connected_email ?? null,
    lastPullAtMs:
      typeof conn?.last_pull_at_ms === "number" ? conn.last_pull_at_ms : null,
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

/** Persist a freshly-authorized connection for this EOS user. */
export async function saveConnection(params: {
  refreshToken: string;
  accessToken: string;
  expiresInSec: number;
  uid: string;
  email: string | null;
}): Promise<void> {
  await connectionRef(params.uid).set(
    {
      refresh_token: params.refreshToken,
      access_token: params.accessToken,
      access_token_expiry: Date.now() + params.expiresInSec * 1000,
      connected_by_uid: params.uid,
      connected_email: params.email,
      // Clear any prior tasklist — a reconnect may use a different Google
      // account, so the old list id is not valid for the new tokens.
      tasklist_id: null,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** Drop this user's Google Tasks connection (tokens + cached tasklist). */
export async function clearConnection(uid: string): Promise<void> {
  await connectionRef(uid).delete();
}

// --- OAuth CSRF state (server-side) ---------------------------------------
// Stored in Firestore rather than only a cookie: Cloud Run exposes multiple
// hostnames for one service (*.a.run.app vs *.run.app). Cookies are
// host-scoped, but the OAuth callback is pinned to GOOGLE_OAUTH_REDIRECT_URI,
// so a cookie set on the "other" host never arrives and Connect fails with
// state_error. Server-side state is host-independent.
// Admin-SDK only; firestore.rules default-denies clients.

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function oauthStateRef(state: string) {
  return getAdminDb().collection("oauth_csrf_states").doc(state);
}

/** Persist a one-time OAuth CSRF state for this uid. */
export async function saveOAuthState(state: string, uid: string): Promise<void> {
  await oauthStateRef(state).set({
    uid,
    created_at: FieldValue.serverTimestamp(),
    expires_at_ms: Date.now() + OAUTH_STATE_TTL_MS,
  });
}

/**
 * Consume a one-time OAuth CSRF state. Returns true only when the doc exists,
 * belongs to `uid`, and is unexpired. Always deletes the doc when present
 * (success or failed ownership/expiry) so states can't be replayed.
 */
export async function consumeOAuthState(
  state: string,
  uid: string,
): Promise<boolean> {
  const ref = oauthStateRef(state);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const data = snap.data() as { uid?: string; expires_at_ms?: number };
  await ref.delete().catch(() => undefined);
  if (data.uid !== uid) return false;
  if (typeof data.expires_at_ms === "number" && Date.now() > data.expires_at_ms) {
    return false;
  }
  return true;
}

// --- Token / tasklist plumbing ---------------------------------------------

async function refreshAccessToken(
  uid: string,
  refreshToken: string,
): Promise<string> {
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
  await connectionRef(uid).set(
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

// Resolve a usable access token + the EOS tasklist id for this owner,
// refreshing/creating as needed. Returns null when they haven't connected.
async function getAuthContext(
  ownerUid: string,
): Promise<{ token: string; tasklistId: string } | null> {
  // Short-circuit before any Firestore read when the connector isn't even
  // configured — keeps the to-do write path free of overhead everywhere the
  // integration is off (prod, emulator, unconfigured trials).
  if (!googleOAuthConfigured()) return null;

  const conn = await getConnection(ownerUid);
  if (!conn) return null;

  let token = conn.access_token ?? null;
  const expiry = conn.access_token_expiry ?? 0;
  // Refresh a minute early to avoid mid-call expiry.
  if (!token || Date.now() > expiry - 60_000) {
    token = await refreshAccessToken(ownerUid, conn.refresh_token);
  }

  const tasklistId =
    conn.tasklist_id ?? (await ensureTaskList(ownerUid, token));
  return { token, tasklistId };
}

async function ensureTaskList(
  uid: string,
  accessToken: string,
): Promise<string> {
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
  await connectionRef(uid).set(
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

// Create or update the mirrored Google Task for a to-do in the **owner's**
// connected Google account. Returns the Google task id (new or existing), or
// null if the owner is not connected / OAuth is not configured.
// NEVER THROWS — Google being unreachable must not break an EOS to-do write.
// Callers pass the *complete* current to-do state (title, notes, due, status)
// so a PATCH can't accidentally revert an unspecified field (e.g. reopen a
// completed task on a title-only edit).
export async function upsertTaskForTodo(
  ownerUid: string,
  todo: TodoMirror,
  existingTaskId?: string | null,
): Promise<string | null> {
  if (!ownerUid) return null;
  try {
    const auth = await getAuthContext(ownerUid);
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

// Delete the mirrored Google Task from the owner's account. No-op if there's
// no mirror, no connection, or OAuth is off. Never throws.
export async function deleteTaskForTodo(
  ownerUid: string,
  existingTaskId: string | null | undefined,
): Promise<void> {
  if (!ownerUid || !existingTaskId) return;
  try {
    const auth = await getAuthContext(ownerUid);
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

// --- Google → EOS completion pull ------------------------------------------

export type GoogleTaskStatusRow = {
  id: string;
  status: string; // "completed" | "needsAction" | …
};

export type TodoPullCandidate = {
  id: string;
  google_task_id?: string | null;
  owner_id?: string | null;
  completed_at?: unknown | null;
};

/**
 * Pure matcher: which EOS todos should flip to complete given Google task
 * statuses. Only completion is applied (not reopen, not field edits).
 * Exported for unit tests.
 */
export function selectTodosToCompleteFromGoogle(
  googleTasks: GoogleTaskStatusRow[],
  todos: TodoPullCandidate[],
  ownerUid: string,
): string[] {
  if (!ownerUid) return [];
  const completedIds = new Set(
    googleTasks
      .filter((t) => t.id && t.status === "completed")
      .map((t) => t.id),
  );
  if (completedIds.size === 0) return [];

  const out: string[] = [];
  for (const todo of todos) {
    const taskId = todo.google_task_id;
    if (!taskId || !completedIds.has(taskId)) continue;
    if (todo.owner_id !== ownerUid) continue;
    if (todo.completed_at != null) continue;
    out.push(todo.id);
  }
  return out;
}

async function listTasklistTasks(
  tasklistId: string,
  accessToken: string,
): Promise<GoogleTaskStatusRow[]> {
  const rows: GoogleTaskStatusRow[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      showCompleted: "true",
      showHidden: "true",
      maxResults: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const listing = await tasksFetch(
      `/lists/${tasklistId}/tasks?${params.toString()}`,
      accessToken,
    );
    const items = (listing.items ?? []) as {
      id?: string;
      status?: string;
    }[];
    for (const item of items) {
      if (!item.id) continue;
      rows.push({ id: item.id, status: item.status ?? "needsAction" });
    }
    pageToken =
      typeof listing.nextPageToken === "string"
        ? listing.nextPageToken
        : undefined;
  } while (pageToken);
  return rows;
}

/**
 * Pull completed status from Google Tasks into EOS for this owner.
 * Never throws; never re-pushes to Google (avoids completion loops).
 */
export async function pullCompletionsForOwner(
  ownerUid: string,
): Promise<{ updated: number }> {
  if (!ownerUid || !googleOAuthConfigured()) return { updated: 0 };
  try {
    const auth = await getAuthContext(ownerUid);
    if (!auth) return { updated: 0 };

    const googleTasks = await listTasklistTasks(auth.tasklistId, auth.token);
    const completedIds = googleTasks
      .filter((t) => t.status === "completed")
      .map((t) => t.id);
    if (completedIds.length === 0) {
      await connectionRef(ownerUid).set(
        { last_pull_at_ms: Date.now(), updated_at: FieldValue.serverTimestamp() },
        { merge: true },
      );
      return { updated: 0 };
    }

    const db = getAdminDb();
    // Match by google_task_id (single-field equality). Chunk in case a
    // user has many completed mirrors — Firestore `in` caps at 30.
    const candidates: TodoPullCandidate[] = [];
    for (let i = 0; i < completedIds.length; i += 30) {
      const chunk = completedIds.slice(i, i + 30);
      const snap = await db
        .collection("todos")
        .where("google_task_id", "in", chunk)
        .get();
      for (const d of snap.docs) {
        const data = d.data();
        candidates.push({
          id: d.id,
          google_task_id: (data.google_task_id as string | null) ?? null,
          owner_id: (data.owner_id as string | null) ?? null,
          completed_at: data.completed_at ?? null,
        });
      }
    }

    // Prefer owner match (same Google account that owns the mirror). If the
    // todo was reassigned or owner_id drifted, still complete any incomplete
    // row that has this google_task_id — the id is the join key we created.
    let toComplete = selectTodosToCompleteFromGoogle(
      googleTasks,
      candidates,
      ownerUid,
    );
    if (toComplete.length === 0) {
      toComplete = candidates
        .filter((t) => {
          if (t.completed_at != null) return false;
          if (!t.google_task_id) return false;
          return completedIds.includes(t.google_task_id);
        })
        .map((t) => t.id);
    }
    let updated = 0;
    for (const todoId of toComplete) {
      await db.collection("todos").doc(todoId).update({
        completed_at: FieldValue.serverTimestamp(),
      });
      updated += 1;
    }

    await connectionRef(ownerUid).set(
      { last_pull_at_ms: Date.now(), updated_at: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { updated };
  } catch (e) {
    console.error("[google-tasks] pull failed:", e);
    return { updated: 0 };
  }
}

/**
 * Background sweep: pull completions for every connected user.
 * Used by POST /api/google/tasks/pull (Cloud Scheduler). Never throws.
 */
export async function pullCompletionsForAllConnected(): Promise<{
  users: number;
  updated: number;
}> {
  if (!googleOAuthConfigured()) return { users: 0, updated: 0 };
  try {
    const snap = await getAdminDb().collection("google_tasks_connections").get();
    let users = 0;
    let updated = 0;
    for (const doc of snap.docs) {
      const data = doc.data() as Connection;
      if (!data.refresh_token) continue;
      users += 1;
      const result = await pullCompletionsForOwner(doc.id);
      updated += result.updated;
    }
    return { users, updated };
  } catch (e) {
    console.error("[google-tasks] pull-all failed:", e);
    return { users: 0, updated: 0 };
  }
}

/** Shared secret for the scheduler pull route (env). Empty = route disabled. */
export function googleTasksPullSecret(): string | null {
  const s = process.env.GOOGLE_TASKS_PULL_SECRET?.trim();
  return s || null;
}
