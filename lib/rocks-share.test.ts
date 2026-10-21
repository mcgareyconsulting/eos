import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  audienceTeamIdsOf,
  audienceUserIdsOf,
  blockMilestones,
  groupSharedRocksByOwner,
  isAudienceTeam,
  isPrivateRock,
  partitionSharedRocks,
  sharedBySectionTitle,
  audienceRemovals,
  sharingChangeKey,
  sharingChanges,
  sharingPicture,
  type SharingSnapshot,
} from "./rocks-share";

describe("audience fields", () => {
  test("the new field wins, even when empty, over the legacy one", () => {
    const rock = {
      team_id: "esd",
      owner_id: "jordan",
      audience_team_ids: [],
      shared_team_ids: ["it"],
    };
    assert.deepEqual(audienceTeamIdsOf(rock), []);
  });

  test("legacy shared_team_ids is the fallback until migration", () => {
    const rock = { team_id: "esd", owner_id: "jordan", shared_team_ids: ["it"] };
    assert.deepEqual(audienceTeamIdsOf(rock), ["it"]);
    assert.equal(isAudienceTeam(rock, "it"), true);
  });

  test("never the parent team; deduped", () => {
    const rock = {
      team_id: "esd",
      owner_id: "jordan",
      audience_team_ids: ["esd", "it", "it"],
    };
    assert.deepEqual(audienceTeamIdsOf(rock), ["it"]);
    assert.equal(isAudienceTeam(rock, "esd"), false);
  });

  test("private (or legacy team_only) has no audience", () => {
    const rock = {
      team_id: "esd",
      owner_id: "jordan",
      private: true,
      audience_team_ids: ["it"],
      audience_user_ids: ["joe"],
    };
    assert.equal(isPrivateRock(rock), true);
    assert.deepEqual(audienceTeamIdsOf(rock), []);
    assert.deepEqual(audienceUserIdsOf(rock), []);
    assert.equal(isPrivateRock({ team_only: true }), true);
    // The new field wins over the legacy one.
    assert.equal(isPrivateRock({ private: false, team_only: true }), false);
  });
});

describe("sharedBySectionTitle", () => {
  test("uses the person owner, not a team name", () => {
    assert.equal(sharedBySectionTitle("Sam Reyes"), "Shared by Sam Reyes");
  });
});

describe("groupSharedRocksByOwner", () => {
  test("groups at the bottom by owner first+last", () => {
    const rocks = [
      { team_id: "esd", owner_id: "jordan", title: "A" },
      { team_id: "esd", owner_id: "sam", title: "B" },
      { team_id: "esd", owner_id: "jordan", title: "C" },
    ];
    const names: Record<string, string> = {
      jordan: "Jordan Ellis",
      sam: "Sam Reyes",
    };
    const groups = groupSharedRocksByOwner(
      rocks,
      (id) => (id ? names[id] ?? "—" : "—"),
    );
    assert.equal(groups.length, 2);
    assert.equal(groups[0].title, "Shared by Jordan Ellis");
    assert.equal(groups[0].rocks.length, 2);
    assert.equal(groups[1].title, "Shared by Sam Reyes");
    assert.equal(groups[1].rocks.length, 1);
  });
});

describe("partitionSharedRocks", () => {
  const roster = new Set(["sam", "jordan"]);

  test("owner on the roster merges into their own section", () => {
    const mine = { team_id: "esd", owner_id: "sam" };
    const theirs = { team_id: "esd", owner_id: "cora" };
    const { ownerOnRoster, sharedBy } = partitionSharedRocks(
      [mine, theirs],
      roster,
    );
    assert.deepEqual(ownerOnRoster, [mine]);
    assert.deepEqual(sharedBy, [theirs]);
  });

  test("an ownerless legacy rock has no section to merge into", () => {
    const legacy = { team_id: "esd", owner_id: null };
    const { ownerOnRoster, sharedBy } = partitionSharedRocks([legacy], roster);
    assert.deepEqual(ownerOnRoster, []);
    assert.deepEqual(sharedBy, [legacy]);
  });

  test("keeps input order within each side", () => {
    const a = { team_id: "esd", owner_id: "sam" };
    const b = { team_id: "esd", owner_id: "cora" };
    const c = { team_id: "esd", owner_id: "jordan" };
    const { ownerOnRoster } = partitionSharedRocks([a, b, c], roster);
    assert.deepEqual(ownerOnRoster, [a, c]);
  });
});

