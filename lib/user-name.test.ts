import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { userDisplayName, ownerLabel, NO_OWNER_LABEL } from "./user-name";

describe("userDisplayName", () => {
  test("prefers display_name", () => {
    assert.equal(
      userDisplayName({
        display_name: "Joe Ramirez",
        first_name: "Joseph",
        last_name: "Ramirez",
        email: "joe@highplainsbank.com",
      }),
      "Joe Ramirez",
    );
  });

  test("falls back to first + last", () => {
    assert.equal(
      userDisplayName({ first_name: "Joe", last_name: "Ramirez" }),
      "Joe Ramirez",
    );
  });

  test("uses whichever name part exists", () => {
    assert.equal(userDisplayName({ first_name: "Joe" }), "Joe");
    assert.equal(userDisplayName({ last_name: "Ramirez" }), "Ramirez");
  });

  test("falls back to email last", () => {
    assert.equal(
      userDisplayName({ email: "joe@highplainsbank.com" }),
      "joe@highplainsbank.com",
    );
  });

  // The N4 regression: user docs have no `full_name`, so a shared-rock owner
  // resolved to "" and the section rendered "Shared by —".
  test("ignores a stray full_name field and reports empty", () => {
    assert.equal(userDisplayName({ full_name: "Joe Ramirez" } as never), "");
  });

  test("empty for missing / blank docs", () => {
    assert.equal(userDisplayName(undefined), "");
    assert.equal(userDisplayName(null), "");
    assert.equal(userDisplayName({}), "");
    assert.equal(userDisplayName({ display_name: "   " }), "");
  });

  test("trims whitespace", () => {
    assert.equal(
      userDisplayName({ first_name: "  Joe ", last_name: " Ramirez  " }),
      "Joe Ramirez",
    );
  });

  test("ignores non-string values", () => {
    assert.equal(userDisplayName({ display_name: 42, email: "j@h.com" }), "j@h.com");
  });
});

// An imported row can legitimately have no owner (a departed employee), and a
// department rock carries shared ownership. That is a state, not missing data.

describe("ownerLabel", () => {
  const roster: Record<string, string> = { steph: "Stephanie Benes" };
  const nameOf = (id: string) => roster[id];

  test("resolves a member", () => {
    assert.equal(ownerLabel("steph", nameOf), "Stephanie Benes");
  });

  test("null / undefined / empty owner reads as No Owner", () => {
    assert.equal(ownerLabel(null, nameOf), NO_OWNER_LABEL);
    assert.equal(ownerLabel(undefined, nameOf), NO_OWNER_LABEL);
    assert.equal(ownerLabel("", nameOf), NO_OWNER_LABEL);
  });

  // An id that no longer matches the roster IS unresolved — keep it distinct
  // from a deliberately unassigned row.
  test("an unknown id stays a dash", () => {
    assert.equal(ownerLabel("ghost", nameOf), "—");
  });

  test("a blank stored name is treated as unresolved, not as No Owner", () => {
    assert.equal(ownerLabel("blank", () => "   "), "—");
  });
});
