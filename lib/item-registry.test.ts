import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { CommentEntityType } from "@/app/(app)/teams/[teamId]/entity-comments/actions";
import { notificationHref } from "./notifications";
import {
  ITEM_REGISTRY,
  ITEM_TYPES,
  isEventFor,
  isItemType,
  itemTypeOfTodoDoc,
  linkFor,
  ownerOf,
  registryFor,
  type ThreadEntityType,
} from "./item-registry";

// Compile-time: the registry's thread types are exactly the ones the comment
// action accepts today. If either side changes, typecheck fails here.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const threadTypesMatch: Same<ThreadEntityType, CommentEntityType> = true;

describe("item registry (spec §5.0)", () => {
  test("one entry per item type, keyed by its own type", () => {
    assert.deepEqual(Object.keys(ITEM_REGISTRY).sort(), [...ITEM_TYPES].sort());
    for (const type of ITEM_TYPES) assert.equal(ITEM_REGISTRY[type].type, type);
    assert.ok(threadTypesMatch);
  });

  test("shapes", () => {
    assert.deepEqual(registryFor("rock").shapes, ["rock"]);
    assert.deepEqual(registryFor("milestone").shapes, ["rock"]);
    assert.deepEqual(registryFor("todo").shapes, ["team-item", "private-item"]);
    assert.deepEqual(registryFor("issue").shapes, ["team-item"]);
    assert.deepEqual(registryFor("metric").shapes, ["metric"]);
    assert.deepEqual(registryFor("headline").shapes, ["team-item"]);
    // The tracker's access list is not a team shape (lib/access/feedback.ts).
    assert.deepEqual(registryFor("feedback").shapes, []);
  });

  test("collections — a milestone is a to-do doc", () => {
    assert.equal(registryFor("rock").collection, "rocks");
    assert.equal(registryFor("milestone").collection, "todos");
    assert.equal(registryFor("todo").collection, "todos");
    assert.equal(registryFor("issue").collection, "issues");
    assert.equal(registryFor("metric").collection, "scorecard_metrics");
    assert.equal(registryFor("headline").collection, "headlines");
    assert.equal(registryFor("feedback").collection, "feedback_items");
  });

  test("owner: the assignee, except a headline's creator; a feedback item has none", () => {
    for (const type of ITEM_TYPES) {
      assert.equal(
        registryFor(type).ownerField,
        type === "headline" ? "created_by" : type === "feedback" ? null : "owner_id",
        type,
      );
    }
    // Its creator is not an owner: no locked follower on a tracker item.
    assert.equal(ownerOf("feedback", { created_by: "u1", owner_id: "u2" }), null);
    assert.equal(ownerOf("headline", { created_by: "u1", owner_id: "u2" }), "u1");
    assert.equal(ownerOf("todo", { owner_id: "u2" }), "u2");
    assert.equal(ownerOf("issue", { owner_id: "" }), null);
    assert.equal(ownerOf("rock", {}), null);
  });

  test("assigner: every type but headline and feedback, stored as assigned_by", () => {
    for (const type of ITEM_TYPES) {
      const none = type === "headline" || type === "feedback";
      assert.equal(registryFor(type).hasAssigner, !none, type);
      assert.equal(registryFor(type).assignerField, none ? null : "assigned_by", type);
    }
  });

  test("threads: none for metric; headline has one", () => {
    assert.equal(registryFor("rock").threadEntityType, "rock");
    assert.equal(registryFor("milestone").threadEntityType, "todo");
    assert.equal(registryFor("todo").threadEntityType, "todo");
    assert.equal(registryFor("issue").threadEntityType, "issue");
    assert.equal(registryFor("metric").threadEntityType, null);
    assert.equal(registryFor("headline").threadEntityType, "headline");
    assert.equal(registryFor("feedback").threadEntityType, "feedback");
  });

  test("mention picker: the whole Directory, except the tracker's own audience", () => {
    for (const type of ITEM_TYPES) {
      assert.equal(registryFor(type).mentionPicker, type === "feedback" ? "audience" : "everyone", type);
    }
  });

  test("events (spec §5.3)", () => {
    assert.deepEqual(registryFor("todo").events, [
      "comment",
      "completed",
      "reopened",
      "title_changed",
      "due_date_changed",
      "description_changed",
      "reassigned",
    ]);
    assert.deepEqual(registryFor("milestone").events, registryFor("todo").events);
    assert.deepEqual(registryFor("rock").events, [
      "comment",
      "status_changed",
      "milestone_completed",
      "owner_changed",
      "due_date_changed",
    ]);
    assert.deepEqual(registryFor("issue").events, [
      "comment",
      "solved",
      "archived",
      "owner_changed",
    ]);
    assert.deepEqual(registryFor("metric").events, [
      "value_posted",
      "goal_changed",
      "owner_changed",
    ]);
    assert.deepEqual(registryFor("headline").events, [
      "comment",
      "text_changed",
      "discussed",
      "archived",
    ]);
    assert.deepEqual(registryFor("feedback").events, ["comment"]);
    assert.equal(isEventFor("metric", "comment"), false);
    assert.equal(isEventFor("rock", "status_changed"), true);
  });

  test("every type but metric lists a comment event", () => {
    for (const type of ITEM_TYPES) {
      const entry = registryFor(type);
      const hasComment = (entry.events as readonly string[]).includes("comment");
      // Headline lists "comment" ahead of its thread (P9); metric never has one.
      if (type === "metric") assert.equal(hasComment, false);
      else assert.equal(hasComment, true, type);
    }
  });

  test("links", () => {
    assert.equal(
      registryFor("todo").link("t1", "a/b"),
      notificationHref({ team_id: "t1", entity_type: "todo", entity_id: "a/b" }),
    );
    assert.equal(registryFor("rock").link("t1", "r1"), "/teams/t1/rocks?rock=r1");
    assert.equal(
      registryFor("milestone").link("t1", "m1"),
      "/teams/t1/rocks?milestone=m1",
    );
    assert.equal(registryFor("issue").link("t1", "i1"), "/teams/t1/issues?issue=i1");
    assert.equal(
      registryFor("metric").link("t1", "x y"),
      "/teams/t1/scorecard?metric=x%20y",
    );
    assert.equal(
      registryFor("headline").link("t1", "h1"),
      "/teams/t1/headlines?headline=h1",
    );
    assert.equal(linkFor({ type: "issue", id: "i1" }, "t1"), "/teams/t1/issues?issue=i1");
    // The tracker is one page, not a team's: the team is ignored.
    assert.equal(registryFor("feedback").link("", "fb-036"), "/admin/feedback?item=fb-036");
    assert.equal(
      notificationHref({ team_id: "", entity_type: "feedback", entity_id: "fb-036" }),
      "/admin/feedback?item=fb-036",
    );
  });

  test("classifying a todos doc", () => {
    assert.equal(itemTypeOfTodoDoc({ source_rock_id: "r1" }), "milestone");
    assert.equal(itemTypeOfTodoDoc({ source_rock_id: null }), "todo");
    assert.equal(itemTypeOfTodoDoc({ source_rock_id: "" }), "todo");
    assert.equal(itemTypeOfTodoDoc({}), "todo");
  });

  test("isItemType", () => {
    for (const type of ITEM_TYPES) assert.equal(isItemType(type), true);
    assert.equal(isItemType("meeting"), false);
    assert.equal(isItemType(undefined), false);
  });
});
