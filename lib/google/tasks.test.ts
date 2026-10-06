import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import {
  resolveRedirectUri,
  appOrigin,
  googleOAuthConfigured,
  googleTasksPullSecret,
  buildTaskBody,
  upsertTaskForTodo,
  pullCompletionsForOwner,
  saveOAuthState,
  consumeOAuthState,
  getTasksStatus,
  saveConnection,
  bearerMatches,
  setTokenCipherForTesting,
} from "./tasks";
import type { TokenCipher } from "./token-cipher";

const ENV_KEYS = [
  "GOOGLE_OAUTH_REDIRECT_URI",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_TASKS_PULL_SECRET",
  "GOOGLE_TOKENS_KMS_KEY",
  "NODE_ENV",
] as const;

let savedEnv: Record<string, string | undefined>;
let originalFetch: typeof fetch;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    // NODE_ENV is typed read-only; the env bag itself is writable.
    else (process.env as Record<string, string | undefined>)[key] = savedEnv[key];
  }
  globalThis.fetch = originalFetch;
  setTokenCipherForTesting(undefined);
});

// Records every call and returns queued responses in order; extra calls past
// the queue get a 200 {} so an unexpectedly-chatty code path fails on an
// assertion about call count/shape rather than a thrown network error.
function fetchQueue(responses: { status?: number; body?: unknown }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[i] ?? { status: 200, body: {} };
    if (i < responses.length) i += 1;
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { fn, calls };
}

function authHeader(init: RequestInit | undefined): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization;
}

describe("resolveRedirectUri", () => {
  test("prefers the explicit env var over the request origin", () => {
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://pinned.example/callback";
    assert.equal(
      resolveRedirectUri("https://anything.example/api/google/tasks/connect"),
      "https://pinned.example/callback",
    );
  });

  test("forces https for a non-localhost request when unset", () => {
    // Cloud Run terminates TLS at the proxy, so the request reaches the app
    // as http:// even for a real https:// visitor — this must not leak http.
    assert.equal(
      resolveRedirectUri("http://app.example/api/google/tasks/connect"),
      "https://app.example/api/google/tasks/callback",
    );
  });

  test("keeps http for localhost when unset", () => {
    assert.equal(
      resolveRedirectUri("http://localhost:3000/api/google/tasks/connect"),
      "http://localhost:3000/api/google/tasks/callback",
    );
  });

  test("fails closed in production when unset (C-12)", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    assert.throws(
      () => resolveRedirectUri("https://evil.example/api/google/tasks/connect"),
      /GOOGLE_OAUTH_REDIRECT_URI must be set/,
    );
    assert.throws(() => appOrigin("https://evil.example/x"));
  });

  test("uses the env var in production when set", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://pinned.example/callback";
    assert.equal(
      resolveRedirectUri("https://evil.example/api/google/tasks/connect"),
      "https://pinned.example/callback",
    );
  });
});

describe("bearerMatches", () => {
  test("accepts exactly Bearer <secret> (C-09)", () => {
    assert.equal(bearerMatches("Bearer s3cr3t", "s3cr3t"), true);
  });

  test("rejects a wrong secret of the same length", () => {
    assert.equal(bearerMatches("Bearer s3cr3x", "s3cr3t"), false);
  });

  test("rejects other lengths, schemes and a missing header without throwing", () => {
    assert.equal(bearerMatches("Bearer s3cr3", "s3cr3t"), false);
    assert.equal(bearerMatches("Bearer s3cr3tt", "s3cr3t"), false);
    assert.equal(bearerMatches("bearer s3cr3t", "s3cr3t"), false);
    assert.equal(bearerMatches("s3cr3t", "s3cr3t"), false);
    assert.equal(bearerMatches("", "s3cr3t"), false);
    assert.equal(bearerMatches(null, "s3cr3t"), false);
  });

  test("compares bytes, so multi-byte input can't slip past the length check", () => {
    // "é" is one UTF-16 unit but two UTF-8 bytes.
    assert.equal(bearerMatches("Bearer s3cr3é", "s3cr3tt"), false);
  });
});

