import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { activityVerb, joinNames, type ActivityKind } from "./activity";
import { writeActivity } from "./firebase/activity";
import { FakeFirestore } from "./test-support/fake-firestore";

describe("activity trace", () => {
  test("every kind has a verb", () => {
    const kinds: ActivityKind[] = [
      "created",
      "updated",
      "description",
      "completed",
      "reopened",
      "dropped",
      "solving",
      "term_short",
      "term_long",
      "archived",
      "restored",
      "weekly_focus_on",
      "weekly_focus_off",
      "followed",
      "unfollowed",
      "followers_added",
      "followers_removed",
      "commented",
      "comment_deleted",
    ];
    for (const k of kinds) {
      assert.ok(activityVerb(k).length > 0, k);
      assert.ok(activityVerb(k, "issue").length > 0, `${k} (issue)`);
    }
  });

  test("the same event is worded per entity", () => {
    assert.equal(activityVerb("created"), "created this to-do");
    assert.equal(activityVerb("created", "issue"), "raised this issue");
    assert.equal(activityVerb("completed", "todo"), "completed it");
    assert.equal(activityVerb("completed", "issue"), "solved it");
  });

  test("joinNames falls back per person and is null when empty", () => {
    const names = new Map([["a", "Ada"]]);
    assert.equal(joinNames(["a", "b"], (id) => names.get(id)), "Ada, —");
    assert.equal(joinNames([], () => "x"), null);
  });

  test("a row copies the entity's visibility and owner and resolves the actor", async () => {
    const fake = new FakeFirestore();
    fake.seed("users", "actor", { display_name: "Steph Benes" });
    await writeActivity({
      db: fake.asFirestore(),
      teamId: "t1",
      entity: { type: "todo", id: "todo-1", visibility: "private", ownerId: "o" },
      kind: "completed",
      actor: { id: "actor" },
      detail: "  ",
    });
    const rows = fake.docsIn("entity_activity").map((d) => d.data);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].visibility, "private");
    assert.equal(rows[0].owner_id, "o");
    assert.equal(rows[0].actor_name, "Steph Benes");
    assert.equal(rows[0].kind, "completed");
    assert.equal(rows[0].detail, null);
  });

  test("an issue row has no private form and says team", async () => {
    const fake = new FakeFirestore();
    await writeActivity({
      db: fake.asFirestore(),
      teamId: "t1",
      entity: { type: "issue", id: "issue-1", ownerId: null },
      kind: "dropped",
      actor: { id: "ghost" },
    });
    const row = fake.docsIn("entity_activity")[0].data;
    assert.equal(row.entity_type, "issue");
    assert.equal(row.visibility, "team");
    assert.equal(row.owner_id, null);
    assert.equal(row.actor_name, "Someone");
  });
});
