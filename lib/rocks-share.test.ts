import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  groupSharedRocksByOwner,
  isSharedIntoTeam,
  sharedBySectionTitle,
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

