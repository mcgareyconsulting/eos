import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Auth } from "firebase-admin/auth";
import {
  assertAnotherAdminRemains,
  hasOtherAdmin,
  LAST_ADMIN_MESSAGE,
} from "./admin-guard";

function acct(uid: string, admin: boolean) {
  return { uid, customClaims: admin ? { role: "admin" } : {} };
}

function authWith(pages: ReturnType<typeof acct>[][]): Pick<Auth, "listUsers"> {
  let call = 0;
  return {
    listUsers: async () => {
      const users = pages[call];
      call += 1;
      return { users, pageToken: call < pages.length ? "next" : undefined };
    },
  } as unknown as Pick<Auth, "listUsers">;
}

describe("last-admin guard", () => {
  test("refuses when the target is the only admin", async () => {
    const auth = authWith([[acct("a1", true), acct("m1", false)]]);
    await assert.rejects(
      () => assertAnotherAdminRemains(auth, "a1"),
      new Error(LAST_ADMIN_MESSAGE),
    );
  });

  test("allows when another admin exists", async () => {
    const auth = authWith([[acct("a1", true), acct("a2", true)]]);
    await assert.doesNotReject(() => assertAnotherAdminRemains(auth, "a1"));
  });

  test("finds another admin on a later page", async () => {
    const auth = authWith([[acct("a1", true)], [acct("a2", true)]]);
    assert.equal(await hasOtherAdmin(auth, "a1"), true);
  });

  test("non-admin accounts do not count", async () => {
    const auth = authWith([[acct("a1", true)], [acct("m1", false)]]);
    assert.equal(await hasOtherAdmin(auth, "a1"), false);
  });
});
