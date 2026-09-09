import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_METRIC_SHARES,
  addShare,
  canArchiveMetric,
  canDeleteMetric,
  canEditMetricValues,
  isArchivedMetric,
  isHomeTeam,
  isOnScorecard,
  isSharedIntoTeam,
  metricGroupForTeam,
  removeShare,
} from "./scorecard-share";

const home = { team_id: "leadership", shared_team_ids: ["it", "esd"] };

describe("isSharedIntoTeam", () => {
  test("true for a team in the share list", () => {
    assert.equal(isSharedIntoTeam(home, "it"), true);
  });

  test("false for a team not in the list", () => {
    assert.equal(isSharedIntoTeam(home, "ops"), false);
  });

  // A home team that somehow lists itself must not be treated as borrowing,
  // or the row would offer Hide as a way to detach a measurable from the
  // scorecard that owns it.
  test("false for the home team even if it lists itself", () => {
    assert.equal(
      isSharedIntoTeam(
        { team_id: "leadership", shared_team_ids: ["leadership"] },
        "leadership",
      ),
      false,
    );
  });

  test("missing share list is not a share", () => {
    assert.equal(isSharedIntoTeam({ team_id: "leadership" }, "it"), false);
    assert.equal(
      isSharedIntoTeam({ team_id: "leadership", shared_team_ids: null }, "it"),
      false,
    );
  });
});

describe("isHomeTeam / isOnScorecard", () => {
  test("home team owns it", () => {
    assert.equal(isHomeTeam(home, "leadership"), true);
    assert.equal(isHomeTeam(home, "it"), false);
  });

  test("on the scorecard by either route", () => {
    assert.equal(isOnScorecard(home, "leadership"), true);
    assert.equal(isOnScorecard(home, "it"), true);
    assert.equal(isOnScorecard(home, "ops"), false);
  });
});

describe("canEditMetricValues", () => {
  test("home team may write its own numbers", () => {
    assert.equal(
      canEditMetricValues({ metric: home, teamId: "leadership", isAdmin: false }),
      true,
    );
  });

  // The rule the whole feature turns on: borrowing buys a read, not a pen.
  test("borrowing team may not", () => {
    assert.equal(
      canEditMetricValues({ metric: home, teamId: "it", isAdmin: false }),
      false,
    );
  });

  test("admin may, from a borrowing team", () => {
    assert.equal(
      canEditMetricValues({ metric: home, teamId: "it", isAdmin: true }),
      true,
    );
  });
});

describe("isArchivedMetric", () => {
  test("a timestamp means archived", () => {
    assert.equal(isArchivedMetric({ team_id: "x", archived_at: new Date() }), true);
  });

  test("null or missing means active", () => {
    assert.equal(isArchivedMetric({ team_id: "x", archived_at: null }), false);
    assert.equal(isArchivedMetric({ team_id: "x" }), false);
  });
});

// Archive and delete share one gate, so the same table drives both. If these
// two ever need separate cases, the gate has drifted apart and that is the
// bug — not the test.
describe("canArchiveMetric / canDeleteMetric", () => {
  const owned = { ...home, owner_id: "brian" };

  for (const [label, fn] of [
    ["archive", canArchiveMetric],
    ["delete", canDeleteMetric],
  ] as const) {
    describe(label, () => {
      test("the owner may", () => {
        assert.equal(
          fn({ metric: owned, teamId: "leadership", uid: "brian", isAdmin: false }),
          true,
        );
      });

      test("an org admin may", () => {
        assert.equal(
          fn({ metric: owned, teamId: "leadership", uid: "steph", isAdmin: true }),
          true,
        );
      });

      // The narrowing decided 2026-09-09: being on the home team is no longer
      // enough on its own.
      test("a non-owner member of the home team may not", () => {
        assert.equal(
          fn({ metric: owned, teamId: "leadership", uid: "jenna", isAdmin: false }),
          false,
        );
      });

      // Hide is the borrowing team's action. Reaching this from a borrowed row
      // would take the measurable off every scorecard at once.
      test("not from a borrowing team, even as owner", () => {
        assert.equal(
          fn({ metric: owned, teamId: "it", uid: "brian", isAdmin: false }),
          false,
        );
      });

      test("not from a borrowing team, even as admin", () => {
        assert.equal(
          fn({ metric: owned, teamId: "it", uid: "steph", isAdmin: true }),
          false,
        );
      });

      // An ownerless measurable must not become everybody's to destroy.
      test("an unowned measurable is admin-only", () => {
        const unowned = { ...home, owner_id: null };
        assert.equal(
          fn({ metric: unowned, teamId: "leadership", uid: "brian", isAdmin: false }),
          false,
        );
        assert.equal(
          fn({ metric: unowned, teamId: "leadership", uid: "steph", isAdmin: true }),
          true,
        );
      });
    });
  }
});

