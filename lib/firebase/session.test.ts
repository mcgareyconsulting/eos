import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { DecodedIdToken } from "firebase-admin/auth";
import {
  createSession,
  endSession,
  renewSession,
  verifySession,
  type SessionDeps,
} from "./session";
import {
  EMAIL_UNVERIFIED_MESSAGE,
  NOT_AUTHORIZED_MESSAGE,
} from "@/lib/auth-allowlist";

const HOUR = 60 * 60 * 1000;
const T0 = 1_800_000_000; // seconds — issue time of the "current" cookie

type Call = [string, ...unknown[]];

// Fake Admin Auth + cookie store that record every call, so tests can assert
// on order (revoke before clear) and on the cookie flags.
function harness(opts: {
  cookie?: string;
  session?: Partial<DecodedIdToken> | "invalid";
  idToken?: Partial<DecodedIdToken>;
  nowHours?: number;
  revokeFails?: boolean;
}) {
  const calls: Call[] = [];
  const jar = new Map<string, string>();
  if (opts.cookie) jar.set("__firebase_session", opts.cookie);
  const session = {
    uid: "u1",
    email: "jane@highplainsbank.com",
    email_verified: true,
    iat: T0,
    exp: T0 + 12 * 3600,
    ...(opts.session === "invalid" ? {} : opts.session),
  } as DecodedIdToken;
  const idToken = {
    uid: "u1",
    email: "jane@highplainsbank.com",
    email_verified: true,
    ...opts.idToken,
  } as DecodedIdToken;

  const deps: SessionDeps = {
    now: () => T0 * 1000 + (opts.nowHours ?? 0) * HOUR,
    auth: () => ({
      verifyIdToken: async (token: string, checkRevoked?: boolean) => {
        calls.push(["verifyIdToken", token, checkRevoked]);
        return idToken;
      },
      createSessionCookie: async (token: string, o: { expiresIn: number }) => {
        calls.push(["createSessionCookie", token, o.expiresIn]);
        return "new-cookie";
      },
      verifySessionCookie: async (cookie: string, checkRevoked?: boolean) => {
        calls.push(["verifySessionCookie", cookie, checkRevoked]);
        if (opts.session === "invalid") throw new Error("revoked");
        return session;
      },
      revokeRefreshTokens: async (uid: string) => {
        calls.push(["revokeRefreshTokens", uid]);
        if (opts.revokeFails) throw new Error("auth down");
      },
    }),
    cookies: async () => ({
      get: (name: string) =>
        jar.has(name) ? { value: jar.get(name)! } : undefined,
      set: (name: string, value: string, o: unknown) => {
        calls.push(["cookies.set", name, value, o]);
        jar.set(name, value);
      },
      delete: (name: string) => {
        calls.push(["cookies.delete", name]);
        jar.delete(name);
      },
    }),
  };
  return { deps, calls, jar };
}

function withAllowlist(value: string | undefined, run: () => Promise<void>) {
  const prev = process.env.SIGN_IN_ALLOWLIST;
  if (value === undefined) delete process.env.SIGN_IN_ALLOWLIST;
  else process.env.SIGN_IN_ALLOWLIST = value;
  return run().finally(() => {
    if (prev === undefined) delete process.env.SIGN_IN_ALLOWLIST;
    else process.env.SIGN_IN_ALLOWLIST = prev;
  });
}

describe("createSession", () => {
  test("mints a 12-hour HttpOnly, SameSite=Lax cookie", async () => {
    const h = harness({});
    await withAllowlist("@highplainsbank.com", () => createSession("tok", h.deps));
    assert.deepEqual(
      h.calls.find((c) => c[0] === "createSessionCookie"),
      ["createSessionCookie", "tok", 12 * HOUR],
    );
    const set = h.calls.find((c) => c[0] === "cookies.set");
    assert.deepEqual(set?.[3], {
      maxAge: 12 * 3600,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      sameSite: "lax",
    });
  });

  test("refuses an unverified email even when allowlisted (C-04)", async () => {
    const h = harness({ idToken: { email_verified: false } });
    await withAllowlist("@highplainsbank.com", () =>
      assert.rejects(createSession("tok", h.deps), new Error(EMAIL_UNVERIFIED_MESSAGE)),
    );
    assert.equal(h.calls.some((c) => c[0] === "createSessionCookie"), false);
  });

  test("refuses an unverified email with no allowlist configured", async () => {
    const h = harness({ idToken: { email_verified: undefined } });
    await withAllowlist(undefined, () =>
      assert.rejects(createSession("tok", h.deps), new Error(EMAIL_UNVERIFIED_MESSAGE)),
    );
  });

  test("still refuses a verified account off the allowlist", async () => {
    const h = harness({ idToken: { email: "x@gmail.com" } });
    await withAllowlist("@highplainsbank.com", () =>
      assert.rejects(createSession("tok", h.deps), new Error(NOT_AUTHORIZED_MESSAGE)),
    );
  });
});

