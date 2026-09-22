import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  groupSharedRocksByOwner,
  isSharedIntoTeam,
  sharedBySectionTitle,
  canSetRockStatus,
  partitionSharedRocks,
  rockAccessFor,
  isMilestoneLocked,
  hasFullRockView,
  assignmentCarriers,
  canTickMilestone,
  sharingChanges,
  carriersForViewer,
} from "./rocks-share";

describe("isSharedIntoTeam", () => {
  test("false for the parent team even if listed", () => {
    assert.equal(
      isSharedIntoTeam(
        { team_id: "esd", owner_id: "jordan", shared_team_ids: ["esd", "it"] },
        "esd",
      ),
      false,
    );
  });

  test("true when this team is a guest", () => {
    assert.equal(
      isSharedIntoTeam(
        { team_id: "esd", owner_id: "jordan", shared_team_ids: ["it"] },
        "it",
      ),
      true,
    );
  });

  test("false when not in the share list", () => {
    assert.equal(
      isSharedIntoTeam(
        { team_id: "esd", owner_id: "jordan", shared_team_ids: ["it"] },
        "lead",
      ),
      false,
    );
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
      { team_id: "esd", owner_id: "jordan", title: "A", shared_team_ids: ["it"] },
      { team_id: "esd", owner_id: "sam", title: "B", shared_team_ids: ["it"] },
      { team_id: "esd", owner_id: "jordan", title: "C", shared_team_ids: ["it"] },
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

describe("canSetRockStatus", () => {
  const rock = {
    team_id: "esd",
    owner_id: "sam",
    shared_team_ids: ["transformation"],
  };

  test("anyone on the rock's own team", () => {
    assert.equal(canSetRockStatus(rock, "esd", "sam"), true);
    assert.equal(canSetRockStatus(rock, "esd", "jordan"), true);
  });

  test("the owner, from a team it is shared into", () => {
    assert.equal(canSetRockStatus(rock, "transformation", "sam"), true);
  });

  test("not other members of the guest team", () => {
    assert.equal(canSetRockStatus(rock, "transformation", "jordan"), false);
  });

  test("not a signed-out / unknown viewer", () => {
    assert.equal(canSetRockStatus(rock, "transformation", null), false);
  });

  test("not a team the rock was never shared into", () => {
    assert.equal(canSetRockStatus(rock, "leadership", "sam"), false);
  });

  test("an ownerless rock is never writable from a guest team", () => {
    assert.equal(
      canSetRockStatus({ ...rock, owner_id: null }, "transformation", "sam"),
      false,
    );
    // …but still writable from its own team (department rocks have no owner).
    assert.equal(
      canSetRockStatus({ ...rock, owner_id: null }, "esd", "sam"),
      true,
    );
  });

  test("tolerates a missing shared_team_ids field", () => {
    assert.equal(
      canSetRockStatus(
        { team_id: "esd", owner_id: "sam" },
        "transformation",
        "sam",
      ),
      false,
    );
  });
});

describe("rockAccessFor", () => {
  const rock = {
    team_id: "esd",
    owner_id: "sam",
    shared_team_ids: ["transformation"],
  };
  const viewer = (uid: string | null, ...teamIds: string[]) => ({
    uid,
    isAdmin: false,
    teamIds: new Set(teamIds),
  });

  test("parent-team member gets edit wherever the rock renders", () => {
    assert.equal(rockAccessFor(rock, viewer("jordan", "esd")), "edit");
    // Also on a guest team — access follows the viewer, not the page.
    assert.equal(
      rockAccessFor(rock, viewer("jordan", "esd", "transformation")),
      "edit",
    );
  });

  test("org admin gets edit with no roster at all", () => {
    assert.equal(
      rockAccessFor(rock, { uid: "ops", isAdmin: true, teamIds: new Set() }),
      "edit",
    );
  });

  test("the owner on a guest team only, status", () => {
    assert.equal(rockAccessFor(rock, viewer("sam", "transformation")), "status");
  });

  test("other guest-team members read", () => {
    assert.equal(rockAccessFor(rock, viewer("jordan", "transformation")), "read");
  });

  test("the owner on a team the rock was never shared into reads", () => {
    assert.equal(rockAccessFor(rock, viewer("sam", "leadership")), "read");
  });

  test("signed-out viewer reads", () => {
    assert.equal(rockAccessFor(rock, viewer(null, "transformation")), "read");
  });

  test("tolerates a missing shared_team_ids field", () => {
    assert.equal(
      rockAccessFor({ team_id: "esd", owner_id: "sam" }, viewer("sam", "it")),
      "read",
    );
  });
});

describe("partitionSharedRocks", () => {
  const roster = new Set(["sam", "jordan"]);

  test("owner on the roster merges into their own section", () => {
    const mine = { team_id: "esd", owner_id: "sam", shared_team_ids: ["it"] };
    const theirs = { team_id: "esd", owner_id: "cora", shared_team_ids: ["it"] };
    const { ownerOnRoster, sharedBy } = partitionSharedRocks(
      [mine, theirs],
      roster,
    );
    assert.deepEqual(ownerOnRoster, [mine]);
    assert.deepEqual(sharedBy, [theirs]);
  });

  test("an ownerless legacy rock has no section to merge into", () => {
    const legacy = { team_id: "esd", owner_id: null, shared_team_ids: ["it"] };
    const { ownerOnRoster, sharedBy } = partitionSharedRocks([legacy], roster);
    assert.deepEqual(ownerOnRoster, []);
    assert.deepEqual(sharedBy, [legacy]);
  });

  test("keeps input order within each side", () => {
    const a = { team_id: "esd", owner_id: "sam", shared_team_ids: ["it"] };
    const b = { team_id: "esd", owner_id: "cora", shared_team_ids: ["it"] };
    const c = { team_id: "esd", owner_id: "jordan", shared_team_ids: ["it"] };
    const { ownerOnRoster } = partitionSharedRocks([a, b, c], roster);
    assert.deepEqual(ownerOnRoster, [a, c]);
  });
});

describe("isMilestoneLocked", () => {
  test("team_hidden or legacy private", () => {
    assert.equal(isMilestoneLocked({ owner_id: "a", team_hidden: true }), true);
    assert.equal(isMilestoneLocked({ owner_id: "a", visibility: "private" }), true);
    assert.equal(isMilestoneLocked({ owner_id: "a", visibility: "team" }), false);
  });
});

describe("hasFullRockView", () => {
  const rock = { team_id: "esd", owner_id: "owner", shared_team_ids: ["it"] };
  const v = (uid: string, teams: string[], isAdmin = false) => ({
    uid,
    isAdmin,
    teamIds: new Set(teams),
  });
  test("parent team, shared team, admin", () => {
    assert.equal(hasFullRockView(rock, v("x", ["esd"]), []), true);
    assert.equal(hasFullRockView(rock, v("x", ["it"]), []), true);
    assert.equal(hasFullRockView(rock, v("x", [], true), []), true);
  });
  test("any assignee on the rock, locked or not", () => {
    assert.equal(
      hasFullRockView(rock, v("joe", ["ops"]), [{ owner_id: "joe", team_hidden: true }]),
      true,
    );
  });
  test("the rock's owner, even off the parent team", () => {
    assert.equal(hasFullRockView(rock, v("owner", ["ops"]), []), true);
  });
  test("a teammate of the assignee does not", () => {
    assert.equal(
      hasFullRockView(rock, v("sam", ["ops"]), [{ owner_id: "joe" }]),
      false,
    );
  });
});

describe("assignmentCarriers", () => {
  const rock = { team_id: "esd", owner_id: "owner", shared_team_ids: ["it"] };
  const ms = [
    { id: "1", owner_id: "joe" },
    { id: "2", owner_id: "joe", team_hidden: true },
    { id: "3", owner_id: "sam" },
    { id: "4", owner_id: "other" },
  ];
  test("each carrier on the roster gets their unlocked milestones", () => {
    const got = assignmentCarriers(rock, "ops", new Set(["joe", "sam"]), ms, new Set());
    assert.deepEqual([...got.keys()], ["joe", "sam"]);
    assert.deepEqual(got.get("joe")!.map((m) => m.id), ["1"]);
    assert.deepEqual(got.get("sam")!.map((m) => m.id), ["3"]);
  });
  test("only locked milestones → the team does not see the rock", () => {
    const got = assignmentCarriers(rock, "ops", new Set(["joe"]), [ms[1]], new Set());
    assert.equal(got.size, 0);
  });
  test("keep on this team: nothing travels", () => {
    const got = assignmentCarriers(
      { ...rock, team_only: true },
      "ops",
      new Set(["joe", "sam"]),
      ms,
      new Set(),
    );
    assert.equal(got.size, 0);
  });
  test("full wins: parent or shared team gets no assignment view", () => {
    assert.equal(assignmentCarriers(rock, "esd", new Set(["joe"]), ms, new Set()).size, 0);
    assert.equal(assignmentCarriers(rock, "it", new Set(["joe"]), ms, new Set()).size, 0);
  });
  test("a parent-team member's milestones don't travel to their other teams", () => {
    const got = assignmentCarriers(rock, "ops", new Set(["joe"]), ms, new Set(["joe"]));
    assert.equal(got.size, 0);
  });
});

describe("canTickMilestone", () => {
  const rock = { team_id: "esd", owner_id: "rockOwner", shared_team_ids: ["it"] };
  test("full access ticks anything", () => {
    assert.equal(canTickMilestone(rock, { owner_id: "x" }, { uid: "p", fullAccess: true }), true);
  });
  test("otherwise: own milestone, or a rock you own", () => {
    assert.equal(canTickMilestone(rock, { owner_id: "casey" }, { uid: "casey", fullAccess: false }), true);
    assert.equal(canTickMilestone(rock, { owner_id: "casey" }, { uid: "sam", fullAccess: false }), false);
    assert.equal(canTickMilestone(rock, { owner_id: "casey" }, { uid: "rockOwner", fullAccess: false }), true);
  });
});

describe("sharingChanges", () => {
  const m = (ownerId: string, ownerTeamIds: string[], locked = false, title = "Vendor") => ({
    title,
    locked,
    ownerId,
    ownerName: ownerId,
    ownerTeamIds,
  });
  const snap = (teams: string[], milestones: Record<string, ReturnType<typeof m>>) => ({
    parentTeamId: "esd",
    teams,
    milestones,
  });

  test("no change → nothing", () => {
    const s = snap(["it"], { a: m("joe", ["ops"]) });
    assert.deepEqual(sharingChanges(s, s), []);
  });
  test("sharing a team", () => {
    assert.deepEqual(sharingChanges(snap([], {}), snap(["it"], {})), [
      { kind: "team-added", teamId: "it" },
    ]);
  });
  test("assigning outside: the person gets the rock, their teams the milestone", () => {
    assert.deepEqual(
      sharingChanges(snap([], {}), snap([], { a: m("joe", ["ops", "it"]) })),
      [
        { kind: "assignee-added", ownerId: "joe", ownerName: "joe" },
        { kind: "milestone-to-team", teamId: "ops", title: "Vendor", ownerName: "joe" },
        { kind: "milestone-to-team", teamId: "it", title: "Vendor", ownerName: "joe" },
      ],
    );
  });
  test("locked: the person still gets the rock, their teams nothing", () => {
    assert.deepEqual(
      sharingChanges(snap([], {}), snap([], { a: m("joe", ["ops"], true) })),
      [{ kind: "assignee-added", ownerId: "joe", ownerName: "joe" }],
    );
  });
  test("unlocking reports the team once", () => {
    assert.deepEqual(
      sharingChanges(
        snap([], { a: m("joe", ["ops"], true) }),
        snap([], { a: m("joe", ["ops"]) }),
      ),
      [{ kind: "milestone-to-team", teamId: "ops", title: "Vendor", ownerName: "joe" }],
    );
  });
  test("keep on this team: the assignee still gets the rock, teams nothing", () => {
    const after = { ...snap([], { a: m("joe", ["ops"]) }), teamOnly: true };
    assert.deepEqual(sharingChanges(snap([], {}), after), [
      { kind: "assignee-added", ownerId: "joe", ownerName: "joe" },
    ]);
  });
  test("turning keep-on-team off lets milestones travel", () => {
    const before = { ...snap([], { a: m("joe", ["ops"]) }), teamOnly: true };
    const after = snap([], { a: m("joe", ["ops"]) });
    assert.deepEqual(sharingChanges(before, after), [
      { kind: "milestone-to-team", teamId: "ops", title: "Vendor", ownerName: "joe" },
    ]);
  });
  test("parent-team assignee on other teams: nothing travels", () => {
    assert.deepEqual(
      sharingChanges(snap([], {}), snap([], { a: m("dan", ["esd", "ops"]) })),
      [],
    );
  });
  test("assignee on a shared team is covered by the share", () => {
    assert.deepEqual(
      sharingChanges(snap(["ops"], {}), snap(["ops"], { a: m("joe", ["ops"]) })),
      [],
    );
  });
  test("unsharing a team that still carries a milestone", () => {
    assert.deepEqual(
      sharingChanges(
        snap(["ops"], { a: m("joe", ["ops"]) }),
        snap([], { a: m("joe", ["ops"]) }),
      ),
      [
        { kind: "assignee-added", ownerId: "joe", ownerName: "joe" },
        { kind: "still-sees", teamId: "ops", titles: ["Vendor"] },
      ],
    );
  });
});

describe("carriersForViewer", () => {
  const rock = { team_id: "esd", owner_id: "owner", shared_team_ids: [] };
  const ms = [
    { id: "1", owner_id: "joe" },
    { id: "2", owner_id: "joe", team_hidden: true },
    { id: "3", owner_id: "sam" },
  ];
  const roster = new Set(["joe", "sam"]);
  test("joe sees his locked milestone too, flagged only-you", () => {
    const got = carriersForViewer(rock, "ops", roster, ms, new Set(), "joe");
    assert.deepEqual(got.carriers.get("joe")!.map((m) => m.id), ["1", "2"]);
    assert.deepEqual([...got.onlyViewerIds], ["2"]);
    assert.equal(got.viewerOnlyRow, false);
  });
  test("sam sees only what travels", () => {
    const got = carriersForViewer(rock, "ops", roster, ms, new Set(), "sam");
    assert.deepEqual(got.carriers.get("joe")!.map((m) => m.id), ["1"]);
    assert.equal(got.onlyViewerIds.size, 0);
  });
  test("a row that exists only for the viewer", () => {
    const got = carriersForViewer(rock, "ops", roster, [ms[1]], new Set(), "joe");
    assert.deepEqual(got.carriers.get("joe")!.map((m) => m.id), ["2"]);
    assert.equal(got.viewerOnlyRow, true);
  });
  test("keep on this team: the viewer still gets their own, all only-you", () => {
    const got = carriersForViewer(
      { ...rock, team_only: true },
      "ops",
      roster,
      ms,
      new Set(),
      "joe",
    );
    assert.deepEqual([...got.onlyViewerIds].sort(), ["1", "2"]);
    assert.equal(got.viewerOnlyRow, true);
  });
  test("a parent-team member gets nothing extra", () => {
    const got = carriersForViewer(rock, "ops", roster, ms, new Set(["joe"]), "joe");
    assert.equal(got.carriers.has("joe"), false);
  });
});
