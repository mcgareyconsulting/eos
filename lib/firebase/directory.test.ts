import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Auth, UserRecord } from "firebase-admin/auth";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { getDirectoryPeople } from "./directory";

function fakeUser(db: FakeFirestore) {
  return async () => ({
    uid: "viewer",
    email: null,
    name: null,
    picture: null,
    isAdmin: false,
    db: db.asFirestore(),
  });
}

function record(
  uid: string,
  opts: { name?: string; email?: string; admin?: boolean; signedIn?: boolean } = {},
): UserRecord {
  return {
    uid,
    displayName: opts.name,
    email: opts.email,
    customClaims: opts.admin ? { role: "admin" } : {},
    metadata: { lastSignInTime: opts.signedIn ? "2026-09-01T00:00:00Z" : null },
  } as unknown as UserRecord;
}

function fakeAuth(users: UserRecord[]): () => Auth {
  return () =>
    ({ listUsers: async () => ({ users, pageToken: undefined }) }) as unknown as Auth;
}

describe("getDirectoryPeople", () => {
  test("one row per person, teams unioned, access derived from claim then roster", async () => {
    const db = new FakeFirestore();
    db.seed("teams", "t1", { name: "Longmont" });
    db.seed("teams", "t2", { name: "Finance" });
    db.seed("users", "ada", { first_name: "Ada", last_name: "Lovelace", email: "ada@x.com" });
    db.seed("users", "bob", { first_name: "Bob", last_name: "Bell", email: "bob@x.com" });
    db.seed("users", "cy", { first_name: "Cy", last_name: "Young", email: "cy@x.com" });
    // Bob leads Longmont and sits on Finance — still one row.
    db.seed("team_members", "t1__bob", { team_id: "t1", user_id: "bob", role: "leader" });
    db.seed("team_members", "t2__bob", { team_id: "t2", user_id: "bob", role: "member" });
    db.seed("team_members", "t2__cy", { team_id: "t2", user_id: "cy", role: "member" });

    const people = await getDirectoryPeople({
      user: fakeUser(db),
      auth: fakeAuth([
        record("ada", { admin: true, signedIn: true }),
        record("bob", { signedIn: true }),
      ]),
    });

    // Sorted by last name: Bell, Lovelace, Young.
    assert.deepEqual(
      people.map((p) => [p.uid, p.access]),
      [
        ["bob", "leader"],
        ["ada", "admin"],
        ["cy", "member"],
      ],
    );
    const bob = people.find((p) => p.uid === "bob")!;
    assert.deepEqual(
      bob.teams.map((t) => `${t.name}:${t.role}`),
      ["Finance:member", "Longmont:leader"],
    );
    // Ada has the claim but no roster; Cy is an import placeholder with no account.
    assert.deepEqual(people.find((p) => p.uid === "ada")!.teams, []);
    assert.equal(people.find((p) => p.uid === "cy")!.hasAuth, false);
    assert.equal(bob.hasSignedIn, true);
  });

  test("includes uninvited sign-ins, splits their display name, and hides deactivated profiles", async () => {
    const db = new FakeFirestore();
    db.seed("users", "gone", {
      first_name: "Gone",
      last_name: "Person",
      deactivated_at: "2026-09-01T00:00:00Z",
    });

    const people = await getDirectoryPeople({
      user: fakeUser(db),
      auth: fakeAuth([
        record("gone", { signedIn: true }),
        record("walkin", { name: "Walk In", email: "walkin@x.com" }),
      ]),
    });

    assert.deepEqual(
      people.map((p) => [p.uid, p.firstName, p.lastName, p.email, p.hasSignedIn]),
      [["walkin", "Walk", "In", "walkin@x.com", false]],
    );
  });
});