describe("verifySession", () => {
  test("returns the decoded session and checks revocation", async () => {
    const h = harness({ cookie: "c", nowHours: 1 });
    const decoded = await verifySession(h.deps);
    assert.equal(decoded?.uid, "u1");
    assert.deepEqual(h.calls[0], ["verifySessionCookie", "c", true]);
  });

  test("no cookie, or a revoked one, is no session", async () => {
    assert.equal(await verifySession(harness({}).deps), null);
    assert.equal(
      await verifySession(harness({ cookie: "c", session: "invalid" }).deps),
      null,
    );
  });

  test("a pre-policy 5-day cookie stops working 12 hours after issue", async () => {
    const legacy = { exp: T0 + 5 * 24 * 3600 };
    const early = harness({ cookie: "c", session: legacy, nowHours: 11 });
    assert.equal((await verifySession(early.deps))?.uid, "u1");
    const late = harness({ cookie: "c", session: legacy, nowHours: 13 });
    assert.equal(await verifySession(late.deps), null);
  });
});

describe("verifySession perimeter on every request", () => {
  test("an allowlisted, verified user passes", async () => {
    const h = harness({ cookie: "c", nowHours: 1 });
    await withAllowlist("@highplainsbank.com", async () => {
      assert.equal((await verifySession(h.deps))?.uid, "u1");
    });
  });

  test("an exact-email allowlist entry passes", async () => {
    const h = harness({ cookie: "c", session: { email: "Consultant@Example.com" } });
    await withAllowlist("consultant@example.com", async () => {
      assert.equal((await verifySession(h.deps))?.uid, "u1");
    });
  });

  test("removed from the allowlist: refused on the next verify, mid-session", async () => {
    const h = harness({ cookie: "c", nowHours: 1 });
    await withAllowlist("@highplainsbank.com", async () => {
      assert.ok(await verifySession(h.deps));
    });
    await withAllowlist("@elsewhere.com", async () => {
      assert.equal(await verifySession(h.deps), null);
    });
  });

  test("unverified email is refused, with or without an allowlist", async () => {
    const h = harness({ cookie: "c", session: { email_verified: false } });
    await withAllowlist("@highplainsbank.com", async () => {
      assert.equal(await verifySession(h.deps), null);
    });
    await withAllowlist(undefined, async () => {
      assert.equal(await verifySession(h.deps), null);
    });
  });

  test("allowlist unset keeps open behavior for a verified user", async () => {
    const h = harness({ cookie: "c", session: { email: "anyone@gmail.com" } });
    await withAllowlist(undefined, async () => {
      assert.equal((await verifySession(h.deps))?.uid, "u1");
    });
  });

  test("a cookie missing the email claim is refused when an allowlist is set", async () => {
    const h = harness({ cookie: "c", session: { email: undefined } });
    await withAllowlist("@highplainsbank.com", async () => {
      assert.equal(await verifySession(h.deps), null);
    });
  });

  test("makes no extra Auth calls beyond the cookie verification", async () => {
    const h = harness({ cookie: "c" });
    await withAllowlist("@highplainsbank.com", () => verifySession(h.deps).then(() => {}));
    assert.deepEqual(h.calls.map((c) => c[0]), ["verifySessionCookie"]);
  });

  test("a refused user can still sign out and have tokens revoked", async () => {
    const h = harness({ cookie: "c" });
    await withAllowlist("@elsewhere.com", () => endSession(h.deps));
    assert.ok(h.calls.some((c) => c[0] === "revokeRefreshTokens"));
    assert.equal(h.jar.has("__firebase_session"), false);
  });
});

