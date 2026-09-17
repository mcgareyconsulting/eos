import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseDelimited, toTable } from "./csv-import";
import { parseAllowlist } from "./auth-allowlist";
import { FakeFirestore } from "./test-support/fake-firestore";
import {
  buildSeedPlan,
  hasSeedColumns,
  nameFromEmail,
  readAccess,
  readSeedRows,
  runUserImport,
  splitFullName,
  type SeedAuth,
} from "./user-import";

const table = (csv: string) => toTable(parseDelimited(csv));

// ---------------------------------------------------------------------------
// Name handling
// ---------------------------------------------------------------------------

describe("splitFullName", () => {
  test("splits first from surname, keeping particles with the surname", () => {
    assert.deepEqual(splitFullName("Jane Doe"), { first: "Jane", last: "Doe" });
    assert.deepEqual(splitFullName("Jane van Doe"), {
      first: "Jane",
      last: "van Doe",
    });
  });

  test("reads the last-first form directory exports use", () => {
    assert.deepEqual(splitFullName("Doe, Jane"), { first: "Jane", last: "Doe" });
  });

  test("a single token is a first name, not a surname", () => {
    assert.deepEqual(splitFullName("Cher"), { first: "Cher", last: "" });
  });

  test("blank in, blank out", () => {
    assert.deepEqual(splitFullName("   "), { first: "", last: "" });
  });
});

describe("nameFromEmail", () => {
  test("recovers a name from the local part when the file gives none", () => {
    assert.deepEqual(nameFromEmail("jane.doe@bank.com"), {
      first: "Jane",
      last: "Doe",
    });
    assert.deepEqual(nameFromEmail("jsmith@bank.com"), {
      first: "Jsmith",
      last: "",
    });
  });
});

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

describe("readSeedRows", () => {
  test("reads the client's columns", () => {
    const { rows, issues } = readSeedRows(
      table(
        "First Name,Last Name,Team,Role access,Email\n" +
          "Jane,Doe,Leadership,Admin,Jane.Doe@Bank.com\n",
      ),
    );
    assert.equal(issues.length, 0);
    assert.deepEqual(rows[0], {
      line: 1,
      firstName: "Jane",
      lastName: "Doe",
      email: "jane.doe@bank.com", // lowercased for stable keying
      teams: ["Leadership"],
      orgAdmin: true,
      accessRaw: "Admin",
      unrecognizedAccess: null,
      title: null,
    });
  });

  test("accepts the alternate column spellings a real export uses", () => {
    const { rows } = readSeedRows(
      table(
        "Full Name,E-mail,Department,Job Title\n" +
          '"Doe, Jane",jane@bank.com,Ops,Teller\n',
      ),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].firstName, "Jane");
    assert.equal(rows[0].lastName, "Doe");
    assert.deepEqual(rows[0].teams, ["Ops"]);
    assert.equal(rows[0].title, "Teller");
  });

  test("splits a multi-team cell on semicolons, not commas", () => {
    const { rows } = readSeedRows(
      table(
        'First,Last,Email,Team\n' +
          'Jane,Doe,jane@bank.com,"Leadership; Ops"\n' +
          'Ann,Roe,ann@bank.com,"Lending, Retail"\n',
      ),
    );
    assert.deepEqual(rows[0].teams, ["Leadership", "Ops"]);
    // A comma inside a team name stays part of that one name.
    assert.deepEqual(rows[1].teams, ["Lending, Retail"]);
  });

  test("reports rows with no or invalid email instead of throwing", () => {
    const { rows, issues } = readSeedRows(
      table(
        "First,Last,Email,Team\n" +
          "Jane,Doe,,Ops\n" +
          "Ann,Roe,not-an-email,Ops\n" +
          "Bob,Loe,bob@bank.com,Ops\n",
      ),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, "bob@bank.com");
    assert.equal(issues.length, 2);
    assert.equal(issues[0].line, 1);
    assert.match(issues[0].reason, /No email address/);
    assert.equal(issues[1].line, 2);
    assert.match(issues[1].reason, /not a valid email/);
  });

  test("falls back to the address when a row has an email but no name", () => {
    const { rows } = readSeedRows(
      table("First,Last,Email,Team\n,,casey.nolan@bank.com,Ops\n"),
    );
    assert.equal(rows[0].firstName, "Casey");
    assert.equal(rows[0].lastName, "Nolan");
  });

  test("dedupes repeated team names within one cell", () => {
    const { rows } = readSeedRows(
      table('First,Last,Email,Team\nJane,Doe,jane@bank.com,"Ops; ops"\n'),
    );
    assert.deepEqual(rows[0].teams, ["Ops"]);
  });
});

