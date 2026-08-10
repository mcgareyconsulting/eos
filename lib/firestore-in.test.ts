import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { chunkForInQuery, FIRESTORE_IN_LIMIT } from "./firestore-in";

describe("chunkForInQuery", () => {
  test("empty input yields no chunks", () => {
    assert.deepEqual(chunkForInQuery([]), []);
  });

  test("under the limit stays a single chunk", () => {
    const ids = Array.from({ length: 5 }, (_, i) => `id-${i}`);
    assert.deepEqual(chunkForInQuery(ids), [ids]);
  });

  test("exactly at the limit stays a single chunk", () => {
    const ids = Array.from({ length: FIRESTORE_IN_LIMIT }, (_, i) => `id-${i}`);
    const chunks = chunkForInQuery(ids);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].length, FIRESTORE_IN_LIMIT);
  });

  test("one over the limit splits into a second chunk", () => {
    const ids = Array.from({ length: FIRESTORE_IN_LIMIT + 1 }, (_, i) => `id-${i}`);
    const chunks = chunkForInQuery(ids);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].length, FIRESTORE_IN_LIMIT);
    assert.equal(chunks[1].length, 1);
  });

  // Home page (>15 teams) and scorecard (>30 metrics) both rely on every
  // chunk staying within FIRESTORE_IN_LIMIT so a single `in` filter never
  // exceeds Firestore's 30-disjunction cap.
  test("a 40-team list (home page regression) splits 30 + 10, no chunk over the cap", () => {
    const teamIds = Array.from({ length: 40 }, (_, i) => `team-${i}`);
    const chunks = chunkForInQuery(teamIds);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].length, 30);
    assert.equal(chunks[1].length, 10);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= FIRESTORE_IN_LIMIT);
    }
  });

  test("many chunks (61 ids) all respect the cap and cover every id exactly once", () => {
    const ids = Array.from({ length: 61 }, (_, i) => `id-${i}`);
    const chunks = chunkForInQuery(ids);
    assert.equal(chunks.length, 3);
    for (const chunk of chunks) {
      assert.ok(chunk.length > 0);
      assert.ok(chunk.length <= FIRESTORE_IN_LIMIT);
    }
    assert.deepEqual(chunks.flat(), ids);
  });

  test("preserves input order within and across chunks", () => {
    const ids = Array.from({ length: 33 }, (_, i) => i);
    const chunks = chunkForInQuery(ids);
    assert.deepEqual(chunks.flat(), ids);
  });
});
