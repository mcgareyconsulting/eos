import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { splitBlockEntries } from "./rocks-view";

describe("splitBlockEntries", () => {
  test("full rocks keep their order; block milestones pool into one list", () => {
    const rockA = { id: "a", title: "A" };
    const rockB = { id: "b", title: "B" };
    const blockX = { id: "x", __block: { milestones: [{ id: "m1" }, { id: "m2" }] } };
    const blockY = { id: "y", __block: { milestones: [{ id: "m3" }] } };
    const { full, other } = splitBlockEntries([rockA, blockX, rockB, blockY]);
    assert.deepEqual(full, [rockA, rockB]);
    assert.deepEqual(
      other.map((m) => m.id),
      ["m1", "m2", "m3"],
    );
  });

  test("no blocks → empty other list", () => {
    const { full, other } = splitBlockEntries([{ id: "a" }]);
    assert.equal(full.length, 1);
    assert.deepEqual(other, []);
  });
});