describe("appOrigin", () => {
  test("derives the origin from the resolved redirect URI", () => {
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://pinned.example/callback";
    assert.equal(appOrigin("https://anything.example/whatever"), "https://pinned.example");
  });
});

describe("googleOAuthConfigured", () => {
  test("false when either env var is missing", () => {
    assert.equal(googleOAuthConfigured(), false);
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    assert.equal(googleOAuthConfigured(), false);
  });

  test("true when both are set", () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    assert.equal(googleOAuthConfigured(), true);
  });
});

describe("googleTasksPullSecret", () => {
  test("null when unset or blank", () => {
    assert.equal(googleTasksPullSecret(), null);
    process.env.GOOGLE_TASKS_PULL_SECRET = "   ";
    assert.equal(googleTasksPullSecret(), null);
  });

  test("returns the trimmed secret when set", () => {
    process.env.GOOGLE_TASKS_PULL_SECRET = "  s3cr3t  ";
    assert.equal(googleTasksPullSecret(), "s3cr3t");
  });
});

describe("buildTaskBody", () => {
  test("maps title/status and omits notes/due when absent", () => {
    const body = buildTaskBody({ title: "Ship it", completed: false });
    assert.deepEqual(body, { title: "Ship it", status: "needsAction" });
  });

  test("completed todo maps to status completed", () => {
    const body = buildTaskBody({ title: "Ship it", completed: true });
    assert.equal(body.status, "completed");
  });

  test("flattens rich-text notes to plain text", () => {
    const body = buildTaskBody({
      title: "T",
      completed: false,
      notes: "**bold** plan",
    });
    assert.equal(body.notes, "bold plan");
  });

  test("appends the T00:00:00.000Z suffix to a due date", () => {
    const body = buildTaskBody({
      title: "T",
      completed: false,
      dueDate: "2026-09-10",
    });
    assert.equal(body.due, "2026-09-10T00:00:00.000Z");
  });
});

// --- Token refresh + the Tasks API call, exercised through upsertTaskForTodo.
//
// Note: tasksFetch has no reactive retry-on-401 — refresh is purely proactive,
// based on the cached `access_token_expiry` (refreshed a minute early). These
// tests cover that actual mechanism rather than a 401-triggered retry, which
// this module does not implement.