describe("hasSeedColumns", () => {
  test("accepts a people file and rejects a rocks export", () => {
    assert.equal(hasSeedColumns(table("First,Last,Email,Team\na,b,c@d.com,e\n")), true);
    assert.equal(hasSeedColumns(table("Title,Owner,Due Date\nShip it,Jane,2026-01-01\n")), false);
  });
});

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

describe("buildSeedPlan", () => {
  const rows = (csv: string) => readSeedRows(table(csv)).rows;

  test("merges a person's rows and unions their teams", () => {
    const plan = buildSeedPlan(
      rows(
        "First,Last,Email,Team\n" +
          "Jane,Doe,jane@bank.com,Leadership\n" +
          "Jane,Doe,jane@bank.com,Ops\n",
      ),
      [],
    );
    assert.equal(plan.people.length, 1);
    assert.deepEqual(plan.people[0].teams, ["Leadership", "Ops"]);
    assert.deepEqual(plan.people[0].lines, [1, 2]);
  });

  test("matches an existing team by name, ignoring case and punctuation", () => {
    const plan = buildSeedPlan(
      rows("First,Last,Email,Team\nJane,Doe,jane@bank.com,leadership team\n"),
      [{ id: "team-1", name: "Leadership Team" }],
    );
    assert.equal(plan.teams[0].action, "match");
    assert.equal(plan.teams[0].teamId, "team-1");
  });

  test("plans a create for a team the org does not have", () => {
    const plan = buildSeedPlan(
      rows("First,Last,Email,Team\nJane,Doe,jane@bank.com,Lending\n"),
      [{ id: "team-1", name: "Leadership" }],
    );
    assert.equal(plan.teams[0].action, "create");
    assert.equal(plan.teams[0].teamId, null);
  });

  test("keeps the first name for an address and reports the disagreement", () => {
    const plan = buildSeedPlan(
      rows(
        "First,Last,Email,Team\n" +
          "Jane,Doe,jane@bank.com,Ops\n" +
          "Janet,Doe,jane@bank.com,Lending\n",
      ),
      [],
    );
    assert.equal(plan.people[0].firstName, "Jane");
    assert.equal(plan.issues.length, 1);
    assert.match(plan.issues[0].reason, /Two names for one address/);
  });

  test("fills a blank field from a later row without overwriting a set one", () => {
    const plan = buildSeedPlan(
      rows(
        "First,Last,Email,Team,Job Title\n" +
          "Jane,Doe,jane@bank.com,Ops,\n" +
          "Jane,Doe,jane@bank.com,Lending,Teller\n",
      ),
      [],
    );
    assert.equal(plan.people[0].title, "Teller");
  });

  test("admin on any one of a person's rows makes them admin", () => {
    const plan = buildSeedPlan(
      rows(
        "First,Last,Email,Team,Role access\n" +
          "Jane,Doe,jane@bank.com,Ops,Member\n" +
          "Jane,Doe,jane@bank.com,Leadership,Admin\n",
      ),
      [],
    );
    assert.equal(plan.people.length, 1);
    assert.equal(plan.people[0].orgAdmin, true);
  });
});

// ---------------------------------------------------------------------------
// Role access
// ---------------------------------------------------------------------------

