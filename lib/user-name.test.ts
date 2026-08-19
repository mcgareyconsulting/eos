import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { userDisplayName } from "./user-name";

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
