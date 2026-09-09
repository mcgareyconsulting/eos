import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Auth, UserRecord } from "firebase-admin/auth";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import {
  requireTeamAccess,
  requireTeamLeader,
  requireAdmin,
  requireOrgReader,
  isOrgReader,
  requireTeamDoc,
  getTeamMembers,
  getOrgTeams,
  getImportableTeams,
  getOrgAdmins,
  getOrgDirectory,
} from "./teams";

// requireFirebaseUser()'s shape, trimmed to what teams.ts reads.
function fakeUser(opts: { uid: string; isAdmin: boolean; db: FakeFirestore }) {
  return async () => ({
    uid: opts.uid,
    email: null,
    name: null,
    picture: null,
    isAdmin: opts.isAdmin,
    db: opts.db.asFirestore(),
  });
}

// next/navigation's notFound()/redirect() throw a special error carrying a
// digest; assert against that rather than a message string.
async function assertNotFound(run: () => Promise<unknown>) {
  await assert.rejects(run, (err: unknown) => {
    assert.match((err as { digest?: string }).digest ?? "", /^NEXT_HTTP_ERROR_FALLBACK;404/);
    return true;
  });
}

function seedTeam(db: FakeFirestore, id: string, name = "Team " + id) {
  db.seed("teams", id, { name });
}

function seedMembership(
  db: FakeFirestore,
  teamId: string,
  userId: string,
  role: string,
) {
  db.seed("team_members", `${teamId}__${userId}`, {
    team_id: teamId,
    user_id: userId,
    role,
  });
}

describe("requireTeamAccess", () => {
  test("member of the team is allowed", async () => {
    const db = new FakeFirestore();
    seedTeam(db, "t1", "Leadership");
    seedMembership(db, "t1", "u1", "member");
    const result = await requireTeamAccess("t1", {
      user: fakeUser({ uid: "u1", isAdmin: false, db }),
    });
    assert.equal(result.team.id, "t1");
    assert.equal(result.team.name, "Leadership");
    assert.equal(result.membershipRole, "member");
    assert.equal(result.isAdmin, false);
  });

  test("org admin bypasses membership even with no roster row", async () => {
    const db = new FakeFirestore();
    seedTeam(db, "t1");
    const result = await requireTeamAccess("t1", {
      user: fakeUser({ uid: "admin-1", isAdmin: true, db }),
    });
    assert.equal(result.team.id, "t1");
    assert.equal(result.membershipRole, null);
  });

  test("non-member is 404'd, not told the team exists", async () => {
    const db = new FakeFirestore();
    seedTeam(db, "t1");
    await assertNotFound(() =>
      requireTeamAccess("t1", {
        user: fakeUser({ uid: "stranger", isAdmin: false, db }),
      }),
    );
  });

  test("missing team doc 404s even for a member row", async () => {
    const db = new FakeFirestore();
    // Membership row exists but the team itself was deleted/never created.
    seedMembership(db, "ghost-team", "u1", "member");
    await assertNotFound(() =>
      requireTeamAccess("ghost-team", {
        user: fakeUser({ uid: "u1", isAdmin: false, db }),
      }),
    );
  });
});

describe("requireTeamLeader", () => {
  test("leader is allowed", async () => {
    const db = new FakeFirestore();
    seedTeam(db, "t1");
    seedMembership(db, "t1", "u1", "leader");
    const result = await requireTeamLeader("t1", {
      user: fakeUser({ uid: "u1", isAdmin: false, db }),
    });
    assert.equal(result.team.id, "t1");
  });

  test("plain member (not leader) is denied", async () => {
    const db = new FakeFirestore();
    seedTeam(db, "t1");
    seedMembership(db, "t1", "u1", "member");
    await assertNotFound(() =>
      requireTeamLeader("t1", {
        user: fakeUser({ uid: "u1", isAdmin: false, db }),
      }),
    );
  });

  test("org admin bypasses the leader check", async () => {
    const db = new FakeFirestore();
    seedTeam(db, "t1");
    const result = await requireTeamLeader("t1", {
      user: fakeUser({ uid: "admin-1", isAdmin: true, db }),
    });
    assert.equal(result.team.id, "t1");
  });

  test("missing team doc 404s even for a leader row", async () => {
    const db = new FakeFirestore();
    seedMembership(db, "ghost-team", "u1", "leader");
    await assertNotFound(() =>
      requireTeamLeader("ghost-team", {
        user: fakeUser({ uid: "u1", isAdmin: false, db }),
      }),
    );
  });
});