describe("upsertTaskForTodo — token refresh", () => {
  test("uses the cached access token without refreshing when still valid", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "u1", {
      refresh_token: "rt",
      access_token: "at-valid",
      access_token_expiry: Date.now() + 10 * 60 * 1000,
      tasklist_id: "list-1",
    });
    const { fn, calls } = fetchQueue([{ status: 200, body: { id: "gtask-1" } }]);
    globalThis.fetch = fn;

    const id = await upsertTaskForTodo(
      "u1",
      { title: "Ship it", completed: false },
      null,
      db.asFirestore(),
    );

    assert.equal(id, "gtask-1");
    assert.equal(calls.length, 1, "only the Tasks create call, no refresh");
    assert.equal(authHeader(calls[0].init), "Bearer at-valid");
  });

  test("refreshes an expired token exactly once, then retries with the new token", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "u1", {
      refresh_token: "rt",
      access_token: "at-old",
      access_token_expiry: Date.now() - 1000,
      tasklist_id: "list-1",
    });
    const { fn, calls } = fetchQueue([
      { status: 200, body: { access_token: "at-new", expires_in: 3600 } },
      { status: 200, body: { id: "gtask-1" } },
    ]);
    globalThis.fetch = fn;

    const id = await upsertTaskForTodo(
      "u1",
      { title: "Ship it", completed: false },
      null,
      db.asFirestore(),
    );

    assert.equal(id, "gtask-1");
    assert.equal(calls.length, 2, "one refresh call, one retried Tasks call");
    assert.match(calls[0].url, /oauth2\.googleapis\.com\/token/);
    assert.match(calls[1].url, /tasks\.googleapis\.com/);
    assert.equal(authHeader(calls[1].init), "Bearer at-new");

    const conn = await db.collection("google_tasks_connections").doc("u1").get();
    assert.equal(conn.data()?.access_token, "at-new");
  });

  test("a 400 refresh marks the connection revoked, makes no Tasks API call, and reports null (never throws)", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "u1", {
      refresh_token: "rt",
      access_token: "at-old",
      access_token_expiry: Date.now() - 1000,
      tasklist_id: "list-1",
    });
    const { fn, calls } = fetchQueue([{ status: 400, body: { error: "invalid_grant" } }]);
    globalThis.fetch = fn;

    const id = await upsertTaskForTodo(
      "u1",
      { title: "Ship it", completed: false },
      null,
      db.asFirestore(),
    );

    assert.equal(id, null);
    assert.equal(calls.length, 1, "no Tasks call attempted, and no retry of the refresh itself");

    // invalid_grant is permanent: the doc is flagged so the UI can ask for a
    // reconnect instead of reporting a healthy connection forever.
    const conn = await db.collection("google_tasks_connections").doc("u1").get();
    assert.equal(conn.data()?.status, "revoked");
    assert.equal(typeof conn.data()?.revoked_at_ms, "number");
    // Tokens are left in place — only a reconnect replaces them.
    assert.equal(conn.data()?.access_token, "at-old");
  });

  test("a 500 refresh is treated as transient and does not mark the connection revoked", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "u1", {
      refresh_token: "rt",
      access_token: "at-old",
      access_token_expiry: Date.now() - 1000,
      tasklist_id: "list-1",
    });
    const { fn, calls } = fetchQueue([{ status: 500, body: { error: "backend" } }]);
    globalThis.fetch = fn;

    const id = await upsertTaskForTodo(
      "u1",
      { title: "Ship it", completed: false },
      null,
      db.asFirestore(),
    );

    assert.equal(id, null);
    assert.equal(calls.length, 1);
    const conn = await db.collection("google_tasks_connections").doc("u1").get();
    assert.equal(conn.data()?.status, undefined, "a Google outage must not disable the connector");
  });

  test("a revoked connection makes zero fetch calls", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "u1", {
      refresh_token: "rt",
      access_token: "at-valid",
      access_token_expiry: Date.now() + 10 * 60 * 1000,
      tasklist_id: "list-1",
      status: "revoked",
      revoked_at_ms: Date.now(),
    });
    const { fn, calls } = fetchQueue([]);
    globalThis.fetch = fn;

    const id = await upsertTaskForTodo(
      "u1",
      { title: "Ship it", completed: false },
      null,
      db.asFirestore(),
    );

    assert.equal(id, null);
    assert.equal(calls.length, 0, "not even the cached token is used while revoked");
  });

  test("not connected (no stored connection) is a no-op, never calls fetch", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    const { fn, calls } = fetchQueue([]);
    globalThis.fetch = fn;

    const id = await upsertTaskForTodo(
      "u1",
      { title: "Ship it", completed: false },
      null,
      db.asFirestore(),
    );
    assert.equal(id, null);
    assert.equal(calls.length, 0);
  });

  test("OAuth not configured is a no-op, never touches Firestore or fetch", async () => {
    // GOOGLE_OAUTH_CLIENT_ID/SECRET intentionally left unset.
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "u1", {
      refresh_token: "rt",
      access_token: "at-valid",
      access_token_expiry: Date.now() + 60_000,
      tasklist_id: "list-1",
    });
    const { fn, calls } = fetchQueue([]);
    globalThis.fetch = fn;

    const id = await upsertTaskForTodo(
      "u1",
      { title: "Ship it", completed: false },
      null,
      db.asFirestore(),
    );
    assert.equal(id, null);
    assert.equal(calls.length, 0);
  });
});

// --- pullCompletionsForOwner ------------------------------------------------

