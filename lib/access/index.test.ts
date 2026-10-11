import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  accessFor,
  headlineAccess,
  issueAccess,
  metricAccess,
  milestoneAccess,
  rockAccess,
  todoAccess,
} from "./index";
import { ITEM_TYPES } from "@/lib/item-registry";

const METHODS = [
  "canSee",
  "canEdit",
  "canComment",
  "canFollow",
  "canMention",
  "canDelete",
] as const;

describe("accessFor", () => {
  test("maps each item type to its module", () => {
    assert.equal(accessFor("rock"), rockAccess);
    assert.equal(accessFor("milestone"), milestoneAccess);
    assert.equal(accessFor("todo"), todoAccess);
    assert.equal(accessFor("issue"), issueAccess);
    assert.equal(accessFor("metric"), metricAccess);
    assert.equal(accessFor("headline"), headlineAccess);
  });

  test("every registry type has a module implementing the common interface", () => {
    for (const type of ITEM_TYPES) {
      const mod = accessFor(type) as unknown as Record<string, unknown>;
      for (const m of METHODS) {
        assert.equal(typeof mod[m], "function", `${type}.${m}`);
      }
    }
  });
});