describe("blockMilestones (spec §4)", () => {
  const roster = new Set(["joe", "sam", "jordan"]);
  const rock = { team_id: "esd", owner_id: "jordan" };
  const ms = [
    { id: "m1", owner_id: "joe" },
    { id: "m2", owner_id: "joe" },
    { id: "m3", owner_id: "cora" },
    { id: "m4", owner_id: null },
    { id: "m5", owner_id: "jordan" },
  ];

  test("each member on the roster carries their own milestones", () => {
    const got = blockMilestones(rock, "ops", roster, ms);
    assert.deepEqual(got.get("joe")?.map((m) => m.id), ["m1", "m2"]);
    assert.equal(got.has("cora"), false, "not on this roster");
  });

  test("parent-team members' milestones show too (no parent exclusion)", () => {
    // jordan owns the rock and sits on ESD and Ops: the rock shows in his
    // Ops block. A leader sets it Private to stop that.
    const got = blockMilestones(rock, "ops", roster, ms);
    assert.deepEqual(got.get("jordan")?.map((m) => m.id), ["m5"]);
  });

  test("unassigned milestones show in no block", () => {
    const got = blockMilestones(rock, "ops", roster, ms);
    assert.ok([...got.values()].flat().every((m) => m.owner_id));
  });

  test("never on the parent team's own page", () => {
    assert.equal(blockMilestones(rock, "esd", roster, ms).size, 0);
  });

  test("a private rock reaches no block", () => {
    assert.equal(blockMilestones({ ...rock, private: true }, "ops", roster, ms).size, 0);
    assert.equal(blockMilestones({ ...rock, team_only: true }, "ops", roster, ms).size, 0);
  });

  test("an audience team gets no blocks: the full rock is already on the page", () => {
    const shared = { ...rock, audience_team_ids: ["ops"] };
    assert.equal(blockMilestones(shared, "ops", roster, ms).size, 0);
    // Legacy field, same answer until migration.
    const legacy = { ...rock, shared_team_ids: ["ops"] };
    assert.equal(blockMilestones(legacy, "ops", roster, ms).size, 0);
    // A different audience team changes nothing for Ops.
    const other = { ...rock, audience_team_ids: ["hr"] };
    assert.deepEqual(blockMilestones(other, "ops", roster, ms).get("joe")?.map((m) => m.id), ["m1", "m2"]);
  });
});

describe("sharingChanges (save review)", () => {
  const base: SharingSnapshot = {
    parentTeamId: "esd",
    private: false,
    audienceTeamIds: [],
    audienceUserIds: [],
    milestones: {
      a: { title: "Kickoff", ownerId: "jordan", ownerName: "Jordan", ownerTeamIds: ["esd"] },
    },
  };
  const joe = { ownerId: "joe", ownerName: "Joe", ownerTeamIds: ["ops"] };

  test("no change → nothing", () => {
    assert.deepEqual(sharingChanges(base, base), []);
  });

  test("a team joins the audience", () => {
    const after = { ...base, audienceTeamIds: ["ops"] };
    assert.deepEqual(sharingChanges(base, after), [{ kind: "team-added", teamId: "ops" }]);
  });

  test("a person joins the audience", () => {
    const after = { ...base, audienceUserIds: ["joe"] };
    assert.deepEqual(sharingChanges(base, after), [{ kind: "person-added", userId: "joe" }]);
  });

  test("an outside assignee sees only their milestone, and it reaches their block", () => {
    const after = {
      ...base,
      milestones: { ...base.milestones, b: { title: "Contract signed", ...joe } },
    };
    assert.deepEqual(sharingChanges(base, after), [
      {
        kind: "headline-only",
        ownerId: "joe",
        ownerName: "Joe",
        ownerTeamIds: ["ops"],
        titles: ["Contract signed"],
      },
      { kind: "block-added", teamId: "ops", title: "Contract signed", ownerName: "Joe" },
    ]);
  });

  test("an assignee in the audience gets the whole rock, not a headline", () => {
    const after = {
      ...base,
      audienceUserIds: ["joe"],
      milestones: { ...base.milestones, b: { title: "Contract signed", ...joe } },
    };
    const kinds = sharingChanges(base, after).map((c) => c.kind);
    assert.deepEqual(kinds, ["person-added", "block-added"]);
  });

  test("an assignee on an audience team: covered, no block", () => {
    const after = {
      ...base,
      audienceTeamIds: ["ops"],
      milestones: { ...base.milestones, b: { title: "Contract signed", ...joe } },
    };
    assert.deepEqual(sharingChanges(base, after), [{ kind: "team-added", teamId: "ops" }]);
  });

  test("a parent-team member on another team: block only", () => {
    const after = {
      ...base,
      milestones: {
        a: { ...base.milestones.a, ownerTeamIds: ["esd", "lead"] },
      },
    };
    assert.deepEqual(sharingChanges(base, after), [
      { kind: "block-added", teamId: "lead", title: "Kickoff", ownerName: "Jordan" },
    ]);
  });

  test("an unchanged outside assignee is not reported again", () => {
    const before = {
      ...base,
      milestones: { ...base.milestones, b: { title: "Contract signed", ...joe } },
    };
    assert.deepEqual(sharingChanges(before, before), []);
  });

  test("turning Private on lists who loses the rock", () => {
    const before = {
      ...base,
      audienceTeamIds: ["it"],
      audienceUserIds: ["cora"],
      milestones: {
        a: { ...base.milestones.a, ownerTeamIds: ["esd", "lead"] },
      },
    };
    const after = { ...before, private: true, audienceTeamIds: [], audienceUserIds: [] };
    assert.deepEqual(sharingChanges(before, after), [
      { kind: "private-on", teamIds: ["it"], userIds: ["cora"], blockTeamIds: ["lead"] },
    ]);
  });

  test("Private on a rock nobody else sees says nothing", () => {
    assert.deepEqual(sharingChanges(base, { ...base, private: true }), []);
  });
});

