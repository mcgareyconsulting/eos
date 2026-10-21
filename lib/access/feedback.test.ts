import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { accessFor, feedbackAccess, viewerOf } from "./index";

// The tracker's access list, resolved to uids at load time
// (lib/firebase/items.ts → feedbackAccessUids). Org admin and team roles
// grant nothing; only the list does.
const ITEM = { access_uids: ["u-steph", "u-dan"] };
const steph = viewerOf("u-steph", false, []);
const admin = viewerOf("u-admin", true, ["team-p"], ["team-p"]);
const leader = viewerOf("u-lead", false, ["team-p"], ["team-p"]);
const listedAdmin = viewerOf("u-dan", true, []);

describe("feedbackAccess (N73: the tracker's access list)", () => {
  test("listed people see, edit, comment and can be mentioned", () => {
    for (const v of [steph, listedAdmin]) {
      assert.equal(feedbackAccess.canSee(ITEM, v), true);
      assert.equal(feedbackAccess.canEdit(ITEM, v), true);
      assert.equal(feedbackAccess.canComment(ITEM, v), true);
      assert.equal(feedbackAccess.canMention(ITEM, v), true);
    }
  });

  test("an org admin or a team leader who is not listed gets nothing", () => {
    for (const v of [admin, leader]) {
      for (const m of ["canSee", "canEdit", "canComment", "canMention", "canFollow", "canDelete"] as const) {
        assert.equal(feedbackAccess[m](ITEM, v), false, m);
      }
    }
  });

  test("never followable, never deletable — listed or not", () => {
    assert.equal(feedbackAccess.canFollow(ITEM, steph), false);
    assert.equal(feedbackAccess.canDelete(ITEM, steph), false);
  });

  test("fails closed: no resolved list, an empty list, an empty uid", () => {
    assert.equal(feedbackAccess.canSee({}, steph), false);
    assert.equal(feedbackAccess.canSee({ access_uids: [] }, steph), false);
    assert.equal(feedbackAccess.canSee({ access_uids: [""] }, viewerOf("", true, [])), false);
  });

  test("accessFor('feedback') is this module", () => {
    assert.equal(accessFor("feedback"), feedbackAccess);
  });
});
