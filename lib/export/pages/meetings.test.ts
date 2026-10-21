import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import {
  adminExportDeps,
  auditRowsOf,
  exportDepsAs,
  ts,
} from "@/lib/test-support/export-deps";
import { EXPORT_ROW_CAP } from "../cap";
import { runExport } from "../run";
import { isRefusal } from "../types";
import { exportUrl, meetingsExportParams } from "../urls";
import {
  MEETINGS_COLUMNS,
  meetingsViewRows,
  parseMeetingsParams,
  type MeetingExportInput,
} from "./meetings";

const ms = (iso: string) => Date.parse(iso);

function meeting(id: string, over: Partial<MeetingExportInput> = {}): MeetingExportInput {
  return {
    id,
    started_at: ms("2026-10-01T14:00:00Z"),
    ended_at: ms("2026-10-01T15:30:00Z"),
    current_segment: "done",
    agenda_name: null,
    agenda_items: null,
    ...over,
  };
}

describe("meetings export — columns", () => {
  test("column snapshot (a change here changes every auditor file)", () => {
    assert.deepEqual(
      MEETINGS_COLUMNS.map((c) => [c.key, c.header, c.kind]),
      [
        ["started_at", "Started", "datetime"],
        ["ended_at", "Ended", "datetime"],
        ["status", "Status", "text"],
        ["duration_min", "Duration (min)", "number"],
        ["agenda_name", "Agenda", "text"],
        ["progress", "Summary", "text"],
        ["rating", "Average rating", "number"],
        ["id", "Meeting ID", "text"],
      ],
    );
  });
});

describe("meetings export — the page's view", () => {
  test("newest first; live meetings carry their step and no rating", () => {
    const rows = meetingsViewRows(
      [
        meeting("old", { started_at: ms("2026-09-01T14:00:00Z"), ended_at: ms("2026-09-01T14:00:20Z") }),
        meeting("live", {
          started_at: ms("2026-10-08T14:00:00Z"),
          ended_at: null,
          current_segment: "scorecard",
          agenda_name: " Weekly L10 ",
        }),
        meeting("mid"),
      ],
      new Map([
        ["old", 8.5],
        ["live", 9],
        ["mid", null],
      ]),
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.status, r.duration_min, r.agenda, r.rating]),
      [
        ["live", "Live", null, "Weekly L10", null],
        ["mid", "Completed", 90, "", null],
        // A 20-second run reads 1 min, as on the page.
        ["old", "Completed", 1, "", 8.5],
      ],
    );
    assert.match(rows[0].progress, /^In progress · Step \d+ of \d+ · Scorecard · Weekly L10$/);
    assert.equal(rows[1].progress, "Completed · 90 min");
  });

  test("params: the team only", () => {
    const qs = new URL(exportUrl("meetings", meetingsExportParams({ teamId: "t1" })), "https://x")
      .searchParams;
    assert.deepEqual(parseMeetingsParams(qs), { teamId: "t1" });
    assert.ok(isRefusal(parseMeetingsParams(new URLSearchParams())));
  });
});

