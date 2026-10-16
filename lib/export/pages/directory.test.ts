import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { NO_TEAM } from "@/lib/directory-filter";
import type { DirectoryPerson } from "@/lib/firebase/directory";
import { isRefusal } from "../types";
import { directoryExportParams, exportUrls } from "../urls";
import {
  DIRECTORY_COLUMNS,
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
