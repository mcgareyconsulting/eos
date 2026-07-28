import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parsePerson } from "./create-accounts";

// Addresses get pasted straight out of an email client, so the trailing
// commas, quoted display names, and angle brackets all have to survive.

describe("parsePerson", () => {
  test("reads `Full Name <email>`", () => {
    assert.deepEqual(parsePerson("Cora Ravenkamp <cora.ravenkamp@highplainsbank.com>"), {
      name: "Cora Ravenkamp",
      email: "cora.ravenkamp@highplainsbank.com",
    });
  });

  test("tolerates the trailing comma from a pasted recipient list", () => {
    assert.deepEqual(parsePerson("Jessica Teichman <jessica.teichman@highplainsbank.com>,"), {
      name: "Jessica Teichman",
      email: "jessica.teichman@highplainsbank.com",
    });
  });

  test("strips quotes around a display name", () => {
    assert.deepEqual(parsePerson('"Benes, Stephanie" <stephanie.benes@highplainsbank.com>'), {
      name: "Benes, Stephanie",
      email: "stephanie.benes@highplainsbank.com",
    });
  });

  test("accepts a bare address", () => {
    assert.deepEqual(parsePerson("joe.creighton@highplainsbank.com"), {
      name: null,
      email: "joe.creighton@highplainsbank.com",
    });
  });

  test("lowercases the address but preserves the name's case", () => {
    assert.deepEqual(parsePerson("Steph Benes <Stephanie.Benes@HighPlainsBank.com>"), {
      name: "Steph Benes",
      email: "stephanie.benes@highplainsbank.com",
    });
  });

  test("rejects anything without an address", () => {
    assert.equal(parsePerson("Cora Ravenkamp"), null);
    assert.equal(parsePerson(""), null);
    assert.equal(parsePerson("   "), null);
  });
});