describe("requireAdmin", () => {
  test("admin is allowed and the user record is returned", async () => {
    const db = new FakeFirestore();
    const result = await requireAdmin({
      user: fakeUser({ uid: "admin-1", isAdmin: true, db }),
    });
    assert.equal(result.uid, "admin-1");
    assert.equal(result.isAdmin, true);
  });

  test("non-admin is 404'd", async () => {
    const db = new FakeFirestore();
    await assertNotFound(() =>
      requireAdmin({ user: fakeUser({ uid: "u1", isAdmin: false, db }) }),
    );
  });
});

describe("requireTeamDoc", () => {
  test("returns the snapshot when the doc belongs to the team", async () => {
    const db = new FakeFirestore();
    db.seed("rocks", "r1", { team_id: "t1", title: "Ship it" });
    const snap = await requireTeamDoc(db.asFirestore(), "rocks", "r1", "t1");
    assert.equal(snap.id, "r1");
    assert.equal(snap.data()?.title, "Ship it");
  });

  test("404s when the doc belongs to a different team", async () => {
    const db = new FakeFirestore();
    db.seed("rocks", "r1", { team_id: "other-team" });
    await assertNotFound(() =>
      requireTeamDoc(db.asFirestore(), "rocks", "r1", "t1"),
    );
  });

  test("404s when the doc doesn't exist", async () => {
    const db = new FakeFirestore();
    await assertNotFound(() =>
      requireTeamDoc(db.asFirestore(), "rocks", "missing", "t1"),
    );
  });
});

describe("getTeamMembers", () => {
  test("hydrates display name/email from user profiles", async () => {
    const db = new FakeFirestore();
    seedMembership(db, "t1", "u1", "leader");
    seedMembership(db, "t1", "u2", "member");
    db.seed("users", "u1", { display_name: "Ada Lovelace", email: "ada@x.com" });
    // u2 has no profile doc yet.

    const members = await getTeamMembers("t1", {
      user: fakeUser({ uid: "u1", isAdmin: false, db }),
    });
    const byId = new Map(members.map((m) => [m.user_id, m]));
    assert.equal(byId.get("u1")?.full_name, "Ada Lovelace");
    assert.equal(byId.get("u1")?.role, "leader");
    assert.equal(byId.get("u2")?.full_name, "—");
    assert.equal(byId.get("u2")?.role, "member");
  });

  test("returns empty when the team has no members", async () => {
    const db = new FakeFirestore();
    const members = await getTeamMembers("empty-team", {
      user: fakeUser({ uid: "u1", isAdmin: false, db }),
    });
    assert.deepEqual(members, []);
  });
});

describe("getOrgTeams", () => {
  test("lists every team", async () => {
    const db = new FakeFirestore();
    seedTeam(db, "t1", "Leadership");
    seedTeam(db, "t2", "Sales");
    const teams = await getOrgTeams({
      user: fakeUser({ uid: "u1", isAdmin: false, db }),
    });
    assert.deepEqual(
      teams.map((t) => t.id).sort(),
      ["t1", "t2"],
    );
  });
});

describe("getImportableTeams", () => {
  test("org admin gets every team", async () => {
    const db = new FakeFirestore();
    seedTeam(db, "t1");
    seedTeam(db, "t2");
    const teams = await getImportableTeams(undefined, {
      user: fakeUser({ uid: "admin-1", isAdmin: true, db }),
    });
    assert.deepEqual(
      teams.map((t) => t.id).sort(),
      ["t1", "t2"],
    );
  });

  test("leader gets only the teams they lead", async () => {
    const db = new FakeFirestore();
    seedTeam(db, "t1", "Led");
    seedTeam(db, "t2", "Member-only");
    seedMembership(db, "t1", "u1", "leader");
    seedMembership(db, "t2", "u1", "member");
    const teams = await getImportableTeams(undefined, {
      user: fakeUser({ uid: "u1", isAdmin: false, db }),
    });
    assert.deepEqual(teams.map((t) => t.id), ["t1"]);
  });

  test("plain member with no led teams gets none", async () => {
    const db = new FakeFirestore();
    seedTeam(db, "t1");
    seedMembership(db, "t1", "u1", "member");
    const teams = await getImportableTeams(undefined, {
      user: fakeUser({ uid: "u1", isAdmin: false, db }),
    });
    assert.deepEqual(teams, []);
  });

  test("alwaysIncludeTeamId keeps the current team even for a read-only viewer", async () => {
    const db = new FakeFirestore();
    seedTeam(db, "t1", "Viewing");
    seedMembership(db, "t1", "u1", "member");
    const teams = await getImportableTeams("t1", {
      user: fakeUser({ uid: "u1", isAdmin: false, db }),
    });
    assert.deepEqual(teams.map((t) => t.id), ["t1"]);
  });
});

