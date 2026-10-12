import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { headlineAccess, issueAccess } from "./team-item";
import { PARENT, VIEWER_ENTRIES, VIEWERS } from "./test-viewers";

const onTeamOrAdmin = (name: keyof typeof VIEWERS) =>
  name === "admin" || name === "parentLeader" || name === "parentMember";

describe("issueAccess (shape A) — the team gate", () => {
  const issue = { team_id: PARENT, owner_id: VIEWERS.parentMember.uid };
  for (const [name, v] of VIEWER_ENTRIES) {
    test(name, () => {
      const want = onTeamOrAdmin(name);
      assert.equal(issueAccess.canSee(issue, v), want, "see");
      assert.equal(issueAccess.canEdit(issue, v), want, "edit");
      assert.equal(issueAccess.canComment(issue, v), want, "comment");
      assert.equal(issueAccess.canDelete(issue, v), want, "delete");
      assert.equal(issueAccess.canComplete(issue, v), want, "solve");
      assert.equal(issueAccess.canMention(issue, v), want, "mention");
      assert.equal(issueAccess.canFollow(issue, v), want, "follow = see");
    });
  }
});

describe("headlineAccess (shape A)", () => {
  const headline = { team_id: PARENT, created_by: VIEWERS.parentMember.uid };
  const broadcast = { ...headline, broadcast: true };

  for (const [name, v] of VIEWER_ENTRIES) {
    test(name, () => {
      const want = onTeamOrAdmin(name);
      assert.equal(headlineAccess.canSee(headline, v), want, "see");
      assert.equal(headlineAccess.canEdit(headline, v), want, "edit");
      assert.equal(headlineAccess.canDelete(headline, v), want, "delete");
      assert.equal(headlineAccess.canComplete(headline, v), want, "discuss");
      // No headline thread yet; follow = see.
      assert.equal(headlineAccess.canComment(headline, v), false, "comment");
      assert.equal(headlineAccess.canFollow(headline, v), want, "follow");
      // Broadcast copies: checkable and archivable, never edited or deleted.
      assert.equal(headlineAccess.canSee(broadcast, v), want, "see broadcast");
      assert.equal(headlineAccess.canComplete(broadcast, v), want, "discuss broadcast");
      assert.equal(headlineAccess.canEdit(broadcast, v), false, "edit broadcast");
      assert.equal(headlineAccess.canDelete(broadcast, v), false, "delete broadcast");
    });
  }
});