describe("readAccess", () => {
  test("only admin grants, in any casing or wording", () => {
    for (const v of ["Admin", "admin", "ADMIN", "Org Admin", "Administrator"]) {
      assert.deepEqual(readAccess(v), { orgAdmin: true, recognized: true }, v);
    }
  });

  test("blank and member synonyms are plain members", () => {
    for (const v of ["", "  ", "Member", "member", "User", "Standard"]) {
      assert.deepEqual(readAccess(v), { orgAdmin: false, recognized: true }, v);
    }
  });

  test("anything else is a member, but flagged rather than silently flattened", () => {
    assert.deepEqual(readAccess("Owner"), { orgAdmin: false, recognized: false });
    assert.deepEqual(readAccess("Leader"), { orgAdmin: false, recognized: false });
  });
});

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/**
 * Auth fake: accounts exist only once created, uids derived from the email.
 * `existing` maps email → uid; `claims` seeds custom claims by uid.
 */
function fakeAuth(
  existing: Record<string, string> = {},
  claims: Record<string, Record<string, unknown>> = {},
) {
  const byEmail = new Map(Object.entries(existing));
  const claimsByUid = new Map(Object.entries(claims));
  const created: string[] = [];
  const auth: SeedAuth = {
    async getUserByEmail(email) {
      const uid = byEmail.get(email);
      if (!uid) throw new Error("auth/user-not-found");
      return { uid, customClaims: claimsByUid.get(uid) ?? null };
    },
    async createUser({ email }) {
      const uid = `uid-${email.split("@")[0]}`;
      byEmail.set(email, uid);
      created.push(email);
      return { uid };
    },
    async setCustomUserClaims(uid, next) {
      if (next) claimsByUid.set(uid, next);
      else claimsByUid.delete(uid);
    },
  };
  return { auth, created, byEmail, claimsByUid };
}

// The client's actual header row, tab-separated as it comes out of Sheets.
const SEED_CSV =
  "First Name\tLast Name\tTeam\tRole access\tEmail\n" +
  "Jane\tDoe\tLeadership\tAdmin\tjane@bank.com\n" +
  "Ann\tRoe\tLeadership\tMember\tann@bank.com\n" +
  "Bob\tLoe\tLending\t\tbob@bank.com\n";

