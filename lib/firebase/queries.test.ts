import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import {
  loadMilestonesForRocks,
  loadTeamRocks,
  loadTeamsById,
  loadUsersById,
} from "./queries";
import { FIRESTORE_IN_LIMIT } from "@/lib/firestore-in";

// Records the value of every `in` filter and every getAll() call, so the
// tests can assert on the *queries issued*, not just the rows returned — the
// fake would happily answer a single 31-value `in`, which real Firestore
// rejects.
function spyOn(fake: FakeFirestore) {
  const inValues: string[][] = [];
  const getAllCalls: number[] = [];
  const realCollection = fake.collection.bind(fake);
  const realGetAll = fake.getAll.bind(fake);

  fake.collection = ((name: string) => {
    const col = realCollection(name);
    return {
      ...col,
      where: (field: string, op: string, value: unknown) => {
        if (op === "in") inValues.push(value as string[]);
        return col.where(field, op, value);
      },
    };
  }) as FakeFirestore["collection"];

  fake.getAll = ((...refs: Parameters<FakeFirestore["getAll"]>) => {
    getAllCalls.push(refs.length);
    return realGetAll(...refs);
  }) as FakeFirestore["getAll"];

  return { inValues, getAllCalls };
}

describe("loadMilestonesForRocks", () => {
  test("chunks the id list at the Firestore `in` limit", async () => {
    const fake = new FakeFirestore();
    const rockIds = Array.from(
      { length: FIRESTORE_IN_LIMIT + 1 },
      (_, i) => `rock-${i}`,
    );
    // One milestone on the first rock and one on the last, so a dropped
    // chunk shows up as a missing row rather than only a missing query.
    fake.seed("todos", "m-first", { source_rock_id: "rock-0" });
    fake.seed("todos", "m-last", {
      source_rock_id: `rock-${FIRESTORE_IN_LIMIT}`,
    });
    const spy = spyOn(fake);

    const docs = await loadMilestonesForRocks(fake.asFirestore(), rockIds);

    assert.deepEqual(
      spy.inValues.map((v) => v.length),
      [FIRESTORE_IN_LIMIT, 1],
    );
    assert.deepEqual(docs.map((d) => d.id).sort(), ["m-first", "m-last"]);
  });

  test("issues no query for an empty id list", async () => {
    const fake = new FakeFirestore();
    fake.seed("todos", "m1", { source_rock_id: "rock-1" });
    const spy = spyOn(fake);

    assert.deepEqual(
      await loadMilestonesForRocks(fake.asFirestore(), []),
      [],
    );
    assert.deepEqual(spy.inValues, []);
  });
});

describe("loadTeamRocks", () => {
  test("keeps a rock that is both owned and shared out of `shared`", async () => {
    const fake = new FakeFirestore();
    // Owned by team-a and also shared back into team-a — both queries match.
    fake.seed("rocks", "own-and-shared", {
      team_id: "team-a",
      shared_team_ids: ["team-a", "team-b"],
    });
    fake.seed("rocks", "own-only", { team_id: "team-a" });
    fake.seed("rocks", "shared-in", {
      team_id: "team-b",
      shared_team_ids: ["team-a"],
    });
    fake.seed("rocks", "other-team", { team_id: "team-b" });

    const { own, shared } = await loadTeamRocks(fake.asFirestore(), "team-a");

    assert.deepEqual(own.map((d) => d.id).sort(), [
      "own-and-shared",
      "own-only",
    ]);
    assert.deepEqual(
      shared.map((d) => d.id),
      ["shared-in"],
    );
  });
});

describe("loadUsersById / loadTeamsById", () => {
  test("returns existing docs keyed by id, in first-seen order", async () => {
    const fake = new FakeFirestore();
    fake.seed("users", "u1", { display_name: "Ada" });
    fake.seed("users", "u2", { email: "b@example.com" });
    fake.seed("teams", "t1", { name: "Leadership" });

    const users = await loadUsersById(fake.asFirestore(), [
      "u2",
      "u1",
      // Duplicate and missing ids must not produce entries.
      "u2",
      "gone",
    ]);
    assert.deepEqual([...users.keys()], ["u2", "u1"]);
    assert.equal(users.get("u1")?.display_name, "Ada");

    const teams = await loadTeamsById(fake.asFirestore(), ["t1"]);
    assert.equal(teams.get("t1")?.name, "Leadership");
  });

  test("skips the getAll when no usable id is given", async () => {
    const fake = new FakeFirestore();
    fake.seed("users", "u1", { display_name: "Ada" });
    const spy = spyOn(fake);

    assert.equal((await loadUsersById(fake.asFirestore(), [])).size, 0);
    assert.equal((await loadUsersById(fake.asFirestore(), [""])).size, 0);
    assert.equal((await loadTeamsById(fake.asFirestore(), [])).size, 0);
    assert.deepEqual(spy.getAllCalls, []);
  });
});
