import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasFocusMarker,
  isWeeklyFocus,
  migrateFocusMarker,
  stripFocusMarker,
} from "./weekly-focus";

describe("hasFocusMarker", () => {
  it("matches both spellings live in client data", () => {
    // Both seen on the ES team 2026-09-04.
    assert.equal(hasFocusMarker("** Finish first draft of CreditLens report"), true);
    assert.equal(hasFocusMarker("**Compile list of items for post-conversion"), true);
  });

  it("ignores a mid-title ** (emphasis, not a marker)", () => {
    assert.equal(hasFocusMarker("Ship the **new** portal"), false);
  });

  it("is false for plain titles and non-strings", () => {
    assert.equal(hasFocusMarker("Procedures for Assets"), false);
    assert.equal(hasFocusMarker(null), false);
    assert.equal(hasFocusMarker(undefined), false);
  });
});

describe("stripFocusMarker", () => {
  it("removes the marker and surrounding space, both spellings", () => {
    assert.equal(stripFocusMarker("** Finish first draft"), "Finish first draft");
    assert.equal(stripFocusMarker("**Compile list"), "Compile list");
  });

  it("leaves an unmarked title alone (safe over every row)", () => {
    assert.equal(stripFocusMarker("Procedures for Assets"), "Procedures for Assets");
  });

  it("does not eat a mid-title **", () => {
    assert.equal(stripFocusMarker("Ship the **new** portal"), "Ship the **new** portal");
  });
});

describe("migrateFocusMarker", () => {
  it("lifts the marker into the field and cleans the title", () => {
    assert.deepEqual(migrateFocusMarker({ title: "** Finish draft" }), {
      title: "Finish draft",
      weekly_focus: true,
    });
  });

  it("returns null for rows with nothing to change", () => {
    assert.equal(migrateFocusMarker({ title: "Procedures for Assets" }), null);
    assert.equal(
      migrateFocusMarker({ title: "Already clean", weekly_focus: true }),
      null,
    );
  });

  it("refuses to empty a title that is only a marker", () => {
    // Stripping "**" would leave "", which updateTodoMeta rejects — flag it
    // and leave the text alone rather than writing an uneditable row.
    const out = migrateFocusMarker({ title: "**" });
    assert.deepEqual(out, { title: "**", weekly_focus: true });
    assert.notEqual(out?.title, "");
  });

  it("is idempotent — a second run changes nothing", () => {
    const first = migrateFocusMarker({ title: "**Compile list" });
    assert.deepEqual(first, { title: "Compile list", weekly_focus: true });
    assert.equal(migrateFocusMarker({ ...first! }), null);
  });
});

describe("isWeeklyFocus", () => {
  it("only true for a real boolean true", () => {
    assert.equal(isWeeklyFocus({ weekly_focus: true }), true);
    assert.equal(isWeeklyFocus({ weekly_focus: false }), false);
    assert.equal(isWeeklyFocus({}), false);
    // Legacy/hand-written docs can carry junk; none of it counts as set.
    assert.equal(isWeeklyFocus({ weekly_focus: "true" }), false);
    assert.equal(isWeeklyFocus({ weekly_focus: 1 }), false);
  });
});
