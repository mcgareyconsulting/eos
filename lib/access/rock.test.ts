import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  milestoneAccess,
  rockAccess,
  rockSubjectOf,
  rockViewFor,
  type RockSubject,
} from "./rock";
import { OTHER, PARENT, SHARED, UNRELATED, VIEWER_ENTRIES, VIEWERS } from "./test-viewers";
import { viewerOf, type Viewer } from "./types";

// The spec model (docs/PERMISSIONS_SPEC.md §3.3), P6a.

/** A person in the audience by name, on an unrelated team. */
const audiencePerson: Viewer = viewerOf("u-aud", false, [UNRELATED]);

const rock: RockSubject = {
  team_id: PARENT,
  owner_id: VIEWERS.parentMember.uid,
  audience_team_ids: [SHARED],
  audience_user_ids: [audiencePerson.uid],
};

const ALL: [string, Viewer][] = [...VIEWER_ENTRIES, ["audiencePerson", audiencePerson]];

describe("rockAccess — who gets the full rock", () => {
  const expectFull: Record<string, boolean> = {
    admin: true,
    parentLeader: true,
    parentMember: true,
    sharedMember: true, // audience team
    audiencePerson: true, // audience person
    // A milestone assignee outside that set: headline only.
    assignee: false,
    // Owning the rock grants nothing by itself (the owner must be on the
    // parent team; a legacy off-team owner here sits on SHARED, which is in
    // the audience, so test them on a rock without it below).
    offTeamOwner: true,
    otherLeader: false,
    outsider: false,
  };
  for (const [name, v] of ALL) {
    test(`${name} → ${expectFull[name]}`, () => {
      for (const fn of [
        rockAccess.canSee,
        rockAccess.canEdit,
        rockAccess.canSetStatus,
        rockAccess.canComment,
        rockAccess.canMention,
      ]) {
        assert.equal(fn(rock, v), expectFull[name]);
      }
    });
  }

  test("an off-team owner without audience gets nothing", () => {
    const r: RockSubject = { team_id: PARENT, owner_id: VIEWERS.offTeamOwner.uid };
    assert.equal(rockAccess.canSee(r, VIEWERS.offTeamOwner), false);
    assert.equal(rockAccess.canSetStatus(r, VIEWERS.offTeamOwner), false);
  });

  test("milestone_owner_ids grants nothing", () => {
    const stored = rockSubjectOf({
      team_id: PARENT,
      owner_id: VIEWERS.parentMember.uid,
      milestone_owner_ids: [VIEWERS.assignee.uid],
    });
    assert.equal(rockAccess.canSee(stored, VIEWERS.assignee), false);
  });

  test("legacy shared_team_ids still grants the audience until migration", () => {
    const legacy = rockSubjectOf({
      team_id: PARENT,
      owner_id: VIEWERS.parentMember.uid,
      shared_team_ids: [SHARED],
    });
    assert.equal(rockAccess.canEdit(legacy, VIEWERS.sharedMember), true);
  });

  test("a private rock has no audience, whatever is stored", () => {
    const priv: RockSubject = { ...rock, private: true };
    assert.equal(rockAccess.canSee(priv, VIEWERS.sharedMember), false);
    assert.equal(rockAccess.canSee(priv, audiencePerson), false);
    assert.equal(rockAccess.canSee(priv, VIEWERS.parentMember), true);
    assert.equal(rockAccess.canSee({ ...rock, private: null, team_only: true }, VIEWERS.sharedMember), false);
  });
});

