import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  initialOwnerScope,
  ownerPickerRows,
  UNASSIGNED_ROW_KEY,
  type OrgPerson,
  type OwnerPickerTeam,
} from "./owner-picker";

const team: OwnerPickerTeam = {
  id: "t1",
  name: "Leadership",
  people: [
    { user_id: "ann", full_name: "Ann Lee" },
    { user_id: "bob", full_name: "Bob Ray" },
  ],
};

const orgPeople: OrgPerson[] = [
  { user_id: "ann", full_name: "Ann Lee", team_ids: ["t1"] },
  { user_id: "cy", full_name: "Cy Moss", team_ids: ["t2", "t3"] },
  { user_id: "dee", full_name: "Dee Fox", team_ids: ["gone"] },
];

const teamNameById = new Map([
  ["t1", "Leadership"],
  ["t2", "Sales"],
  ["t3", "Ops"],
]);

const base = { team, orgPeople, teamNameById, query: "" };

describe("initialOwnerScope", () => {
  test("no owner opens on the team tab", () => {
    assert.equal(initialOwnerScope(team, ""), "team");
  });
  test("a team member opens on the team tab", () => {
    assert.equal(initialOwnerScope(team, "bob"), "team");
  });
  test("an owner off the team opens org-wide", () => {
    assert.equal(initialOwnerScope(team, "cy"), "org");
  });
});

describe("ownerPickerRows — team scope", () => {
  test("lists the team's people with no detail", () => {
    assert.deepEqual(ownerPickerRows({ ...base, scope: "team" }), [
      { key: "ann", id: "ann", name: "Ann Lee" },
      { key: "bob", id: "bob", name: "Bob Ray" },
    ]);
  });
  test("search matches names, case- and space-insensitive", () => {
    const rows = ownerPickerRows({ ...base, scope: "team", query: "  RAY " });
    assert.deepEqual(rows.map((r) => r.id), ["bob"]);
  });
  test("search does not match the team name", () => {
    const rows = ownerPickerRows({ ...base, scope: "team", query: "leader" });
    assert.deepEqual(rows, []);
  });
});

describe("ownerPickerRows — org scope", () => {
  test("empty until the org loads", () => {
    assert.deepEqual(
      ownerPickerRows({ ...base, scope: "org", orgPeople: null }),
      [],
    );
  });
  test("shows each person's teams; unknown ids read as Team", () => {
    const rows = ownerPickerRows({ ...base, scope: "org" });
    assert.deepEqual(
      rows.map((r) => [r.id, r.detail]),
      [
        ["ann", "Leadership"],
        ["cy", "Sales, Ops"],
        ["dee", "Team"],
      ],
    );
  });
  test("search matches a name or a team name", () => {
    assert.deepEqual(
      ownerPickerRows({ ...base, scope: "org", query: "ops" }).map((r) => r.id),
      ["cy"],
    );
    assert.deepEqual(
      ownerPickerRows({ ...base, scope: "org", query: "fox" }).map((r) => r.id),
      ["dee"],
    );
  });
});

describe("ownerPickerRows — Unassigned row", () => {
  test("absent unless a label is given", () => {
    for (const scope of ["team", "org"] as const) {
      const rows = ownerPickerRows({ ...base, scope });
      assert.ok(rows.every((r) => !r.unassigned));
    }
  });
  test("comes first in either scope and yields an empty id", () => {
    for (const scope of ["team", "org"] as const) {
      const [first] = ownerPickerRows({
        ...base,
        scope,
        unassignedLabel: "Unassigned",
      });
      assert.deepEqual(first, {
        key: UNASSIGNED_ROW_KEY,
        id: "",
        name: "Unassigned",
        unassigned: true,
      });
    }
  });
  test("shown while the org is still loading", () => {
    const rows = ownerPickerRows({
      ...base,
      scope: "org",
      orgPeople: null,
      unassignedLabel: "Unassigned",
    });
    assert.deepEqual(rows.map((r) => r.key), [UNASSIGNED_ROW_KEY]);
  });
  test("dropped by a search that doesn't match its label", () => {
    const rows = ownerPickerRows({
      ...base,
      scope: "team",
      query: "ann",
      unassignedLabel: "Unassigned",
    });
    assert.deepEqual(rows.map((r) => r.id), ["ann"]);
  });
  test("kept by a search that matches its label", () => {
    const rows = ownerPickerRows({
      ...base,
      scope: "team",
      query: "unass",
      unassignedLabel: "Unassigned",
    });
    assert.deepEqual(rows.map((r) => r.key), [UNASSIGNED_ROW_KEY]);
  });
  test("uses the caller's label", () => {
    const [first] = ownerPickerRows({
      ...base,
      scope: "team",
      unassignedLabel: "No owner",
    });
    assert.equal(first.name, "No owner");
  });
});