function fakeAdminRecord(uid: string, name: string, email: string): UserRecord {
  return {
    uid,
    displayName: name,
    email,
    customClaims: { role: "admin" },
  } as unknown as UserRecord;
}

function fakeNonAdminRecord(uid: string): UserRecord {
  return { uid, customClaims: {} } as unknown as UserRecord;
}

describe("getOrgAdmins", () => {
  test("returns only role:admin users, sorted by name, across pages", async () => {
    const db = new FakeFirestore();
    const page1 = {
      users: [fakeNonAdminRecord("u1"), fakeAdminRecord("a2", "Zed", "z@x.com")],
      pageToken: "page-2",
    };
    const page2 = {
      users: [fakeAdminRecord("a1", "Ada", "a@x.com")],
      pageToken: undefined,
    };
    let call = 0;
    const fakeAuth = {
      listUsers: async () => {
        call += 1;
        return call === 1 ? page1 : page2;
      },
    } as unknown as Auth;

    const admins = await getOrgAdmins({
      user: fakeUser({ uid: "u1", isAdmin: false, db }),
      auth: () => fakeAuth,
    });
    assert.deepEqual(
      admins.map((a) => a.uid),
      ["a1", "a2"],
    );
  });
});

describe("getOrgDirectory", () => {
  test("groups members by team, leaders first, alpha within role", async () => {
    const db = new FakeFirestore();
    seedTeam(db, "t1", "Leadership");
    // The leader sorts AFTER the member alphabetically, so this only passes
    // if role ordering is applied before the name sort.
    seedMembership(db, "t1", "u1", "member");
    seedMembership(db, "t1", "u2", "leader");
    db.seed("users", "u1", { display_name: "Amir" });
    db.seed("users", "u2", { display_name: "Zoe" });

    const directory = await getOrgDirectory({
      user: fakeUser({ uid: "u1", isAdmin: false, db }),
    });
    const team = directory.find((t) => t.id === "t1");
    assert.ok(team);
    assert.deepEqual(
      team!.members.map((m) => m.full_name),
      ["Zoe", "Amir"],
    );
    assert.equal(team!.members[0].role, "leader");
  });
});

describe("requireOrgReader", () => {
  test("an org admin is allowed without any leadership team existing", async () => {
    const db = new FakeFirestore();
    seedTeam(db, "t1");
    const reader = await requireOrgReader({
      user: fakeUser({ uid: "admin", isAdmin: true, db }),
    });
    assert.equal(reader.uid, "admin");
    assert.equal(reader.viaLeadershipTeamId, null);
  });

  test("a member of the leadership team is allowed and names the team", async () => {
    const db = new FakeFirestore();
    db.seed("teams", "lead", { name: "Leadership", is_leadership: true });
    seedMembership(db, "lead", "u1", "member");
    const reader = await requireOrgReader({
      user: fakeUser({ uid: "u1", isAdmin: false, db }),
    });
    assert.equal(reader.viaLeadershipTeamId, "lead");
  });

  // The whole point of the gate: being on *a* team is not org-wide read.
  test("a member of an ordinary team is not an org reader", async () => {
    const db = new FakeFirestore();
    db.seed("teams", "lead", { name: "Leadership", is_leadership: true });
    seedTeam(db, "t2", "Lending");
    seedMembership(db, "t2", "u2", "leader");
    await assertNotFound(() =>
      requireOrgReader({ user: fakeUser({ uid: "u2", isAdmin: false, db }) }),
    );
  });

  test("no leadership team means no non-admin readers", async () => {
    const db = new FakeFirestore();
    seedTeam(db, "t1");
    seedMembership(db, "t1", "u1", "leader");
    await assertNotFound(() =>
      requireOrgReader({ user: fakeUser({ uid: "u1", isAdmin: false, db }) }),
    );
  });
});

describe("isOrgReader", () => {
  test("answers with a boolean instead of 404ing the layout", async () => {
    const db = new FakeFirestore();
    db.seed("teams", "lead", { name: "Leadership", is_leadership: true });
    seedMembership(db, "lead", "u1", "member");
    seedTeam(db, "t2", "Lending");
    seedMembership(db, "t2", "u2", "member");

    assert.equal(
      await isOrgReader({ user: fakeUser({ uid: "u1", isAdmin: false, db }) }),
      true,
    );
    assert.equal(
      await isOrgReader({ user: fakeUser({ uid: "u2", isAdmin: false, db }) }),
      false,
    );
    assert.equal(
      await isOrgReader({ user: fakeUser({ uid: "a", isAdmin: true, db }) }),
      true,
    );
  });
});
