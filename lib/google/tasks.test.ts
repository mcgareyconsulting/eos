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
} from "./tasks";

const ENV_KEYS = [
  "GOOGLE_OAUTH_REDIRECT_URI",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_TASKS_PULL_SECRET",
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
    else process.env[key] = savedEnv[key];
  }
  globalThis.fetch = originalFetch;
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

  test("a failed refresh makes no Tasks API call and upsert reports null (never throws)", async () => {
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

    // The module does not clear/flag the connection on a failed refresh — it
    // just leaves the (still-expired) token in place for the next attempt.
    const conn = await db.collection("google_tasks_connections").doc("u1").get();
    assert.equal(conn.data()?.access_token, "at-old");
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
