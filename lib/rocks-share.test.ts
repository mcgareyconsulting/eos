import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  groupSharedRocksByOwner,
  isSharedIntoTeam,
  sharedBySectionTitle,
  canSetRockStatus,
  partitionSharedRocks,
  rockAccessFor,
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
