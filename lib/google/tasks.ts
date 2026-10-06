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
// SECURITY: refresh tokens are stored KMS-encrypted (`refresh_token_enc`,
// lib/google/token-cipher.ts, C-06) when GOOGLE_TOKENS_KMS_KEY is set, which
// production requires. firestore.rules default-denies client access to
// `google_tasks_connections/*`. A legacy plaintext `refresh_token` is still
// read, and encrypted in place on its next successful refresh
// (scripts/encrypt-google-tokens.ts sweeps idle ones); local dev
// without the key stores plaintext. Access tokens (1-hour lifetime) stay
// plaintext so a to-do write doesn't wait on KMS.

import { timingSafeEqual } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminAccessToken, getAdminDb } from "@/lib/firebase/admin";
import {
  TOKENS_KMS_KEY_ENV,
  kmsTokenCipher,
  tokenAad,
  type TokenCipher,
} from "@/lib/google/token-cipher";
import { notify } from "@/lib/firebase/notifications";
import { recipientsFor } from "@/lib/notifications";
import { richTextToPlain } from "@/lib/rich-text";

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
//
// In production an unset env var is a misconfigured deploy, and the request
// host is attacker-influenced (Host / X-Forwarded-Host), so it fails closed
// instead of falling back (C-12, docs/SECURITY_AUDIT_2026-09-08.md).
export function resolveRedirectUri(requestUrl: string): string {
  const explicit = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "GOOGLE_OAUTH_REDIRECT_URI must be set in production (C-12).",
    );
  }
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
  /** KMS ciphertext of the refresh token (C-06). */
  refresh_token_enc?: string | null;
  refresh_token_kms_key?: string | null;
  /** Legacy plaintext; encrypted on next refresh or by scripts/encrypt-google-tokens.ts. */
  refresh_token?: string | null;
  access_token?: string | null;
  access_token_expiry?: number | null; // epoch ms
  tasklist_id?: string | null;
  connected_by_uid?: string | null;
  connected_email?: string | null;
  last_pull_at_ms?: number | null;
  // "revoked" once Google rejected the stored refresh token for good (the
  // user un-authorized the app, signed out everywhere, or the grant expired).
  // Sync stays off until a reconnect rewrites this doc.
  status?: string | null;
  revoked_at_ms?: number | null;
};

/** A stored connection whose refresh token Google has permanently rejected. */
function isRevoked(conn: Connection | null | undefined): boolean {
  return conn?.status === "revoked";
}

function clientCreds(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// Test seam: `undefined` = resolve from env.
let cipherOverride: TokenCipher | null | undefined;
export function setTokenCipherForTesting(c: TokenCipher | null | undefined) {
  cipherOverride = c;
}

/** The KMS cipher for refresh tokens, or null when the key isn't configured. */
export function tokenCipher(): TokenCipher | null {
  if (cipherOverride !== undefined) return cipherOverride;
  const key = process.env[TOKENS_KMS_KEY_ENV]?.trim();
  return key ? kmsTokenCipher(key, getAdminAccessToken) : null;
}

function hasRefreshToken(data: Connection | undefined): boolean {
  return !!(data?.refresh_token_enc || data?.refresh_token);
}

/** The usable refresh token for a stored connection (decrypting if needed). */
async function readRefreshToken(uid: string, conn: Connection): Promise<string> {
  if (conn.refresh_token_enc) {
    const cipher = tokenCipher();
    if (!cipher) {
      throw new Error(
        `${TOKENS_KMS_KEY_ENV} is not set; cannot decrypt the stored Google refresh token (C-06).`,
      );
    }
    return cipher.decrypt(conn.refresh_token_enc, tokenAad(uid));
  }
  return conn.refresh_token ?? "";
}

/**
 * The refresh-token fields to write for this user: ciphertext when the KMS
 * key is configured (and the plaintext field removed), plaintext only in
 * local dev. Production without the key fails closed rather than storing a
 * plaintext token.
 */
export async function refreshTokenFields(
  uid: string,
  refreshToken: string,
): Promise<Record<string, unknown>> {
  const cipher = tokenCipher();
  if (cipher) {
    const enc = await cipher.encrypt(refreshToken, tokenAad(uid));
    return {
      refresh_token_enc: enc.ciphertext,
      refresh_token_kms_key: enc.keyVersion,
      refresh_token: FieldValue.delete(),
    };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `${TOKENS_KMS_KEY_ENV} must be set in production; refusing to store a plaintext Google refresh token (C-06).`,
    );
  }
  return {
    refresh_token: refreshToken,
    refresh_token_enc: FieldValue.delete(),
    refresh_token_kms_key: FieldValue.delete(),
  };
}

/** Whether GOOGLE_OAUTH_CLIENT_ID/SECRET are present (env-configured). */
export function googleOAuthConfigured(): boolean {
  return clientCreds() !== null;
}