function seedConnection(db: FakeFirestore, uid: string, tasklistId = "list-1") {
  db.seed("google_tasks_connections", uid, {
    refresh_token: "rt",
    access_token: "at-valid",
    access_token_expiry: Date.now() + 60 * 60 * 1000,
    tasklist_id: tasklistId,
  });
}

function tasklistResponse(items: { id: string; status: string }[]) {
  return { status: 200, body: { items } };
}

describe("pullCompletionsForOwner", () => {
  test("completes only open todos owned by this owner", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    seedConnection(db, "owner-1");
    db.seed("todos", "t-done", {
      google_task_id: "g1",
      owner_id: "owner-1",
      completed_at: null,
    });
    db.seed("todos", "t-not-done-in-google", {
      google_task_id: "g2",
      owner_id: "owner-1",
      completed_at: null,
    });
    db.seed("todos", "t-already-completed", {
      google_task_id: "g3",
      owner_id: "owner-1",
      completed_at: { seconds: 1 },
    });

    globalThis.fetch = fetchQueue([
      tasklistResponse([
        { id: "g1", status: "completed" },
        { id: "g2", status: "needsAction" },
        { id: "g3", status: "completed" },
      ]),
    ]).fn;

    const result = await pullCompletionsForOwner("owner-1", db.asFirestore());
    assert.equal(result.updated, 1);

    const done = await db.collection("todos").doc("t-done").get();
    assert.ok(done.data()?.completed_at, "completed_at was set");

    const notDone = await db.collection("todos").doc("t-not-done-in-google").get();
    assert.equal(notDone.data()?.completed_at, null);

    const alreadyDone = await db.collection("todos").doc("t-already-completed").get();
    assert.deepEqual(alreadyDone.data()?.completed_at, { seconds: 1 });
  });

  test("skips a completed Google task whose EOS todo is owned by someone else, when another todo already matched by owner", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    seedConnection(db, "owner-1");
    db.seed("todos", "t-owned", {
      google_task_id: "g1",
      owner_id: "owner-1",
      completed_at: null,
    });
    db.seed("todos", "t-other-owner", {
      google_task_id: "g2",
      owner_id: "someone-else",
      completed_at: null,
    });

    globalThis.fetch = fetchQueue([
      tasklistResponse([
        { id: "g1", status: "completed" },
        { id: "g2", status: "completed" },
      ]),
    ]).fn;

    const result = await pullCompletionsForOwner("owner-1", db.asFirestore());
    assert.equal(result.updated, 1);

    const otherOwner = await db.collection("todos").doc("t-other-owner").get();
    assert.equal(
      otherOwner.data()?.completed_at,
      null,
      "not owned by this connector's owner and an owner match already existed, so it's left alone",
    );
  });

  test("falls back to completing by google_task_id alone when nothing matches by owner (reassigned todo)", async () => {
    // The id is the join key this app created; a to-do reassigned to another
    // person still gets completed when its Google task is, as long as no
    // owner-matched candidate took precedence.
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    seedConnection(db, "owner-1");
    db.seed("todos", "t-reassigned", {
      google_task_id: "g1",
      owner_id: "someone-else",
      completed_at: null,
    });
    db.seed("todos", "t-reassigned-already-done", {
      google_task_id: "g2",
      owner_id: "someone-else",
      completed_at: { seconds: 1 },
    });

    globalThis.fetch = fetchQueue([
      tasklistResponse([
        { id: "g1", status: "completed" },
        { id: "g2", status: "completed" },
      ]),
    ]).fn;

    const result = await pullCompletionsForOwner("owner-1", db.asFirestore());
    assert.equal(result.updated, 1);
    const reassigned = await db.collection("todos").doc("t-reassigned").get();
    assert.ok(reassigned.data()?.completed_at, "completed via the id-only fallback");
    const alreadyDone = await db.collection("todos").doc("t-reassigned-already-done").get();
    assert.deepEqual(alreadyDone.data()?.completed_at, { seconds: 1 }, "never re-completes");
  });

  test("no completed Google tasks updates nothing but still records last_pull_at_ms", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    seedConnection(db, "owner-1");
    globalThis.fetch = fetchQueue([tasklistResponse([{ id: "g1", status: "needsAction" }])]).fn;

    const result = await pullCompletionsForOwner("owner-1", db.asFirestore());
    assert.equal(result.updated, 0);
    const conn = await db.collection("google_tasks_connections").doc("owner-1").get();
    assert.equal(typeof conn.data()?.last_pull_at_ms, "number");
  });

  test("not connected is a no-op", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    const { fn, calls } = fetchQueue([]);
    globalThis.fetch = fn;
    const result = await pullCompletionsForOwner("owner-1", db.asFirestore());
    assert.equal(result.updated, 0);
    assert.equal(calls.length, 0);
  });

  test("a revoked connection is a no-op and makes zero fetch calls", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "owner-1", {
      refresh_token: "rt",
      access_token: "at-valid",
      access_token_expiry: Date.now() + 60 * 60 * 1000,
      tasklist_id: "list-1",
      status: "revoked",
      revoked_at_ms: Date.now(),
    });
    const { fn, calls } = fetchQueue([]);
    globalThis.fetch = fn;

    const result = await pullCompletionsForOwner("owner-1", db.asFirestore());
    assert.equal(result.updated, 0);
    assert.equal(calls.length, 0);
  });
});

