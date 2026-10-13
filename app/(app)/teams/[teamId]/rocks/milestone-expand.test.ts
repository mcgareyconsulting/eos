import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { emptyKeys, toggleKey, withDraft } from "./milestone-expand";

describe("toggleKey", () => {
  test("adds, then removes, leaving the input untouched", () => {
    const a = emptyKeys();
    const b = toggleKey(a, "m1");
    assert.deepEqual([...b], ["m1"]);
    assert.equal(a.size, 0);
    const c = toggleKey(b, "m2");
    assert.deepEqual([...c].sort(), ["m1", "m2"]);
    assert.deepEqual([...toggleKey(c, "m1")], ["m2"]);
  });
});

describe("withDraft", () => {
  test("marks and clears a key", () => {
    const a = withDraft(emptyKeys(), "m1", true);
    assert.deepEqual([...a], ["m1"]);
    assert.equal(withDraft(a, "m1", false).size, 0);
  });

  test("a report that changes nothing returns the same set", () => {
    const a = withDraft(emptyKeys(), "m1", true);
    assert.equal(withDraft(a, "m1", true), a);
    assert.equal(withDraft(a, "m2", false), a);
  });

  test("other keys are kept", () => {
    const a = withDraft(withDraft(emptyKeys(), "m1", true), "m2", true);
    assert.deepEqual([...withDraft(a, "m1", false)], ["m2"]);
  });
});
