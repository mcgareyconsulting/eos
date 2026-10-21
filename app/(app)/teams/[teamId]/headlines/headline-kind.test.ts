import { test } from "node:test";
import assert from "node:assert/strict";
import { HEADLINE_KIND_OPTIONS, headlineKind } from "./headline-kind";

test("offers every stored kind once, in picker order, Customer first", () => {
  assert.deepEqual(
    HEADLINE_KIND_OPTIONS.map((o) => o.value),
    ["customer", "employee", "cascading", "general"],
  );
});

test("each kind has a label and its own dot color", () => {
  for (const o of HEADLINE_KIND_OPTIONS) {
    assert.ok(o.label.length > 0);
    assert.match(o.dotClassName, /^bg-/);
  }
  const dots = HEADLINE_KIND_OPTIONS.map((o) => o.dotClassName);
  assert.equal(new Set(dots).size, dots.length);
});

test("headlineKind looks up by value and falls back to Customer", () => {
  assert.equal(headlineKind("general").label, "General / FYI");
  assert.equal(headlineKind("cascading").dotClassName, "bg-hpb-gold");
  assert.equal(headlineKind("bogus").value, "customer");
  assert.equal(headlineKind(undefined).value, "customer");
  assert.equal(headlineKind(null).value, "customer");
});