// --- getTasksStatus / reconnect ---------------------------------------------

describe("getTasksStatus", () => {
  test("reports revoked for a flagged connection", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "u1", {
      refresh_token: "rt",
      connected_email: "a@example.com",
      status: "revoked",
      revoked_at_ms: 1234,
    });

    const status = await getTasksStatus("u1", db.asFirestore());
    assert.equal(status.configured, true);
    assert.equal(status.connected, true, "tokens are still stored");
    assert.equal(status.revoked, true);
    assert.equal(status.revokedAtMs, 1234);
  });

  test("a healthy connection is not revoked", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    seedConnection(db, "u1");

    const status = await getTasksStatus("u1", db.asFirestore());
    assert.equal(status.revoked, false);
    assert.equal(status.revokedAtMs, null);
  });
});

describe("saveConnection", () => {
  test("a reconnect clears the revoked flag and syncing resumes", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "u1", {
      refresh_token: "old-rt",
      access_token: "at-old",
      access_token_expiry: Date.now() - 1000,
      tasklist_id: "list-1",
      status: "revoked",
      revoked_at_ms: Date.now(),
    });

    await saveConnection(
      {
        refreshToken: "new-rt",
        accessToken: "at-new",
        expiresInSec: 3600,
        uid: "u1",
        email: "a@example.com",
      },
      db.asFirestore(),
    );

    const status = await getTasksStatus("u1", db.asFirestore());
    assert.equal(status.revoked, false);
    assert.equal(status.revokedAtMs, null);

    const { fn, calls } = fetchQueue([
      { status: 200, body: { items: [{ id: "list-2", title: "EOS · L10 To-Dos" }] } },
      { status: 200, body: { id: "gtask-1" } },
    ]);
    globalThis.fetch = fn;
    const id = await upsertTaskForTodo(
      "u1",
      { title: "Ship it", completed: false },
      null,
      db.asFirestore(),
    );
    assert.equal(id, "gtask-1");
    assert.equal(calls.length, 2, "list lookup + create; the fresh token needs no refresh");
  });
});


// --- OAuth CSRF state ---------------------------------------------------------
//
// The state token is the CSRF guard on the connect → callback round trip. It
// must be single-use, bound to the user who started the flow, and expire.

