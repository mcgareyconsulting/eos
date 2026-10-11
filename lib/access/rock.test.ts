import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  canSetRockStatus,
  canTickMilestone,
  hasFullRockView,
  rockAccessFor,
  type MilestoneLike,
} from "@/lib/rocks-share";
import { milestoneAccess, rockAccess, toRockViewer, type RockSubject } from "./rock";
import {
  actionTeams,
  OTHER,
  PARENT,
  SHARED,
  VIEWER_ENTRIES,
  VIEWERS,
} from "./test-viewers";
import type { Viewer } from "./types";

const milestones: (MilestoneLike & { id: string; team_id: string })[] = [
  { id: "m-asg", owner_id: VIEWERS.assignee.uid, team_id: PARENT },
  { id: "m-mem", owner_id: VIEWERS.parentMember.uid, team_id: PARENT },
  { id: "m-locked", owner_id: VIEWERS.assignee.uid, team_id: PARENT, team_hidden: true },
  { id: "m-none", owner_id: null, team_id: PARENT },
];

function withMs(rock: RockSubject): RockSubject {
  return {
    ...rock,
    milestones,
    milestone_owner_ids: [
      ...new Set(milestones.map((m) => m.owner_id).filter((x): x is string => !!x)),
    ],
  };
}

const ROCKS: Record<string, RockSubject> = {
  plain: { team_id: PARENT, owner_id: VIEWERS.parentMember.uid },
  shared: { team_id: PARENT, owner_id: VIEWERS.parentMember.uid, shared_team_ids: [SHARED] },
  offTeamOwner: {
    team_id: PARENT,
    owner_id: VIEWERS.offTeamOwner.uid,
    shared_team_ids: [SHARED],
  },
  ownerOffAllTeams: { team_id: PARENT, owner_id: VIEWERS.assignee.uid },
  teamOnly: {
    team_id: PARENT,
    owner_id: VIEWERS.parentMember.uid,
    team_only: true,
  },
  withMilestones: withMs({ team_id: PARENT, owner_id: VIEWERS.parentMember.uid }),
  sharedWithMilestones: withMs({
    team_id: PARENT,
    owner_id: VIEWERS.offTeamOwner.uid,
    shared_team_ids: [SHARED],
  }),
  ownerless: { team_id: PARENT, owner_id: null, shared_team_ids: [OTHER] },
};

/** Line-for-line replica of requireRockThreadAccess (entity-comments/actions.ts), from team `teamId`. */
function currentRockThreadGate(rock: RockSubject, v: Viewer, teamId: string): boolean {
  const shared = rock.shared_team_ids ?? [];
  const owners = rock.milestone_owner_ids ?? [];
  return (
    v.isAdmin ||
    rock.team_id === teamId ||
    shared.includes(teamId) ||
    rock.owner_id === v.uid ||
    owners.includes(v.uid)
  );
}

describe("rockAccess — parity with lib/rocks-share.ts", () => {
  for (const [rockName, rock] of Object.entries(ROCKS)) {
    for (const [viewerName, v] of VIEWER_ENTRIES) {
      test(`${rockName} × ${viewerName}`, () => {
        const rv = toRockViewer(v);
        const ms = rock.milestones ?? (rock.milestone_owner_ids ?? []).map((owner_id) => ({ owner_id }));
        assert.equal(rockAccess.canSee(rock, v), hasFullRockView(rock, rv, ms), "canSee");
        assert.equal(rockAccess.canEdit(rock, v), rockAccessFor(rock, rv) === "edit", "canEdit");
        assert.equal(rockAccess.canDelete(rock, v), rockAccessFor(rock, rv) === "edit", "canDelete");
        assert.equal(
          rockAccess.canSetStatus(rock, v),
          rockAccessFor(rock, rv) !== "read",
          "canSetStatus vs rockAccessFor",
        );
        // The single-team form the server action uses, from any team the
        // viewer can act through (an admin acts as the parent team).
        const viaAction = v.isAdmin
          ? canSetRockStatus(rock, rock.team_id, v.uid)
          : actionTeams(v).some((t) => canSetRockStatus(rock, t, v.uid));
        assert.equal(rockAccess.canSetStatus(rock, v), viaAction, "canSetStatus vs canSetRockStatus");
        const threadViaAction = actionTeams(v).some((t) =>
          currentRockThreadGate(rock, v, t),
        );
        assert.equal(rockAccess.canComment(rock, v), threadViaAction, "canComment");
        assert.equal(rockAccess.canMention(rock, v), rockAccess.canSee(rock, v), "canMention");
        assert.equal(rockAccess.canFollow(rock, v), false, "canFollow");
        assert.equal(rockAccess.canSetCompanyFlag(rock, v), v.isAdmin, "company flag");
      });
    }
  }
});

