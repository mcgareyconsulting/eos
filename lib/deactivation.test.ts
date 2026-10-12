import { describe, expect, it } from "vitest";
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
  it("nulls owner_id, but flags headlines instead of rewriting created_by", () => {
    const plan = planUnassign([
      doc("rocks", "r"),
      doc("todos", "t"),
      doc("issues", "i"),
      doc("scorecard_metrics", "m"),
      doc("headlines", "h"),
    ]);
    const by = Object.fromEntries(plan.patches.map((p) => [p.id, p.patch]));
    expect(by.r).toEqual({ owner_id: null });
    expect(by.m).toEqual({ owner_id: null });
    expect(by.h).toEqual({ owner_unassigned: true });
  });

  it("tells a milestone from a to-do", () => {
    expect(itemTypeOf(doc("todos", "a", { source_rock_id: "r1" }))).toBe("milestone");
    expect(itemTypeOf(doc("todos", "a"))).toBe("todo");
  });

  it("batches notifications: one group per team, rock preferred", () => {
    const plan = planUnassign([
      doc("todos", "t1"),
      doc("todos", "t2"),
      doc("rocks", "r1"),
      doc("issues", "i1", { team_id: "t2" }),
    ]);
    expect(plan.notify).toHaveLength(2);
    const t1 = plan.notify.find((g) => g.teamId === "t1")!;
    expect(t1.count).toBe(3);
    expect(t1.ref).toEqual({ type: "rock", id: "r1" });
  });

  it("does not notify for private to-dos or team-less items", () => {
    const plan = planUnassign([
      doc("todos", "p", { visibility: "private" }),
      doc("issues", "x", { team_id: "" }),
    ]);
    expect(plan.patches).toHaveLength(2);
    expect(plan.notify).toEqual([]);
  });
});

describe("chunk", () => {
  it("never exceeds 500", () => {
    const parts = chunk(Array.from({ length: 1201 }, (_, i) => i));
    expect(parts.map((p) => p.length)).toEqual([500, 500, 201]);
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
  it("allows an ordinary person", () => {
    expect(checkDeactivate(base)).toEqual({ ok: true });
  });
  it("refuses self and empty uid", () => {
    expect(checkDeactivate({ ...base, uid: "a" }).ok).toBe(false);
    expect(checkDeactivate({ ...base, uid: "" }).ok).toBe(false);
  });
  it("refuses the last admin", () => {
    expect(
      checkDeactivate({ ...base, targetIsAdmin: true, hasOtherAdmin: false }),
    ).toEqual({ ok: false, error: "LAST" });
    expect(checkDeactivate({ ...base, targetIsAdmin: true }).ok).toBe(true);
  });
});

describe("ownerRequiredError", () => {
  it("requires an owner on new and edited items, not issues", () => {
    expect(ownerRequiredError({ type: "todo", nextOwner: null, isNew: true })).toBeTruthy();
    expect(ownerRequiredError({ type: "rock", nextOwner: "", isNew: false })).toBeTruthy();
    expect(ownerRequiredError({ type: "metric", nextOwner: undefined, isNew: true })).toBeTruthy();
    expect(ownerRequiredError({ type: "issue", nextOwner: null, isNew: true })).toBeNull();
    expect(ownerRequiredError({ type: "todo", nextOwner: "u", isNew: true })).toBeNull();
  });
  it("lets a stored null stay when the save does not touch the owner", () => {
    expect(ownerRequiredError({ type: "todo", nextOwner: undefined, isNew: false })).toBeNull();
  });
});

describe("private to-do with no active party", () => {
  const todo = { owner_id: null, created_by: "gone" } as never;
  const viewer = (uid: string, isAdmin: boolean) => ({ uid, isAdmin }) as unknown as Viewer;
  it("is admin-only (the deactivated creator cannot sign in)", () => {
    expect(privateTodoAccess.canSee(todo, viewer("other", false))).toBe(false);
    expect(privateTodoAccess.canSee({ owner_id: null, created_by: null } as never, viewer("other", false))).toBe(false);
    expect(privateTodoAccess.canSee(todo, viewer("admin", true))).toBe(true);
  });
});