describe("consumeOAuthState", () => {
  test("valid state is accepted exactly once", async () => {
    const db = new FakeFirestore();
    await saveOAuthState("s1", "u1", db.asFirestore());
    assert.equal(await consumeOAuthState("s1", "u1", db.asFirestore()), true);
    assert.equal(
      await consumeOAuthState("s1", "u1", db.asFirestore()),
      false,
      "second use of the same state is rejected",
    );
  });

  test("state started by one user cannot be consumed by another, and is burned on the attempt", async () => {
    const db = new FakeFirestore();
    await saveOAuthState("s1", "u1", db.asFirestore());
    assert.equal(await consumeOAuthState("s1", "attacker", db.asFirestore()), false);
    // Deleted before the uid check, so the real user can't use it afterwards
    // either — a mismatched attempt invalidates the flow rather than leaving a
    // live token behind.
    assert.equal(await consumeOAuthState("s1", "u1", db.asFirestore()), false);
  });

  test("expired state is rejected", async () => {
    const db = new FakeFirestore();
    db.seed("oauth_csrf_states", "s1", { uid: "u1", expires_at_ms: Date.now() - 1 });
    assert.equal(await consumeOAuthState("s1", "u1", db.asFirestore()), false);
  });

  test("unknown state is rejected", async () => {
    const db = new FakeFirestore();
    assert.equal(await consumeOAuthState("nope", "u1", db.asFirestore()), false);
  });
});

// --- C-06: refresh tokens encrypted with KMS --------------------------------

// Reversible stand-in for KMS that records calls and enforces the AAD, like
// the real key does.
function fakeCipher() {
  const calls: { op: "encrypt" | "decrypt"; aad: string }[] = [];
  const cipher: TokenCipher = {
    async encrypt(plaintext, aad) {
      calls.push({ op: "encrypt", aad });
      return { ciphertext: `enc(${aad}|${plaintext})`, keyVersion: "keyVersions/1" };
    },
    async decrypt(ciphertext, aad) {
      calls.push({ op: "decrypt", aad });
      const m = /^enc\((.*)\|(.*)\)$/.exec(ciphertext);
      if (!m || m[1] !== aad) throw new Error("KMS decrypt failed: 400 bad AAD");
      return m[2];
    },
  };
  return { cipher, calls };
}

