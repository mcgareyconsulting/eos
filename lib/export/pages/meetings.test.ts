import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { adminExportDeps, ts } from "@/lib/test-support/export-deps";
import { runExport } from "../run";
import { isRefusal } from "../types";
import { exportUrls, meetingsExportParams } from "../urls";
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
    const qs = new URL(exportUrls("meetings", meetingsExportParams({ teamId: "t1" })).xlsx, "https://x")
      .searchParams;
    assert.deepEqual(parseMeetingsParams(qs), { teamId: "t1" });
    assert.ok(isRefusal(parseMeetingsParams(new URLSearchParams())));
  });
});

describe("meetings export — through the core", () => {
  test("the team's meetings with average ratings", async () => {
    const db = new FakeFirestore();
    db.seed("teams", "t1", { name: "Leadership" });
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
      "xlsx",
      adminExportDeps(db),
    );
    assert.ok(res.ok);
    assert.deepEqual(res.table.rows, [
      [
        "2026-10-01 09:00 CDT",
        "2026-10-01 10:00 CDT",
        "Completed",
        60,
        "Level 10",
        "Completed · 60 min · Level 10",
        8.5,
        "m1",
      ],
    ]);
  });
});