/** `target` with `name` answered by `replace`; everything else passes through. */
function override<T extends object>(target: T, name: string, replace: unknown): T {
  return new Proxy(target, {
    get(t, k) {
      if (k === name) return replace;
      const v = Reflect.get(t, k, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

/**
 * The fake as a Firestore that records each read of
 * `meetings/{id}/effectiveness_scores` — this page's one per-row sub-read.
 */
function countingScores(fake: FakeFirestore) {
  const reads: string[] = [];
  const fs = fake.asFirestore();
  const counted = override(fs, "collection", (name: string) => {
    const col = fs.collection(name);
    if (name !== "meetings") return col;
    return override(col, "doc", (id: string) => {
      const ref = col.doc(id);
      return override(ref, "collection", (sub: string) => {
        if (sub === "effectiveness_scores") reads.push(id);
        return ref.collection(sub);
      });
    });
  });
  const deps = adminExportDeps(fake);
  const user = deps.user!;
  return {
    reads,
    deps: { ...deps, user: async () => ({ ...(await user())!, db: counted }) },
  };
}

describe("meetings export — through the core", () => {
  test("a member gets the team's meetings with average ratings, as Mountain-time text", async () => {
    const db = new FakeFirestore();
    db.seed("teams", "t1", { name: "Leadership" });
    db.seed("teams", "t2", { name: "Ops" });
    db.seed("team_members", "t1__u1", { team_id: "t1", user_id: "u1", role: "member" });
    db.seed("meetings", "m1", {
      team_id: "t1",
      started_at: ts("2026-10-01T14:00:00Z"),
      ended_at: ts("2026-10-01T15:00:00Z"),
      current_segment: "done",
      agenda_name: "Level 10",
    });
    db.seed("meetings/m1/effectiveness_scores", "u1", { rating: 8 });
    db.seed("meetings/m1/effectiveness_scores", "u2", { rating: 9 });
    db.seed("meetings", "m2", { team_id: "t2", current_segment: "done" });
    const res = await runExport(
      "meetings",
      new URLSearchParams({ team: "t1" }),
      "csv",
      exportDepsAs(db, { uid: "u1" }),
    );
    assert.ok(res.ok);
    assert.deepEqual(res.table.headers, MEETINGS_COLUMNS.map((c) => c.header));
    assert.deepEqual(res.table.rows, [
      [
        // 14:00Z is 08:00 Mountain (MDT): the bank's clock, not the server's.
        // No zone text in the cell.
        "2026-10-01 08:00",
        "2026-10-01 09:00",
        "Completed",
        60,
        "Level 10",
        "Completed · 60 min · Level 10",
        8.5,
        "m1",
      ],
    ]);

    // An admin on no team gets the same history; someone off the roster
    // (u1 asking for t2) is refused before any meeting is read.
    const asAdmin = await runExport(
      "meetings",
      new URLSearchParams({ team: "t1" }),
      "csv",
      adminExportDeps(db),
    );
    assert.ok(asAdmin.ok);
    assert.deepEqual(asAdmin.table.rows.map((r) => r.at(-1)), ["m1"]);
    const spy = countingScores(db);
    const denied = await runExport("meetings", new URLSearchParams({ team: "t2" }), "csv", {
      ...spy.deps,
      user: exportDepsAs(db, { uid: "u1" }).user,
    });
    assert.equal(!denied.ok && denied.status, 404);
    assert.equal(!denied.ok && denied.reason, "no_page_access");
    assert.deepEqual(spy.reads, []);
    assert.deepEqual(
      auditRowsOf(db).map((r) => [r.outcome, r.actor_uid]),
      [
        ["ok", "u1"],
        ["ok", "admin"],
        ["refused", "u1"],
      ],
    );
  });

  test("a live meeting's scores are not read (its rating cell is blank)", async () => {
    const db = new FakeFirestore();
    db.seed("teams", "t1", { name: "Leadership" });
    db.seed("meetings", "done", {
      team_id: "t1",
      started_at: ts("2026-10-01T14:00:00Z"),
      ended_at: ts("2026-10-01T15:00:00Z"),
      current_segment: "done",
    });
    db.seed("meetings", "live", {
      team_id: "t1",
      started_at: ts("2026-10-08T14:00:00Z"),
      ended_at: null,
      current_segment: "scorecard",
    });
    db.seed("meetings/live/effectiveness_scores", "u1", { rating: 3 });
    const spy = countingScores(db);
    const res = await runExport("meetings", new URLSearchParams({ team: "t1" }), "csv", spy.deps);
    assert.ok(res.ok);
    assert.deepEqual(res.table.rows.map((r) => [r[7], r[6]]), [
      ["live", ""],
      ["done", ""],
    ]);
    assert.deepEqual(spy.reads, ["done"]);
  });

  test("an oversize history is refused after one capped query, before any ratings read", async () => {
    const db = new FakeFirestore();
    db.seed("teams", "t1", { name: "Leadership" });
    for (let i = 0; i <= EXPORT_ROW_CAP; i++) {
      db.seed("meetings", `m${i}`, {
        team_id: "t1",
        started_at: ts("2026-10-01T14:00:00Z"),
        ended_at: ts("2026-10-01T15:00:00Z"),
        current_segment: "done",
      });
    }
    const spy = countingScores(db);
    const res = await runExport("meetings", new URLSearchParams({ team: "t1" }), "csv", spy.deps);
    assert.equal(res.ok === false && res.status, 413);
    assert.equal(res.ok === false && res.reason, "over_cap");
    assert.equal(spy.reads.length, 0);
  });
});