describe("runUserImport", () => {
  test("a dry run previews every person and writes nothing", async () => {
    const db = new FakeFirestore();
    const { auth, created } = fakeAuth();

    const report = await runUserImport(db.asFirestore(), auth, table(SEED_CSV));

    assert.equal(report.dryRun, true);
    assert.equal(created.length, 0, "no Auth account is created by a dry run");
    assert.equal(db.docsIn("users").length, 0);
    assert.equal(db.docsIn("teams").length, 0);
    assert.equal(db.docsIn("team_members").length, 0);

    // …but it still shows what would land: 3 people × 1 team each.
    assert.equal(report.people.authCreated, 3);
    assert.equal(report.teams.created, 2);
    assert.equal(report.memberships.created, 3);
    assert.equal(report.rows.length, 3);
    assert.deepEqual(
      report.rows.map((r) => `${r.name} → ${r.team}`).sort(),
      ["Ann Roe → Leadership", "Bob Loe → Lending", "Jane Doe → Leadership"],
    );
  });

  test("apply creates the teams, the accounts, the profiles and the rosters", async () => {
    const db = new FakeFirestore();
    const { auth, created } = fakeAuth();

    const report = await runUserImport(db.asFirestore(), auth, table(SEED_CSV), {
      dryRun: false,
    });

    assert.deepEqual(created.sort(), [
      "ann@bank.com",
      "bob@bank.com",
      "jane@bank.com",
    ]);
    assert.equal(db.docsIn("teams").length, 2);
    assert.equal(db.docsIn("users").length, 3);
    assert.equal(db.docsIn("team_members").length, 3);
    assert.equal(report.teams.created, 2);
    assert.equal(report.memberships.created, 3);

    const jane = db.raw("users/uid-jane");
    assert.equal(jane?.display_name, "Jane Doe");
    assert.equal(jane?.email, "jane@bank.com");

    // Role access never becomes a *team* role — admin or not, every seeded
    // membership is a plain member. Leadership stays a manual promotion.
    for (const m of db.docsIn("team_members")) {
      assert.equal(m.data.role, "member");
    }
    assert.deepEqual(report.orgAdmins.granted, ["jane@bank.com"]);
  });

  test("re-applying the same file changes nothing and keeps a promoted leader", async () => {
    const db = new FakeFirestore();
    const { auth } = fakeAuth();

    await runUserImport(db.asFirestore(), auth, table(SEED_CSV), { dryRun: false });

    // The admin promotes Jane after the first seed, as the role column can't.
    const janeMembership = db
      .docsIn("team_members")
      .find((m) => m.data.user_id === "uid-jane")!;
    db.seed("team_members", janeMembership.id, {
      ...janeMembership.data,
      role: "leader",
    });

    const second = await runUserImport(db.asFirestore(), auth, table(SEED_CSV), {
      dryRun: false,
    });

    assert.equal(second.teams.created, 0, "teams match by name on re-run");
    assert.equal(second.teams.matched, 2);
    assert.equal(second.memberships.created, 0);
    assert.equal(second.memberships.existing, 3);
    assert.equal(db.docsIn("team_members").length, 3);
    assert.equal(
      db.raw(`team_members/${janeMembership.id}`)?.role,
      "leader",
      "a re-seed must not demote a leader",
    );
  });

  test("reuses an existing Auth account rather than creating a second one", async () => {
    const db = new FakeFirestore();
    const { auth, created } = fakeAuth({ "jane@bank.com": "google-uid-jane" });

    const report = await runUserImport(db.asFirestore(), auth, table(SEED_CSV), {
      dryRun: false,
    });

    assert.equal(created.includes("jane@bank.com"), false);
    assert.equal(report.people.authExisting, 1);
    assert.equal(report.people.authCreated, 2);
    assert.ok(db.raw("users/google-uid-jane"), "profile is keyed to the real uid");
  });

  test("skips addresses the sign-in allowlist would reject", async () => {
    const db = new FakeFirestore();
    const { auth, created } = fakeAuth();

    const report = await runUserImport(
      db.asFirestore(),
      auth,
      table(
        "First,Last,Email,Team\n" +
          "Jane,Doe,jane@bank.com,Ops\n" +
          "Mal,Ory,mal@elsewhere.com,Ops\n",
      ),
      { dryRun: false, allowlist: parseAllowlist("@bank.com") },
    );

    assert.deepEqual(created, ["jane@bank.com"]);
    assert.equal(report.issues.length, 1);
    assert.match(report.issues[0].reason, /allowlist/);
  });

  test("reports who is on a team in the app but absent from the file", async () => {
    const db = new FakeFirestore();
    db.seed("teams", "team-1", { name: "Leadership" });
    db.seed("team_members", "team-1__old-uid", {
      team_id: "team-1",
      user_id: "old-uid",
      role: "leader",
    });
    db.seed("users", "old-uid", { display_name: "Pat Prior" });
    const { auth } = fakeAuth();

    const report = await runUserImport(
      db.asFirestore(),
      auth,
      table("First,Last,Email,Team\nJane,Doe,jane@bank.com,Leadership\n"),
      { dryRun: false },
    );

    assert.deepEqual(report.notInFile, [
      { team: "Leadership", names: ["Pat Prior"] },
    ]);
    // Additive: Pat keeps the membership the file no longer mentions.
    assert.ok(db.raw("team_members/team-1__old-uid"));
    // And the team already had a leader, so it isn't flagged.
    assert.deepEqual(report.leaderless, []);
  });

  test("flags teams the import creates as leaderless", async () => {
    const db = new FakeFirestore();
    const { auth } = fakeAuth();

    const report = await runUserImport(db.asFirestore(), auth, table(SEED_CSV), {
      dryRun: false,
    });

    assert.deepEqual(report.leaderless.sort(), ["Leadership", "Lending"]);
  });

  test("grants the org-admin claim only to the rows marked Admin", async () => {
    const db = new FakeFirestore();
    const { auth, claimsByUid } = fakeAuth();

    const report = await runUserImport(db.asFirestore(), auth, table(SEED_CSV), {
      dryRun: false,
    });

    assert.deepEqual(report.orgAdmins.granted, ["jane@bank.com"]);
    assert.deepEqual(claimsByUid.get("uid-jane"), { role: "admin" });
    assert.equal(claimsByUid.has("uid-ann"), false, "Member row gets no claim");
    assert.equal(claimsByUid.has("uid-bob"), false, "blank row gets no claim");
  });

  test("a dry run reports the grant without setting any claim", async () => {
    const db = new FakeFirestore();
    const { auth, claimsByUid } = fakeAuth();

    const report = await runUserImport(db.asFirestore(), auth, table(SEED_CSV));

    assert.deepEqual(report.orgAdmins.granted, ["jane@bank.com"]);
    assert.equal(claimsByUid.size, 0);
    assert.equal(
      report.rows.find((r) => r.email === "jane@bank.com")?.orgAdmin,
      true,
    );
  });

  test("keeps other custom claims on the account when granting", async () => {
    const db = new FakeFirestore();
    const { auth, claimsByUid } = fakeAuth(
      { "jane@bank.com": "google-uid-jane" },
      { "google-uid-jane": { some_other_claim: 7 } },
    );

    await runUserImport(db.asFirestore(), auth, table(SEED_CSV), {
      dryRun: false,
    });

    assert.deepEqual(claimsByUid.get("google-uid-jane"), {
      some_other_claim: 7,
      role: "admin",
    });
  });

  test("an already-admin row is reported as unchanged, not re-granted", async () => {
    const db = new FakeFirestore();
    const { auth } = fakeAuth(
      { "jane@bank.com": "google-uid-jane" },
      { "google-uid-jane": { role: "admin" } },
    );

    const report = await runUserImport(db.asFirestore(), auth, table(SEED_CSV), {
      dryRun: false,
    });

    assert.deepEqual(report.orgAdmins.granted, []);
    assert.deepEqual(report.orgAdmins.unchanged, ["jane@bank.com"]);
  });

  test("never revokes admin from someone the file calls a member", async () => {
    const db = new FakeFirestore();
    const { auth, claimsByUid } = fakeAuth(
      { "ann@bank.com": "google-uid-ann" },
      { "google-uid-ann": { role: "admin" } },
    );

    const report = await runUserImport(db.asFirestore(), auth, table(SEED_CSV), {
      dryRun: false,
    });

    assert.deepEqual(report.orgAdmins.notRevoked, ["ann@bank.com"]);
    assert.deepEqual(
      claimsByUid.get("google-uid-ann"),
      { role: "admin" },
      "the claim is left exactly as it was",
    );
  });

  test("reports Role access values it did not recognize", async () => {
    const db = new FakeFirestore();
    const { auth, claimsByUid } = fakeAuth();

    const report = await runUserImport(
      db.asFirestore(),
      auth,
      table(
        "First Name,Last Name,Team,Role access,Email\n" +
          "Jane,Doe,Ops,Owner,jane@bank.com\n",
      ),
      { dryRun: false },
    );

    assert.deepEqual(report.unrecognizedAccess, ["Owner"]);
    assert.equal(claimsByUid.size, 0, "an unrecognized value grants nothing");
  });

  test("rejects a file that isn't a people seed at all", async () => {
    const db = new FakeFirestore();
    const { auth } = fakeAuth();

    await assert.rejects(
      () =>
        runUserImport(
          db.asFirestore(),
          auth,
          table("Title,Owner,Due Date\nShip it,Jane,2026-01-01\n"),
        ),
      /people seed needs/,
    );
  });

  test("a person with no team gets a profile and no roster row", async () => {
    const db = new FakeFirestore();
    const { auth } = fakeAuth();

    const report = await runUserImport(
      db.asFirestore(),
      auth,
      table("First,Last,Email,Team\nJane,Doe,jane@bank.com,\n"),
      { dryRun: false },
    );

    assert.equal(db.docsIn("users").length, 1);
    assert.equal(db.docsIn("team_members").length, 0);
    assert.equal(report.rows[0].team, "—");
    assert.match(report.rows[0].note ?? "", /No team in the file/);
  });
});
