import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Auth, UserRecord } from "firebase-admin/auth";
import { NO_TEAM } from "@/lib/directory-filter";
import type { DirectoryPerson } from "@/lib/firebase/directory";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { adminExportDeps } from "@/lib/test-support/export-deps";
import { NOT_ADMIN, runExport } from "../run";
import { isRefusal, type ExportDefinition } from "../types";
import { directoryExportParams, exportUrls } from "../urls";
import {
  DIRECTORY_COLUMNS,
  directoryExportWith,
  directoryViewRows,
  parseDirectoryParams,
  type DirectoryExportParams,
} from "./directory";

function person(uid: string, over: Partial<DirectoryPerson> = {}): DirectoryPerson {
  return {
    uid,
    firstName: uid,
    lastName: "Smith",
    email: `${uid}@highplainsbank.com`,
    teams: [],
    access: "member",
    hasAuth: true,
    hasSignedIn: true,
    ...over,
  };
}

const people = [
  person("ada", { teams: [{ id: "t1", name: "Leadership", role: "leader" }], access: "leader" }),
  person("grace", {
    teams: [
      { id: "t1", name: "Leadership", role: "member" },
      { id: "t2", name: "Finance", role: "member" },
    ],
  }),
  person("root", { access: "admin", teams: [{ id: "t2", name: "Finance", role: "member" }] }),
  person("floater", { hasAuth: false, hasSignedIn: false }),
  person("gone", { deactivated: true }),
];

const params = (over: Partial<DirectoryExportParams> = {}): DirectoryExportParams => ({
  query: "",
  access: new Set(),
  teams: new Set(),
  ...over,
});

const cells = (p: DirectoryPerson) => DIRECTORY_COLUMNS.map((c) => c.value(p));

describe("directory export — columns", () => {
  test("column snapshot (a change here changes every auditor file)", () => {
    assert.deepEqual(
      DIRECTORY_COLUMNS.map((c) => [c.key, c.header, c.kind]),
      [
        ["first_name", "First Name", "text"],
        ["last_name", "Last Name", "text"],
        ["teams", "Team", "text"],
        ["access", "Role access", "text"],
        ["email", "Email", "text"],
        ["account", "Account", "text"],
        ["uid", "User ID", "text"],
      ],
    );
  });

  test("cells read as the table: a role per team line, account state, deactivated", () => {
    assert.deepEqual(cells(people[1]).slice(2, 4), [
      "Leadership\nFinance",
      "Leadership: Member\nFinance: Member",
    ]);
    assert.deepEqual(cells(people[2]).slice(3, 4), ["Admin"]);
    assert.deepEqual(cells(people[3]).slice(2, 6), [
      "No team",
      "Member",
      "floater@highplainsbank.com",
      "No account",
    ]);
    assert.equal(cells(people[4])[3], "Deactivated");
  });
});

describe("directory export — the table's view", () => {
  const ids = (p: DirectoryExportParams) => directoryViewRows(people, p).map((x) => x.uid);

  test("no filters: everyone, in the loader's order", () => {
    assert.deepEqual(ids(params()), ["ada", "grace", "root", "floater", "gone"]);
  });

  test("role and team filters are OR within, AND across; No team picks the unrostered", () => {
    assert.deepEqual(ids(params({ access: new Set(["leader", "admin"]) })), ["ada", "root"]);
    assert.deepEqual(ids(params({ teams: new Set(["t2"]) })), ["grace", "root"]);
    assert.deepEqual(ids(params({ teams: new Set([NO_TEAM]) })), ["floater", "gone"]);
    assert.deepEqual(ids(params({ teams: new Set(["t1"]), access: new Set(["member"]) })), [
      "grace",
    ]);
  });

  test("search matches names, email and team names", () => {
    assert.deepEqual(ids(params({ query: "finance" })), ["grace", "root"]);
    assert.deepEqual(ids(params({ query: "ADA@" })), ["ada"]);
  });

  test("params round-trip; junk refused", () => {
    const sent = directoryExportParams({
      query: " smith ",
      access: new Set(["member", "admin"]),
      teams: new Set(["t2", NO_TEAM]),
    });
    const qs = new URL(exportUrls("directory", sent).xlsx, "https://x").searchParams;
    const parsed = parseDirectoryParams(qs);
    assert.ok(!isRefusal(parsed));
    assert.equal(parsed.query, "smith");
    assert.deepEqual([...parsed.access].sort(), ["admin", "member"]);
    assert.deepEqual([...parsed.teams].sort(), [NO_TEAM, "t2"].sort());
    assert.deepEqual(directoryExportParams({ query: "", access: new Set(), teams: new Set() }), {
      q: undefined,
      access: undefined,
      teams: undefined,
    });
    assert.ok(isRefusal(parseDirectoryParams(new URLSearchParams("access=owner"))));
    assert.ok(isRefusal(parseDirectoryParams(new URLSearchParams("teams=../x"))));
  });
});

