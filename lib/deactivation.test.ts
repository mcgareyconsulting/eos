import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  chunk,
  checkDeactivate,
  itemTypeOf,
  ownerRequiredError,
  planUnassign,
  type OwnedDoc,
} from "./deactivation";
import { privateTodoAccess } from "./access/private-item";
import type { Viewer } from "./access/types";

const doc = (
  collection: OwnedDoc["collection"],
  id: string,
  data: Record<string, unknown> = {},
): OwnedDoc => ({ collection, id, data: { team_id: "t1", ...data } });

describe("planUnassign", () => {
  test("nulls owner_id, but flags headlines instead of rewriting created_by", () => {
    const plan = planUnassign([
      doc("rocks", "r"),
      doc("todos", "t"),
      doc("issues", "i"),
      doc("scorecard_metrics", "m"),
      doc("headlines", "h"),
    ]);
    const by = Object.fromEntries(plan.patches.map((p) => [p.id, p.patch]));
    assert.deepEqual(by.r, { owner_id: null });
    assert.deepEqual(by.m, { owner_id: null });
    assert.deepEqual(by.h, { owner_unassigned: true });
  });

  test("tells a milestone from a to-do", () => {
    assert.equal(itemTypeOf(doc("todos", "a", { source_rock_id: "r1" })), "milestone");
    assert.equal(itemTypeOf(doc("todos", "a")), "todo");
  });

  test("batches notifications: one group per team, rock preferred", () => {
    const plan = planUnassign([
      doc("todos", "t1"),
      doc("todos", "t2"),
      doc("rocks", "r1"),
      doc("issues", "i1", { team_id: "t2" }),
    ]);
    assert.equal(plan.notify.length, 2);
    const t1 = plan.notify.find((g) => g.teamId === "t1")!;
    assert.equal(t1.count, 3);
    assert.deepEqual(t1.ref, { type: "rock", id: "r1" });
  });

  test("does not notify for private to-dos or team-less items", () => {
    const plan = planUnassign([
      doc("todos", "p", { visibility: "private" }),
      doc("issues", "x", { team_id: "" }),
    ]);
    assert.equal(plan.patches.length, 2);
    assert.deepEqual(plan.notify, []);
  });
});

describe("chunk", () => {
  test("never exceeds 500", () => {
    const parts = chunk(Array.from({ length: 1201 }, (_, i) => i));
    assert.deepEqual(parts.map((p) => p.length), [500, 500, 201]);
  });
});

describe("checkDeactivate", () => {
  const base = {
    uid: "u",
    actorUid: "a",
    targetIsAdmin: false,
    hasOtherAdmin: true,
    lastAdminMessage: "LAST",
  };
  test("allows an ordinary person", () => {
    assert.deepEqual(checkDeactivate(base), { ok: true });
  });
  test("refuses self and empty uid", () => {
    assert.equal(checkDeactivate({ ...base, uid: "a" }).ok, false);
    assert.equal(checkDeactivate({ ...base, uid: "" }).ok, false);
  });
  test("refuses the last admin", () => {
    assert.deepEqual(
      checkDeactivate({ ...base, targetIsAdmin: true, hasOtherAdmin: false }),
      { ok: false, error: "LAST" },
    );
    assert.equal(checkDeactivate({ ...base, targetIsAdmin: true }).ok, true);
  });
});

describe("ownerRequiredError", () => {
  test("requires an owner on new and edited items, not issues", () => {
    assert.ok(ownerRequiredError({ type: "todo", nextOwner: null, isNew: true }));
    assert.ok(ownerRequiredError({ type: "rock", nextOwner: "", isNew: false }));
    assert.ok(ownerRequiredError({ type: "metric", nextOwner: undefined, isNew: true }));
    assert.equal(ownerRequiredError({ type: "issue", nextOwner: null, isNew: true }), null);
    assert.equal(ownerRequiredError({ type: "todo", nextOwner: "u", isNew: true }), null);
  });
  test("lets a stored null stay when the save does not touch the owner", () => {
    assert.equal(ownerRequiredError({ type: "todo", nextOwner: undefined, isNew: false }), null);
  });
});

describe("private to-do with no active party", () => {
  const todo = { owner_id: null, created_by: "gone" } as never;
  const viewer = (uid: string, isAdmin: boolean) => ({ uid, isAdmin }) as unknown as Viewer;
  test("is admin-only (the deactivated creator cannot sign in)", () => {
    assert.equal(privateTodoAccess.canSee(todo, viewer("other", false)), false);
    assert.equal(privateTodoAccess.canSee({ owner_id: null, created_by: null } as never, viewer("other", false)), false);
    assert.equal(privateTodoAccess.canSee(todo, viewer("admin", true)), true);
  });
});