describe("milestoneAccess — parity with lib/rocks-share.ts", () => {
  for (const [rockName, rock] of Object.entries(ROCKS)) {
    for (const m of milestones) {
      for (const [viewerName, v] of VIEWER_ENTRIES) {
        test(`${rockName} / ${m.id} × ${viewerName}`, () => {
          const subject = { rock, milestone: m };
          const expectedTick = canTickMilestone(rock, m, {
            uid: v.uid,
            fullAccess: v.isAdmin || v.teamIds.has(rock.team_id),
          });
          assert.equal(milestoneAccess.canComplete(subject, v), expectedTick, "canComplete");
          assert.equal(milestoneAccess.canSee(subject, v), rockAccess.canSee(rock, v), "canSee");
          assert.equal(milestoneAccess.canEdit(subject, v), rockAccess.canEdit(rock, v), "canEdit");
        });
      }
    }
  }
});

describe("rockAccess — current behaviour, spelled out", () => {
  const rock = ROCKS.sharedWithMilestones;
  const expectSee: Record<keyof typeof VIEWERS, boolean> = {
    admin: true,
    parentLeader: true,
    parentMember: true,
    sharedMember: true,
    // Today an assignee gets the full rock (SPEC P6 strips this).
    assignee: true,
    offTeamOwner: true,
    otherLeader: false,
    outsider: false,
  };
  for (const [name, v] of VIEWER_ENTRIES) {
    test(`canSee: ${name} → ${expectSee[name]}`, () => {
      assert.equal(rockAccess.canSee(rock, v), expectSee[name]);
    });
  }

  test("only the parent team and admins edit, delete, share or set Keep-on-this-team", () => {
    for (const [name, v] of VIEWER_ENTRIES) {
      const want = name === "admin" || name === "parentLeader" || name === "parentMember";
      assert.equal(rockAccess.canEdit(rock, v), want, `edit ${name}`);
      assert.equal(rockAccess.canDelete(rock, v), want, `delete ${name}`);
      assert.equal(rockAccess.canChangeAudience(rock, v), want, `audience ${name}`);
      assert.equal(rockAccess.canSetPrivate(rock, v), want, `private ${name}`);
    }
  });

  test("the off-team owner may move the status from a shared team", () => {
    assert.equal(rockAccess.canSetStatus(rock, VIEWERS.offTeamOwner), true);
    assert.equal(rockAccess.canSetStatus(rock, VIEWERS.sharedMember), false);
    assert.equal(rockAccess.canSetStatus(rock, VIEWERS.assignee), false);
  });

  test("the rock owner may tick any milestone; an assignee only their own", () => {
    const own = { rock, milestone: milestones[1] }; // m-mem
    assert.equal(milestoneAccess.canComplete(own, VIEWERS.offTeamOwner), true);
    assert.equal(milestoneAccess.canComplete(own, VIEWERS.assignee), false);
    assert.equal(
      milestoneAccess.canComplete({ rock, milestone: milestones[0] }, VIEWERS.assignee),
      true,
    );
    assert.equal(milestoneAccess.canComplete(own, VIEWERS.outsider), false);
  });

  test("a milestone's thread is its to-do thread: parent team and admins only", () => {
    const subject = { rock, milestone: milestones[0] };
    assert.equal(milestoneAccess.canComment(subject, VIEWERS.parentMember), true);
    assert.equal(milestoneAccess.canComment(subject, VIEWERS.admin), true);
    assert.equal(milestoneAccess.canComment(subject, VIEWERS.assignee), false);
    assert.equal(milestoneAccess.canComment(subject, VIEWERS.sharedMember), false);
    assert.equal(milestoneAccess.canFollow(subject, VIEWERS.parentMember), true);
    assert.equal(milestoneAccess.canFollow(subject, VIEWERS.assignee), false);
  });

  test("a legacy private milestone's thread is its owner's alone", () => {
    const m = { id: "m-priv", owner_id: VIEWERS.parentMember.uid, team_id: PARENT, visibility: "private" };
    const other = { rock, milestone: { ...m, owner_id: VIEWERS.parentLeader.uid } };
    assert.equal(milestoneAccess.canComment({ rock, milestone: m }, VIEWERS.parentMember), true);
    assert.equal(milestoneAccess.canComment(other, VIEWERS.parentMember), false);
    assert.equal(milestoneAccess.canComment(other, VIEWERS.admin), false);
  });

  test("delete a milestone: the to-do gate on its team", () => {
    const subject = { rock, milestone: milestones[0] };
    assert.equal(milestoneAccess.canDelete(subject, VIEWERS.parentMember), true);
    assert.equal(milestoneAccess.canDelete(subject, VIEWERS.admin), true);
    assert.equal(milestoneAccess.canDelete(subject, VIEWERS.assignee), false);
  });

  test("milestone_owner_ids stands in for milestones when they aren't loaded", () => {
    const bare: RockSubject = {
      team_id: PARENT,
      owner_id: VIEWERS.parentMember.uid,
      milestone_owner_ids: [VIEWERS.assignee.uid],
    };
    assert.equal(rockAccess.canSee(bare, VIEWERS.assignee), true);
    assert.equal(rockAccess.canSee(bare, VIEWERS.outsider), false);
  });
});
