import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  OWNER_FILTER_ALL,
  ownerFilterOptions,
  ownerFilterQuery,
  resolveOwnerFilter,
} from "./owner-filter";

const members = [
  { user_id: "u-zed", full_name: "Zed Young" },
  { user_id: "u-ann", full_name: "Ann Archer" },
  { user_id: "u-me", full_name: "Mia Moss" },
];

describe("resolveOwnerFilter", () => {
  test("absent or empty means all", () => {
    assert.equal(resolveOwnerFilter(null, members, "u-me"), OWNER_FILTER_ALL);
    assert.equal(resolveOwnerFilter(undefined, members, "u-me"), OWNER_FILTER_ALL);
    assert.equal(resolveOwnerFilter("", members, "u-me"), OWNER_FILTER_ALL);
    assert.equal(resolveOwnerFilter("all", members, "u-me"), OWNER_FILTER_ALL);
  });

  test("a member id is kept", () => {
    assert.equal(resolveOwnerFilter("u-ann", members, "u-me"), "u-ann");
  });

  test("legacy self/mine map to the signed-in user", () => {
    assert.equal(resolveOwnerFilter("self", members, "u-me"), "u-me");
    assert.equal(resolveOwnerFilter("mine", members, "u-me"), "u-me");
  });

  test("legacy self falls back to all when the viewer isn't a member", () => {
    assert.equal(resolveOwnerFilter("self", members, "u-outsider"), OWNER_FILTER_ALL);
  });

  test("unknown values (legacy team/others, departed members) fall back to all", () => {
    assert.equal(resolveOwnerFilter("team", members, "u-me"), OWNER_FILTER_ALL);
    assert.equal(resolveOwnerFilter("others", members, "u-me"), OWNER_FILTER_ALL);
    assert.equal(resolveOwnerFilter("u-gone", members, "u-me"), OWNER_FILTER_ALL);
  });
});

describe("ownerFilterOptions", () => {
  test("All owners first, then members by name, viewer marked", () => {
    assert.deepEqual(ownerFilterOptions(members, "u-me"), [
      { value: "all", label: "All owners" },
      { value: "u-ann", label: "Ann Archer" },
      { value: "u-me", label: "Mia Moss (you)" },
      { value: "u-zed", label: "Zed Young" },
    ]);
  });

  test("does not reorder the caller's array", () => {
    const input = [...members];
    ownerFilterOptions(input, "u-me");
    assert.deepEqual(input, members);
  });

  test("no members still offers All owners", () => {
    assert.deepEqual(ownerFilterOptions([], "u-me"), [{ value: "all", label: "All owners" }]);
  });
});

describe("ownerFilterQuery", () => {
  test("sets owner and keeps the other params", () => {
    assert.equal(ownerFilterQuery("view=archived", "u-ann"), "view=archived&owner=u-ann");
  });

  test("replaces an existing owner", () => {
    assert.equal(ownerFilterQuery("owner=u-zed&view=archived", "u-ann"), "owner=u-ann&view=archived");
  });

  test("all drops the param", () => {
    assert.equal(ownerFilterQuery("owner=u-zed&view=archived", "all"), "view=archived");
    assert.equal(ownerFilterQuery("owner=self", "all"), "");
  });
});