describe("renewSession", () => {
  test("leaves a session younger than its half-life alone", async () => {
    const h = harness({ cookie: "c", nowHours: 2 });
    assert.equal(await renewSession("tok", h.deps), false);
    assert.equal(h.calls.some((c) => c[0] === "verifyIdToken"), false);
    assert.equal(h.jar.get("__firebase_session"), "c");
  });

  test("re-mints a 12-hour cookie past the half-life", async () => {
    const h = harness({ cookie: "c", nowHours: 7 });
    await withAllowlist("@highplainsbank.com", async () => {
      assert.equal(await renewSession("tok", h.deps), true);
    });
    // The fresh ID token is checked for revocation too.
    assert.deepEqual(
      h.calls.find((c) => c[0] === "verifyIdToken"),
      ["verifyIdToken", "tok", true],
    );
    assert.equal(h.jar.get("__firebase_session"), "new-cookie");
  });

  test("an expired or missing session is not renewable", async () => {
    assert.equal(await renewSession("tok", harness({ nowHours: 7 }).deps), false);
    const expired = harness({ cookie: "c", nowHours: 13 });
    assert.equal(await renewSession("tok", expired.deps), false);
    assert.equal(expired.jar.get("__firebase_session"), "c");
  });

  test("refuses an ID token for a different user", async () => {
    const h = harness({ cookie: "c", nowHours: 7, idToken: { uid: "u2" } });
    await withAllowlist(undefined, () =>
      assert.rejects(renewSession("tok", h.deps), /different account/),
    );
    assert.equal(h.jar.get("__firebase_session"), "c");
  });

  test("someone taken off the allowlist is not renewed", async () => {
    const h = harness({ cookie: "c", nowHours: 7 });
    // The per-request check refuses the current session first, so renewal
    // declines (like an expired session) before it ever sees the ID token.
    await withAllowlist("@elsewhere.com", async () => {
      assert.equal(await renewSession("tok", h.deps), false);
    });
    assert.equal(h.jar.get("__firebase_session"), "c");
  });

  test("the fresh ID token must still pass the perimeter on its own", async () => {
    // The cookie's claims pass, but the new ID token does not (e.g. the
    // account's email changed or lost verification) — renewal still refuses.
    const unverified = harness({
      cookie: "c",
      nowHours: 7,
      idToken: { email_verified: false },
    });
    await withAllowlist("@highplainsbank.com", () =>
      assert.rejects(
        renewSession("tok", unverified.deps),
        new Error(EMAIL_UNVERIFIED_MESSAGE),
      ),
    );
    assert.equal(unverified.jar.get("__firebase_session"), "c");

    const moved = harness({
      cookie: "c",
      nowHours: 7,
      idToken: { email: "jane@gmail.com" },
    });
    await withAllowlist("@highplainsbank.com", () =>
      assert.rejects(
        renewSession("tok", moved.deps),
        new Error(NOT_AUTHORIZED_MESSAGE),
      ),
    );
    assert.equal(moved.jar.get("__firebase_session"), "c");
  });
});

describe("endSession", () => {
  test("revokes refresh tokens, then clears the cookie", async () => {
    const h = harness({ cookie: "c", nowHours: 1 });
    await endSession(h.deps);
    const order = h.calls.map((c) => c[0]).filter((n) => n !== "verifySessionCookie");
    assert.deepEqual(order, ["revokeRefreshTokens", "cookies.delete"]);
    assert.deepEqual(
      h.calls.find((c) => c[0] === "revokeRefreshTokens"),
      ["revokeRefreshTokens", "u1"],
    );
    assert.equal(h.jar.has("__firebase_session"), false);
  });

  test("clears the cookie even when revocation fails", async () => {
    const h = harness({ cookie: "c", nowHours: 1, revokeFails: true });
    const origError = console.error;
    console.error = () => {};
    try {
      await endSession(h.deps);
    } finally {
      console.error = origError;
    }
    assert.equal(h.jar.has("__firebase_session"), false);
  });

  test("with no valid session there is nothing to revoke", async () => {
    const h = harness({ cookie: "c", session: "invalid" });
    await endSession(h.deps);
    assert.equal(h.calls.some((c) => c[0] === "revokeRefreshTokens"), false);
    assert.equal(h.jar.has("__firebase_session"), false);
  });
});
