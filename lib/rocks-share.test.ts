import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  groupSharedRocksByOwner,
  isSharedIntoTeam,
  sharedBySectionTitle,
  canSetRockStatus,
} from "./rocks-share";

describe("isSharedIntoTeam", () => {
  test("false for the parent team even if listed", () => {
    assert.equal(
      isSharedIntoTeam(
        { team_id: "esd", owner_id: "joe", shared_team_ids: ["esd", "it"] },
        "esd",
      ),
      false,
    );
  });

  test("true when this team is a guest", () => {
    assert.equal(
      isSharedIntoTeam(
        { team_id: "esd", owner_id: "joe", shared_team_ids: ["it"] },
        "it",
      ),
      true,
    );
  });

  test("false when not in the share list", () => {
    assert.equal(
      isSharedIntoTeam(
        { team_id: "esd", owner_id: "joe", shared_team_ids: ["it"] },
        "lead",
      ),
      false,
    );
  });
});

describe("sharedBySectionTitle", () => {
  test("uses the person owner, not a team name", () => {
    assert.equal(sharedBySectionTitle("Steph Benes"), "Shared by Steph Benes");
  });
});

describe("groupSharedRocksByOwner", () => {
  test("groups at the bottom by owner first+last", () => {
    const rocks = [
      { team_id: "esd", owner_id: "joe", title: "A", shared_team_ids: ["it"] },
      { team_id: "esd", owner_id: "steph", title: "B", shared_team_ids: ["it"] },
      { team_id: "esd", owner_id: "joe", title: "C", shared_team_ids: ["it"] },
    ];
    const names: Record<string, string> = {
      joe: "Joe Creighton",
      steph: "Steph Benes",
    };
    const groups = groupSharedRocksByOwner(
      rocks,
      (id) => (id ? names[id] ?? "—" : "—"),
    );
    assert.equal(groups.length, 2);
    assert.equal(groups[0].title, "Shared by Joe Creighton");
    assert.equal(groups[0].rocks.length, 2);
    assert.equal(groups[1].title, "Shared by Steph Benes");
    assert.equal(groups[1].rocks.length, 1);
  });
});


describe("canSetRockStatus", () => {
  const rock = {
    team_id: "esd",
    owner_id: "steph",
    shared_team_ids: ["transformation"],
  };

  test("anyone on the rock's own team", () => {
    assert.equal(canSetRockStatus(rock, "esd", "steph"), true);
    assert.equal(canSetRockStatus(rock, "esd", "joe"), true);
  });

  test("the owner, from a team it is shared into", () => {
    assert.equal(canSetRockStatus(rock, "transformation", "steph"), true);
  });

  test("not other members of the guest team", () => {
    assert.equal(canSetRockStatus(rock, "transformation", "joe"), false);
  });

  test("not a signed-out / unknown viewer", () => {
    assert.equal(canSetRockStatus(rock, "transformation", null), false);
  });

  test("not a team the rock was never shared into", () => {
    assert.equal(canSetRockStatus(rock, "leadership", "steph"), false);
  });

  test("an ownerless rock is never writable from a guest team", () => {
    assert.equal(
      canSetRockStatus({ ...rock, owner_id: null }, "transformation", "steph"),
      false,
    );
    // …but still writable from its own team (department rocks have no owner).
    assert.equal(
      canSetRockStatus({ ...rock, owner_id: null }, "esd", "steph"),
      true,
    );
  });

  test("tolerates a missing shared_team_ids field", () => {
    assert.equal(
      canSetRockStatus(
        { team_id: "esd", owner_id: "steph" },
        "transformation",
        "steph",
      ),
      false,
    );
  });
});
