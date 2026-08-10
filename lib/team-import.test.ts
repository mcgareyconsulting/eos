import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeHeadlineKind } from "./team-import";

// Pins the Type/sheet-name → headline kind mapping so a client export keeps
// landing on the right kind as the app's headline kinds evolve.

describe("normalizeHeadlineKind", () => {
  test("maps cascading variants", () => {
    assert.equal(normalizeHeadlineKind("Cascading"), "cascading");
    assert.equal(normalizeHeadlineKind("cascaded"), "cascading");
  });

  test("maps customer variants", () => {
    assert.equal(normalizeHeadlineKind("Customer"), "customer");
    assert.equal(normalizeHeadlineKind("Client"), "customer");
    assert.equal(normalizeHeadlineKind("Win"), "customer");
  });

  test("maps employee variants", () => {
    assert.equal(normalizeHeadlineKind("Employee"), "employee");
    assert.equal(normalizeHeadlineKind("HR"), "employee");
    assert.equal(normalizeHeadlineKind("Staff"), "employee");
  });

  test("maps general/FYI variants, case- and whitespace-insensitive", () => {
    assert.equal(normalizeHeadlineKind("general"), "general");
    assert.equal(normalizeHeadlineKind("General"), "general");
    assert.equal(normalizeHeadlineKind("FYI"), "general");
    assert.equal(normalizeHeadlineKind("fyi"), "general");
    assert.equal(normalizeHeadlineKind("General / FYI"), "general");
    assert.equal(normalizeHeadlineKind("general/fyi"), "general");
    assert.equal(normalizeHeadlineKind("  General / FYI  "), "general");
  });

  test("falls back to employee for unrecognized values", () => {
    assert.equal(normalizeHeadlineKind(""), "employee");
    assert.equal(normalizeHeadlineKind("Something else"), "employee");
  });

  test("also reads the sheet name (multi-sheet xlsx with a blank Type column)", () => {
    assert.equal(normalizeHeadlineKind("", "General / FYI"), "general");
    assert.equal(normalizeHeadlineKind("", "Cascading Messages"), "cascading");
  });
});
