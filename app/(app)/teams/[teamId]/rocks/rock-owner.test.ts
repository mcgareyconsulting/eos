import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { initialRockOwner, personOwnerId, rockOwnerChoices } from "./rock-owner";

const members = [
  { user_id: "ann", full_name: "Ann Lee" },
  { user_id: "bob", full_name: "Bob Ray" },
];
const roster = new Set(members.map((m) => m.user_id));

describe("personOwnerId", () => {
  test("a person id is kept", () => {
    assert.equal(personOwnerId("bob", "ann"), "bob");
  });
  test("none or legacy 'team' falls back", () => {
    assert.equal(personOwnerId(undefined, "ann"), "ann");
    assert.equal(personOwnerId(null, "ann"), "ann");
    assert.equal(personOwnerId("", "ann"), "ann");
    assert.equal(personOwnerId("team", "ann"), "ann");
  });
});

describe("initialRockOwner", () => {
  test("new rock opens on the current user when rostered", () => {
    assert.equal(initialRockOwner(undefined, "ann", roster), "ann");
  });
  test("new rock opens empty for a user off the roster", () => {
    assert.equal(initialRockOwner(undefined, "admin", roster), "");
  });
  test("a stored owner is kept, even off the roster", () => {
    assert.equal(initialRockOwner("bob", "ann", roster), "bob");
    assert.equal(initialRockOwner("gone", "ann", roster), "gone");
  });
  test("legacy 'team' owner falls back like a new rock", () => {
    assert.equal(initialRockOwner("team", "ann", roster), "ann");
    assert.equal(initialRockOwner("team", "admin", roster), "");
  });
});

describe("rockOwnerChoices", () => {
  test("the roster only, for a new rock or a rostered owner", () => {
    assert.deepEqual(rockOwnerChoices(members, undefined, "x"), members);
    assert.deepEqual(rockOwnerChoices(members, "bob", "Bob Ray"), members);
  });
  test("a stored owner who left the team is added last, marked", () => {
    assert.deepEqual(rockOwnerChoices(members, "gone", "Cy Moss"), [
      ...members,
      { user_id: "gone", full_name: "Cy Moss (no longer on this team)" },
    ]);
  });
  test("legacy 'team' is never listed", () => {
    assert.deepEqual(rockOwnerChoices(members, "team", "x"), members);
  });
  test("does not mutate the roster", () => {
    const copy = [...members];
    rockOwnerChoices(members, "gone", "Cy");
    assert.deepEqual(members, copy);
  });
});