describe("refresh-token encryption (C-06)", () => {
  test("saveConnection stores only ciphertext, bound to the user, and drops a legacy plaintext token", async () => {
    const { cipher, calls } = fakeCipher();
    setTokenCipherForTesting(cipher);
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "u1", { refresh_token: "old-plain-rt" });

    await saveConnection(
      { refreshToken: "rt-1", accessToken: "at-1", expiresInSec: 3600, uid: "u1", email: null },
      db.asFirestore(),
    );

    const data = db.raw("google_tasks_connections/u1")!;
    assert.equal(data.refresh_token, undefined, "no plaintext refresh token left");
    assert.equal(data.refresh_token_enc, "enc(google_tasks_connections/u1|rt-1)");
    assert.equal(data.refresh_token_kms_key, "keyVersions/1");
    assert.deepEqual(calls, [{ op: "encrypt", aad: "google_tasks_connections/u1" }]);
  });

  test("production without the KMS key refuses to store a token", async () => {
    setTokenCipherForTesting(null);
    (process.env as Record<string, string>).NODE_ENV = "production";
    const db = new FakeFirestore();

    await assert.rejects(
      saveConnection(
        { refreshToken: "rt-1", accessToken: "at-1", expiresInSec: 3600, uid: "u1", email: null },
        db.asFirestore(),
      ),
      /GOOGLE_TOKENS_KMS_KEY must be set in production/,
    );
    assert.equal(db.raw("google_tasks_connections/u1"), undefined, "nothing written");
  });

  test("local dev without the key stores plaintext", async () => {
    setTokenCipherForTesting(null);
    const db = new FakeFirestore();
    await saveConnection(
      { refreshToken: "rt-1", accessToken: "at-1", expiresInSec: 3600, uid: "u1", email: null },
      db.asFirestore(),
    );
    assert.equal(db.raw("google_tasks_connections/u1")?.refresh_token, "rt-1");
  });

  test("an expired access token is refreshed with the decrypted token", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const { cipher, calls: kms } = fakeCipher();
    setTokenCipherForTesting(cipher);
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "u1", {
      refresh_token_enc: "enc(google_tasks_connections/u1|rt-secret)",
      access_token: "at-old",
      access_token_expiry: Date.now() - 1000,
      tasklist_id: "list-1",
    });
    const { fn, calls } = fetchQueue([
      { status: 200, body: { access_token: "at-new", expires_in: 3600 } },
      { status: 200, body: { id: "gtask-1" } },
    ]);
    globalThis.fetch = fn;

    const id = await upsertTaskForTodo("u1", { title: "Ship it", completed: false }, null, db.asFirestore());

    assert.equal(id, "gtask-1");
    assert.deepEqual(kms, [{ op: "decrypt", aad: "google_tasks_connections/u1" }]);
    assert.equal(new URLSearchParams(String(calls[0].init?.body)).get("refresh_token"), "rt-secret");
  });

  test("a valid cached access token needs no KMS call", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const { cipher, calls: kms } = fakeCipher();
    setTokenCipherForTesting(cipher);
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "u1", {
      refresh_token_enc: "enc(google_tasks_connections/u1|rt-secret)",
      access_token: "at-valid",
      access_token_expiry: Date.now() + 10 * 60 * 1000,
      tasklist_id: "list-1",
    });
    globalThis.fetch = fetchQueue([{ status: 200, body: { id: "gtask-1" } }]).fn;

    await upsertTaskForTodo("u1", { title: "Ship it", completed: false }, null, db.asFirestore());
    assert.equal(kms.length, 0);
  });

  test("a ciphertext copied onto another user's doc does not decrypt, and doesn't mark it revoked", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    setTokenCipherForTesting(fakeCipher().cipher);
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "u2", {
      refresh_token_enc: "enc(google_tasks_connections/u1|rt-of-u1)",
      access_token_expiry: 0,
      tasklist_id: "list-1",
    });
    const { fn, calls } = fetchQueue([]);
    globalThis.fetch = fn;

    const id = await upsertTaskForTodo("u2", { title: "x", completed: false }, null, db.asFirestore());
    assert.equal(id, null);
    assert.equal(calls.length, 0, "no token endpoint call with someone else's token");
    assert.equal(db.raw("google_tasks_connections/u2")?.status, undefined);
  });

  test("a legacy plaintext token is encrypted in place after a successful refresh", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    setTokenCipherForTesting(fakeCipher().cipher);
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "u1", {
      refresh_token: "legacy-rt",
      access_token_expiry: 0,
      tasklist_id: "list-1",
    });
    const { fn, calls } = fetchQueue([
      { status: 200, body: { access_token: "at-new", expires_in: 3600 } },
      { status: 200, body: { id: "gtask-1" } },
    ]);
    globalThis.fetch = fn;

    await upsertTaskForTodo("u1", { title: "x", completed: false }, null, db.asFirestore());

    assert.equal(new URLSearchParams(String(calls[0].init?.body)).get("refresh_token"), "legacy-rt");
    const data = db.raw("google_tasks_connections/u1")!;
    assert.equal(data.refresh_token, undefined);
    assert.equal(data.refresh_token_enc, "enc(google_tasks_connections/u1|legacy-rt)");
    assert.equal(data.access_token, "at-new");
  });

  test("a legacy token that Google rejects is not migrated", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const { cipher, calls: kms } = fakeCipher();
    setTokenCipherForTesting(cipher);
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "u1", { refresh_token: "dead-rt", access_token_expiry: 0, tasklist_id: "l" });
    globalThis.fetch = fetchQueue([{ status: 400, body: { error: "invalid_grant" } }]).fn;

    await upsertTaskForTodo("u1", { title: "x", completed: false }, null, db.asFirestore());
    assert.equal(kms.length, 0);
    assert.equal(db.raw("google_tasks_connections/u1")?.status, "revoked");
  });

  test("an encrypted-only connection reports as connected", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const db = new FakeFirestore();
    db.seed("google_tasks_connections", "u1", { refresh_token_enc: "enc(x|y)", connected_email: "a@b.c" });
    const status = await getTasksStatus("u1", db.asFirestore());
    assert.equal(status.connected, true);
    assert.equal(status.email, "a@b.c");
  });
});