describe("rockAccess — delete, audience, Private, Company", () => {
  test("delete: parent team and admins only (the audience may not)", () => {
    for (const [name, v] of ALL) {
      const want = name === "admin" || name === "parentLeader" || name === "parentMember";
      assert.equal(rockAccess.canDelete(rock, v), want, name);
    }
  });

  test("audience and Private: leaders of the parent team and admins only", () => {
    for (const [name, v] of ALL) {
      const want = name === "admin" || name === "parentLeader";
      assert.equal(rockAccess.canChangeAudience(rock, v), want, `audience ${name}`);
      assert.equal(rockAccess.canSetPrivate(rock, v), want, `private ${name}`);
    }
  });

  test("a leader of another team leads nothing here", () => {
    const shared: RockSubject = { ...rock, audience_team_ids: [UNRELATED] };
    assert.equal(rockAccess.canEdit(shared, VIEWERS.otherLeader), true);
    assert.equal(rockAccess.canChangeAudience(shared, VIEWERS.otherLeader), false);
  });

  test("Company flag: admins only; follow = can see the full rock", () => {
    for (const [, v] of ALL) {
      assert.equal(rockAccess.canSetCompanyFlag(rock, v), v.isAdmin);
      assert.equal(rockAccess.canFollow(rock, v), rockAccess.canSee(rock, v));
    }
  });
});

describe("rockViewFor", () => {
  test("full / headline / none", () => {
    const owners = [VIEWERS.assignee.uid, null];
    assert.equal(rockViewFor(rock, VIEWERS.parentMember, owners), "full");
    assert.equal(rockViewFor(rock, VIEWERS.assignee, owners), "headline");
    assert.equal(rockViewFor(rock, VIEWERS.outsider, owners), "none");
    assert.equal(rockViewFor(rock, audiencePerson, []), "full");
  });
});

describe("milestoneAccess", () => {
  const mine = {
    rock,
    milestone: { owner_id: VIEWERS.assignee.uid, team_id: PARENT, visibility: "team" },
  };
  const theirs = {
    rock,
    milestone: { owner_id: VIEWERS.parentMember.uid, team_id: PARENT, visibility: "team" },
  };

  test("the assignee sees and ticks their own milestone, not others'", () => {
    assert.equal(milestoneAccess.canSee(mine, VIEWERS.assignee), true);
    assert.equal(milestoneAccess.canComplete(mine, VIEWERS.assignee), true);
    assert.equal(milestoneAccess.canSee(theirs, VIEWERS.assignee), false);
    assert.equal(milestoneAccess.canComplete(theirs, VIEWERS.assignee), false);
    assert.equal(milestoneAccess.canEdit(mine, VIEWERS.assignee), false);
  });

  test("the rock owner off the parent team no longer ticks every milestone", () => {
    const r: RockSubject = { team_id: PARENT, owner_id: VIEWERS.offTeamOwner.uid };
    assert.equal(
      milestoneAccess.canComplete({ rock: r, milestone: theirs.milestone }, VIEWERS.offTeamOwner),
      false,
    );
  });

  test("parent team, audience and admins tick and edit any milestone", () => {
    for (const v of [VIEWERS.parentMember, VIEWERS.sharedMember, audiencePerson, VIEWERS.admin]) {
      assert.equal(milestoneAccess.canComplete(theirs, v), true);
      assert.equal(milestoneAccess.canEdit(theirs, v), true);
      assert.equal(milestoneAccess.canDelete(theirs, v), true);
    }
    assert.equal(milestoneAccess.canComplete(theirs, VIEWERS.outsider), false);
  });

  test("mention = can see (a block view grants nothing)", () => {
    assert.equal(milestoneAccess.canMention(mine, VIEWERS.assignee), true);
    assert.equal(milestoneAccess.canMention(theirs, VIEWERS.assignee), false);
    assert.equal(milestoneAccess.canMention(theirs, viewerOf("u-x", false, [OTHER])), false);
  });

  test("a milestone's thread is still its to-do thread (SPEC P6b widens it)", () => {
    assert.equal(milestoneAccess.canComment(mine, VIEWERS.parentMember), true);
    assert.equal(milestoneAccess.canComment(mine, VIEWERS.assignee), false);
    assert.equal(milestoneAccess.canFollow(mine, VIEWERS.sharedMember), false);
  });

  test("a legacy private milestone keeps the to-do owner rule for ticks", () => {
    const priv = {
      rock,
      milestone: { owner_id: VIEWERS.parentLeader.uid, team_id: PARENT, visibility: "private" },
    };
    assert.equal(milestoneAccess.canComplete(priv, VIEWERS.parentMember), false);
    assert.equal(milestoneAccess.canComplete(priv, VIEWERS.parentLeader), true);
  });
});