describe("addShare", () => {
  test("appends a new team", () => {
    const r = addShare({ team_id: "leadership", shared_team_ids: ["it"] }, "ops");
    assert.deepEqual(r, { ok: true, shared_team_ids: ["it", "ops"] });
  });

  test("idempotent for a team already sharing", () => {
    const r = addShare(home, "it");
    assert.deepEqual(r, { ok: true, shared_team_ids: ["it", "esd"] });
  });

  test("refuses the home team", () => {
    const r = addShare(home, "leadership");
    assert.equal(r.ok, false);
  });

  test("treats a missing list as empty", () => {
    const r = addShare({ team_id: "leadership" }, "it");
    assert.deepEqual(r, { ok: true, shared_team_ids: ["it"] });
  });

  // firestore.rules unrolls the membership check index by index. A ninth share
  // would be written happily by the Admin SDK and then be invisible to the
  // client listener, so the cap is refused here rather than half-applied.
  test("refuses past the rules cap", () => {
    const full = Array.from({ length: MAX_METRIC_SHARES }, (_, i) => `t${i}`);
    const r = addShare({ team_id: "leadership", shared_team_ids: full }, "one-too-many");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /at most/);
  });

  test("a team already in a full list is still accepted", () => {
    const full = Array.from({ length: MAX_METRIC_SHARES }, (_, i) => `t${i}`);
    const r = addShare({ team_id: "leadership", shared_team_ids: full }, "t0");
    assert.equal(r.ok, true);
  });
});

describe("removeShare", () => {
  test("drops just that team", () => {
    assert.deepEqual(removeShare(home, "it"), ["esd"]);
  });

  test("idempotent for a team not sharing", () => {
    assert.deepEqual(removeShare(home, "ops"), ["it", "esd"]);
  });

  test("missing list stays empty", () => {
    assert.deepEqual(removeShare({ team_id: "leadership" }, "it"), []);
  });
});

describe("metricGroupForTeam", () => {
  const shared = {
    team_id: "transformation",
    shared_team_ids: ["leadership"],
    group: "Customer",
    shared_groups: { leadership: "Growth" },
  };

  test("home team reads its own group", () => {
    assert.equal(metricGroupForTeam(shared, "transformation"), "Customer");
  });

  test("borrowing team reads its own choice", () => {
    assert.equal(metricGroupForTeam(shared, "leadership"), "Growth");
  });

  // The home team's section describes their scorecard, not yours. Carrying it
  // across would invent a section the borrowing team never made.
  test("borrowing team does not inherit the home group", () => {
    assert.equal(
      metricGroupForTeam(
        { team_id: "transformation", shared_team_ids: ["leadership"], group: "Customer" },
        "leadership",
      ),
      null,
    );
  });

  test("unset reads as null so the caller applies the cadence default", () => {
    assert.equal(metricGroupForTeam({ team_id: "t" }, "t"), null);
    assert.equal(
      metricGroupForTeam({ team_id: "t", group: "   " }, "t"),
      null,
    );
  });
});
