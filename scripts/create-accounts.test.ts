import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parsePerson } from "./create-accounts";

// Addresses get pasted straight out of an email client, so the trailing
// commas, quoted display names, and angle brackets all have to survive.

describe("parsePerson", () => {
  test("reads `Full Name <email>`", () => {
    assert.deepEqual(parsePerson("Casey Nolan <casey.nolan@highplainsbank.com>"), {
      name: "Casey Nolan",
      email: "casey.nolan@highplainsbank.com",
    });
  });

  test("tolerates the trailing comma from a pasted recipient list", () => {
    assert.deepEqual(parsePerson("Jamie Torres <jamie.torres@highplainsbank.com>,"), {
      name: "Jamie Torres",
      email: "jamie.torres@highplainsbank.com",
    });
  });

  test("strips quotes around a display name", () => {
    assert.deepEqual(parsePerson('"Reyes, Samantha" <samantha.reyes@highplainsbank.com>'), {
      name: "Reyes, Samantha",
      email: "samantha.reyes@highplainsbank.com",
    });
  });

  test("accepts a bare address", () => {
    assert.deepEqual(parsePerson("jordan.ellis@highplainsbank.com"), {
      name: null,
      email: "jordan.ellis@highplainsbank.com",
    });
  });

  test("lowercases the address but preserves the name's case", () => {
    assert.deepEqual(parsePerson("Sam Reyes <Samantha.Reyes@HighPlainsBank.com>"), {
      name: "Sam Reyes",
      email: "samantha.reyes@highplainsbank.com",
    });
  });

  test("rejects anything without an address", () => {
    assert.equal(parsePerson("Casey Nolan"), null);
    assert.equal(parsePerson(""), null);
    assert.equal(parsePerson("   "), null);
  });
});