// `db` defaults to the real admin Firestore; tests pass a fake so
// connection state is inspectable/controllable without any Firestore at all.
function connectionRef(uid: string, db: Firestore = getAdminDb()) {
  return db.collection("google_tasks_connections").doc(uid);
}

async function getConnection(
  uid: string,
  db: Firestore = getAdminDb(),
): Promise<Connection | null> {
  const snap = await connectionRef(uid, db).get();
  const data = snap.data() as Connection | undefined;
  return data && hasRefreshToken(data) ? data : null;
}

/**
 * Connection status for the given EOS user (no secrets returned).
 * `revoked` means tokens are still stored but Google rejected them — the UI
 * must offer a reconnect rather than claiming the integration is healthy.
 */
export async function getTasksStatus(
  uid: string,
  db: Firestore = getAdminDb(),
): Promise<{
  configured: boolean;
  connected: boolean;
  revoked: boolean;
  revokedAtMs: number | null;
  email: string | null;
  lastPullAtMs: number | null;
}> {
  const configured = googleOAuthConfigured();
  if (!configured) {
    return {
      configured: false,
      connected: false,
      revoked: false,
      revokedAtMs: null,
      email: null,
      lastPullAtMs: null,
    };
  }
  const conn = await getConnection(uid, db).catch(() => null);
  return {
    configured: true,
    connected: !!conn,
    revoked: isRevoked(conn),
    revokedAtMs:
      typeof conn?.revoked_at_ms === "number" ? conn.revoked_at_ms : null,
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
export async function saveConnection(
  params: {
    refreshToken: string;
    accessToken: string;
    expiresInSec: number;
    uid: string;
    email: string | null;
  },
  db: Firestore = getAdminDb(),
): Promise<void> {
  const tokenFields = await refreshTokenFields(params.uid, params.refreshToken);
  await connectionRef(params.uid, db).set(
    {
      ...tokenFields,
      access_token: params.accessToken,
      access_token_expiry: Date.now() + params.expiresInSec * 1000,
      connected_by_uid: params.uid,
      connected_email: params.email,
      // Clear any prior tasklist — a reconnect may use a different Google
      // account, so the old list id is not valid for the new tokens.
      tasklist_id: null,
      // A fresh grant clears any earlier revocation, so sync resumes.
      status: "active",
      revoked_at_ms: null,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** Drop this user's Google Tasks connection (tokens + cached tasklist). */
export async function clearConnection(
  uid: string,
  db: Firestore = getAdminDb(),
): Promise<void> {
  await connectionRef(uid, db).delete();
}

// --- OAuth CSRF state (server-side) ---------------------------------------
// Stored in Firestore rather than only a cookie: Cloud Run exposes multiple
// hostnames for one service (*.a.run.app vs *.run.app). Cookies are
// host-scoped, but the OAuth callback is pinned to GOOGLE_OAUTH_REDIRECT_URI,
// so a cookie set on the "other" host never arrives and Connect fails with
// state_error. Server-side state is host-independent.
// Admin-SDK only; firestore.rules default-denies clients.

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function oauthStateRef(state: string, db: Firestore = getAdminDb()) {
  return db.collection("oauth_csrf_states").doc(state);
}

/** Persist a one-time OAuth CSRF state for this uid. */
export async function saveOAuthState(
  state: string,
  uid: string,
  db: Firestore = getAdminDb(),
): Promise<void> {
  await oauthStateRef(state, db).set({
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
  db: Firestore = getAdminDb(),
): Promise<boolean> {
  const ref = oauthStateRef(state, db);
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
  db: Firestore = getAdminDb(),
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
    const body = await res.text();
    // 400/401 from the token endpoint is Google saying this grant is gone
    // (invalid_grant / invalid_client) — retrying can never fix it, so flag
    // the connection and let the UI ask for a reconnect. 5xx and network
    // errors are transient and must NOT flip the flag.
    if (res.status === 400 || res.status === 401) {
      await connectionRef(uid, db)
        .set(
          {
            status: "revoked",
            revoked_at_ms: Date.now(),
            updated_at: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        .catch(() => undefined);
    }
    throw new Error(`Token refresh failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  await connectionRef(uid, db).set(
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
  db: Firestore = getAdminDb(),
): Promise<{ token: string; tasklistId: string } | null> {
  // Short-circuit before any Firestore read when the connector isn't even
  // configured — keeps the to-do write path free of overhead everywhere the
  // integration is off (prod, sandbox, unconfigured trials).
  if (!googleOAuthConfigured()) return null;

  const conn = await getConnection(ownerUid, db);
  if (!conn) return null;
  // Tokens are dead until the user reconnects — don't spend a refresh (or a
  // Tasks call) proving it on every to-do write.
  if (isRevoked(conn)) return null;

  let token = conn.access_token ?? null;
  const expiry = conn.access_token_expiry ?? 0;
  // Refresh a minute early to avoid mid-call expiry.
  if (!token || Date.now() > expiry - 60_000) {
    const refreshToken = await readRefreshToken(ownerUid, conn);
    token = await refreshAccessToken(ownerUid, refreshToken, db);
    // Legacy plaintext token that just proved valid: encrypt it in place
    // (C-06). Best-effort — sync carries on if KMS is briefly unavailable,
    // and the next refresh tries again.
    if (!conn.refresh_token_enc && tokenCipher()) {
      try {
        await connectionRef(ownerUid, db).set(
          await refreshTokenFields(ownerUid, refreshToken),
          { merge: true },
        );
      } catch (e) {
        console.error("[google-tasks] refresh-token encryption failed:", e);
      }
    }
  }

  const tasklistId =
    conn.tasklist_id ?? (await ensureTaskList(ownerUid, token, db));
  return { token, tasklistId };
}

async function ensureTaskList(
  uid: string,
  accessToken: string,
  db: Firestore = getAdminDb(),
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
  await connectionRef(uid, db).set(
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
// Builds the Google Tasks request body for a to-do mirror (title/status/notes
// /due mapping). Extracted verbatim from upsertTaskForTodo so it can be unit
// tested on its own — no behavior change.
export function buildTaskBody(todo: TodoMirror): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: todo.title,
    status: todo.completed ? "completed" : "needsAction",
  };
  // Descriptions may carry the markdown subset from lib/rich-text.ts.
  // Google Tasks notes are plain text, so flatten markers rather than
  // shipping "**bold**" into the owner's task list.
  if (todo.notes) body.notes = richTextToPlain(todo.notes) || todo.notes;
  // Tasks API stores only the date portion of `due` (RFC 3339).
  if (todo.dueDate) body.due = `${todo.dueDate}T00:00:00.000Z`;
  return body;
}

export async function upsertTaskForTodo(
  ownerUid: string,
  todo: TodoMirror,
  existingTaskId?: string | null,
  db: Firestore = getAdminDb(),
): Promise<string | null> {
  if (!ownerUid) return null;
  try {
    const auth = await getAuthContext(ownerUid, db);
    if (!auth) return null;

    const body = buildTaskBody(todo);

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
  db: Firestore = getAdminDb(),
): Promise<{ updated: number }> {
  if (!ownerUid || !googleOAuthConfigured()) return { updated: 0 };
  try {
    const auth = await getAuthContext(ownerUid, db);
    if (!auth) return { updated: 0 };

    const googleTasks = await listTasklistTasks(auth.tasklistId, auth.token);
    const completedIds = googleTasks
      .filter((t) => t.status === "completed")
      .map((t) => t.id);
    if (completedIds.length === 0) {
      await connectionRef(ownerUid, db).set(
        { last_pull_at_ms: Date.now(), updated_at: FieldValue.serverTimestamp() },
        { merge: true },
      );
      return { updated: 0 };
    }

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
      const ref = db.collection("todos").doc(todoId);
      const before = (await ref.get()).data() ?? {};
      await ref.update({
        completed_at: FieldValue.serverTimestamp(),
      });
      updated += 1;

      // Checking a task off in Google is the owner completing it — tell the
      // to-do's other followers the same way an in-app check-off would.
      const recipientIds = recipientsFor({
        followerIds: before.follower_ids,
        actorId: ownerUid,
        visibility: before.visibility,
        ownerId: before.owner_id,
      });
      if (recipientIds.length > 0 && typeof before.team_id === "string") {
        const teamSnap = await db.collection("teams").doc(before.team_id).get();
        await notify({
          db,
          recipientIds,
          kind: "completed",
          team: {
            id: before.team_id,
            name: String(teamSnap.data()?.name ?? "Team"),
          },
          entity: {
            type: "todo",
            id: todoId,
            title: String(before.title ?? "To-do"),
          },
          actor: { id: ownerUid },
          detail: "Completed from Google Tasks",
        });
      }
    }

    await connectionRef(ownerUid, db).set(
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
      if (!hasRefreshToken(data)) continue;
      // A revoked grant can't be pulled from; skip it instead of burning a
      // failed refresh per sweep.
      if (isRevoked(data)) continue;
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

/**
 * Does an `Authorization` header carry exactly `Bearer <secret>`? Constant
 * time in the header's content (C-09): `timingSafeEqual` needs equal-length
 * buffers, so a length mismatch is rejected first — that reveals only the
 * length, which the secret's format doesn't hide anyway.
 */
export function bearerMatches(header: string | null, secret: string): boolean {
  const got = Buffer.from(header ?? "", "utf8");
  const want = Buffer.from(`Bearer ${secret}`, "utf8");
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}