describe("directory export — through the core", () => {
  function account(
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

  /** Identity Platform, faked: the accounts, and how often they were listed. */
  function fakeAuth(users: UserRecord[]) {
    const calls = { listUsers: 0 };
    const auth = () =>
      ({
        listUsers: async () => {
          calls.listUsers += 1;
          return { users, pageToken: undefined };
        },
      }) as unknown as Auth;
    return { auth, calls };
  }

  function seed() {
    const db = new FakeFirestore();
    db.seed("teams", "t1", { name: "Leadership" });
    db.seed("teams", "t2", { name: "Finance" });
    db.seed("users", "ada", { first_name: "Ada", last_name: "Lovelace", email: "ada@highplainsbank.com" });
    db.seed("users", "bob", { first_name: "Bob", last_name: "Bell", email: "bob@highplainsbank.com" });
    // An import placeholder: a profile, no account yet.
    db.seed("users", "cy", { first_name: "Cy", last_name: "Young", email: "cy@highplainsbank.com" });
    db.seed("team_members", "t1__bob", { team_id: "t1", user_id: "bob", role: "leader" });
    db.seed("team_members", "t2__bob", { team_id: "t2", user_id: "bob", role: "member" });
    db.seed("team_members", "t2__cy", { team_id: "t2", user_id: "cy", role: "member" });
    const ip = fakeAuth([
      account("ada", { admin: true, signedIn: true }),
      account("bob", { signedIn: false }),
    ]);
    const definitions = { directory: directoryExportWith({ auth: ip.auth }) } as unknown as Record<
      string,
      ExportDefinition<never, never>
    >;
    return { db, ip, definitions };
  }

  test("a non-admin is refused before Identity Platform is read; the attempt is audited", async () => {
    const { db, ip, definitions } = seed();
    const deps = adminExportDeps(db, { definitions });
    const admin = deps.user!;
    const res = await runExport("directory", new URLSearchParams(), "xlsx", {
      ...deps,
      user: async () => ({ ...(await admin())!, uid: "bob", isAdmin: false }),
    });
    assert.deepEqual(res, { ok: false, status: 403, message: NOT_ADMIN, reason: "not_admin" });
    assert.equal(ip.calls.listUsers, 0);
    const rows = db.docsIn("audit_log").map((d) => d.data as Record<string, unknown>);
    assert.deepEqual(
      rows.map((r) => [r.outcome, r.reason, r.entity_id, r.actor_uid]),
      [["refused", "not_admin", "directory", "bob"]],
    );
  });

  test("an admin gets the table's columns, the account fields and the filters", async () => {
    const { db, ip, definitions } = seed();
    const res = await runExport(
      "directory",
      new URLSearchParams({ teams: "t2" }),
      "xlsx",
      adminExportDeps(db, { definitions }),
    );
    assert.ok(res.ok);
    assert.equal(ip.calls.listUsers, 1);
    assert.deepEqual(res.table.headers, DIRECTORY_COLUMNS.map((c) => c.header));
    // Finance only, last name first: Bell, Young.
    assert.deepEqual(res.table.rows, [
      [
        "Bob",
        "Bell",
        "Finance\nLeadership",
        "Finance: Member\nLeadership: Leader",
        "bob@highplainsbank.com",
        "Never signed in",
        "bob",
      ],
      ["Cy", "Young", "Finance", "Finance: Member", "cy@highplainsbank.com", "No account", "cy"],
    ]);
    const filters = res.table.provenance.find((l) => l.label === "Filters applied")?.value;
    assert.equal(filters, "Search: (none) · Role: All roles · Team: Finance");
    const audit = db.docsIn("audit_log").map((d) => d.data as Record<string, unknown>);
    assert.deepEqual(
      audit.map((r) => [r.outcome, r.entity_id, r.team_id]),
      [["ok", "directory", null]],
    );
  });
});
