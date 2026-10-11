import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import {
  computeTeamIds,
  planBackfill,
  planTeamIdsSync,
  syncUserTeamIds,
  syncUsersTeamIds,
} from "./membership";

function seedMembership(db: FakeFirestore, teamId: string, userId: string, role = "member") {
  db.seed("team_members", `${teamId}__${userId}`, { team_id: teamId, user_id: userId, role });
}

describe("computeTeamIds", () => {
  test("unique, sorted, ignores rows without a string team_id", () => {
    assert.deepEqual(
      computeTeamIds([
        { team_id: "t2" },
        { team_id: "t1" },
        { team_id: "t2" },
        { team_id: "" },
        { team_id: 7 },
        {},
        undefined,
      ]),
      ["t1", "t2"],
    );
  });
});

describe("planTeamIdsSync", () => {
  test("missing field → write", () => {
    assert.deepEqual(planTeamIdsSync({ display_name: "A" }, [{ team_id: "t1" }]), {
      kind: "write",
      before: null,
      after: ["t1"],
    });
  });

  test("same set in canonical order → unchanged", () => {
    const plan = planTeamIdsSync({ team_ids: ["t1", "t2"] }, [{ team_id: "t2" }, { team_id: "t1" }]);
    assert.equal(plan.kind, "unchanged");
  });

  test("same set, out of order → rewritten to canonical form", () => {
    const plan = planTeamIdsSync({ team_ids: ["t2", "t1"] }, [{ team_id: "t1" }, { team_id: "t2" }]);
    assert.deepEqual(plan, { kind: "write", before: ["t2", "t1"], after: ["t1", "t2"] });
  });

  test("removed from last team → write []", () => {
    assert.deepEqual(planTeamIdsSync({ team_ids: ["t1"] }, []), {
      kind: "write",
      before: ["t1"],
      after: [],
    });
  });

  test("no profile → never written", () => {
    assert.deepEqual(planTeamIdsSync(undefined, [{ team_id: "t1" }]), {
      kind: "no-profile",
      after: ["t1"],
    });
  });
});

describe("syncUserTeamIds", () => {
  test("writes the recomputed list and keeps other profile fields", async () => {
    const db = new FakeFirestore();
    db.seed("users", "u1", { display_name: "Ann", team_ids: ["stale"] });
    seedMembership(db, "t2", "u1", "leader");
    seedMembership(db, "t1", "u1");
    seedMembership(db, "t3", "u2");

    const plan = await syncUserTeamIds(db.asFirestore(), "u1");
    assert.equal(plan.kind, "write");
    assert.deepEqual(db.raw("users/u1"), { display_name: "Ann", team_ids: ["t1", "t2"] });
  });

  test("does not create a profile that does not exist", async () => {
    const db = new FakeFirestore();
    seedMembership(db, "t1", "ghost");
    const plan = await syncUserTeamIds(db.asFirestore(), "ghost");
    assert.equal(plan.kind, "no-profile");
    assert.equal(db.raw("users/ghost"), undefined);
  });

  test("after a removal the team drops out", async () => {
    const db = new FakeFirestore();
    db.seed("users", "u1", { team_ids: ["t1", "t2"] });
    seedMembership(db, "t1", "u1");
    const plan = await syncUserTeamIds(db.asFirestore(), "u1");
    assert.deepEqual(plan, { kind: "write", before: ["t1", "t2"], after: ["t1"] });
    assert.deepEqual(db.raw("users/u1")?.team_ids, ["t1"]);
  });

  test("syncUsersTeamIds dedupes and skips empty uids", async () => {
    const db = new FakeFirestore();
    db.seed("users", "u1", {});
    db.seed("users", "u2", {});
    seedMembership(db, "t1", "u1");
    seedMembership(db, "t1", "u2");
    const out = await syncUsersTeamIds(db.asFirestore(), ["u1", "u2", "u1", ""]);
    assert.deepEqual([...out.keys()], ["u1", "u2"]);
    assert.deepEqual(db.raw("users/u2")?.team_ids, ["t1"]);
  });
});

describe("planBackfill", () => {
  test("covers every profile and flags rostered uids without one", () => {
    const plans = planBackfill(
      [
        { id: "u1", data: { team_ids: ["t1"] } },
        { id: "u2", data: {} },
        { id: "u3", data: { team_ids: ["t9"] } },
      ],
      [
        { team_id: "t1", user_id: "u1" },
        { team_id: "t1", user_id: "u2" },
        { team_id: "t2", user_id: "u2" },
        { team_id: "t1", user_id: "orphan" },
      ],
    );
    assert.deepEqual(
      plans.map((p) => [p.uid, p.plan.kind, p.plan.after]),
      [
        ["orphan", "no-profile", ["t1"]],
        ["u1", "unchanged", ["t1"]],
        ["u2", "write", ["t1", "t2"]],
        ["u3", "write", []],
      ],
    );
  });
});