describe("sharingPicture (review shows everything, not just the change)", () => {
  const shared: SharingSnapshot = {
    parentTeamId: "esd",
    private: false,
    audienceTeamIds: ["it"],
    audienceUserIds: [],
    milestones: {
      a: { title: "Kickoff", ownerId: "jordan", ownerName: "Jordan", ownerTeamIds: ["esd"] },
      b: { title: "Vendor", ownerId: "joe", ownerName: "Joe", ownerTeamIds: ["ops"] },
    },
  };

  test("adding one person still lists the team already in the audience", () => {
    const after = { ...shared, audienceUserIds: ["sam"] };
    const changes = sharingChanges(shared, after);
    assert.deepEqual(changes, [{ kind: "person-added", userId: "sam" }]);
    const picture = sharingPicture(after);
    const keys = picture.map(sharingChangeKey);
    assert.ok(keys.includes("team:it"), "existing audience team");
    assert.ok(keys.includes("person:sam"), "the new person");
    assert.ok(keys.includes("headline:joe"), "existing assignee outside the audience");
    assert.ok(keys.includes("block:ops|Vendor|Joe"), "existing block");
    const isNew = new Set(changes.map(sharingChangeKey));
    assert.deepEqual(
      picture.filter((c) => isNew.has(sharingChangeKey(c))).map(sharingChangeKey),
      ["person:sam"],
    );
  });

  test("private: nothing beyond the parent team", () => {
    assert.deepEqual(sharingPicture({ ...shared, private: true, audienceTeamIds: [] }), [
      // Joe still sees his own milestone as an assignee.
      {
        kind: "headline-only",
        ownerId: "joe",
        ownerName: "Joe",
        ownerTeamIds: ["ops"],
        titles: ["Vendor"],
      },
    ]);
  });

  test("never reports private-on", () => {
    assert.ok(sharingPicture(shared).every((c) => c.kind !== "private-on"));
  });
});

describe("audienceRemovals", () => {
  const before: SharingSnapshot = {
    parentTeamId: "esd",
    private: false,
    audienceTeamIds: ["it", "ops"],
    audienceUserIds: ["sam"],
    milestones: {},
  };

  test("teams and persons dropped while still shared", () => {
    const after = { ...before, audienceTeamIds: ["it"], audienceUserIds: [] };
    assert.deepEqual(audienceRemovals(before, after), { teamIds: ["ops"], userIds: ["sam"] });
  });

  test("going private is private-on's job, not a removal", () => {
    const after = { ...before, private: true, audienceTeamIds: [], audienceUserIds: [] };
    assert.deepEqual(audienceRemovals(before, after), { teamIds: [], userIds: [] });
  });
});
