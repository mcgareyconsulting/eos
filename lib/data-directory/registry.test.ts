import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EXPECTED_HEADERS } from "@/lib/import-headers";
import {
  DATA_TYPES,
  DATA_TYPE_BY_KEY,
  DENYLISTED_COLLECTIONS,
  toIso,
  type Doc,
  type RowContext,
} from "./registry";

const ctx: RowContext = {
  teamName: (id) => (id ? `Team ${id}` : "—"),
  ownerName: (id) => (id ? `User ${id}` : "No Owner"),
  metric: (id) => (id ? { name: `Metric ${id}`, team_id: "t1" } : null),
};

function row(key: string, doc: Omit<Doc, "id"> & { id?: string }) {
  const def = DATA_TYPE_BY_KEY.get(key as never)!;
  return def.toRow({ id: "x1", ...doc } as Doc, ctx);
}

describe("export ↔ import contract", () => {
  // This is what keeps the two halves of /data from drifting: every column the
  // export writes for an importable type must be a column the importer knows.
  test("importable types emit only EXPECTED_HEADERS columns", () => {
    for (const def of DATA_TYPES) {
      if (!def.importKind) continue;
      const spec = EXPECTED_HEADERS[def.importKind];
      const known = new Set([...spec.required, ...spec.optional]);
      for (const col of def.columns) {
        assert.ok(
          known.has(col.header),
          `${def.key}: "${col.header}" is not an import column for kind "${def.importKind}"`,
        );
      }
    }
  });

  test("required import columns are all exported", () => {
    for (const def of DATA_TYPES) {
      if (!def.importKind) continue;
      const emitted = new Set(def.columns.map((c) => c.header));
      for (const header of EXPECTED_HEADERS[def.importKind].required) {
        assert.ok(
          emitted.has(header),
          `${def.key}: required import column "${header}" is not exported`,
        );
      }
    }
  });

  test("rock status exports in the importer's vocabulary", () => {
    const status = DATA_TYPE_BY_KEY.get("rocks")!.columns.find(
      (c) => c.header === "Status",
    )!;
    assert.equal(status.get({ id: "r", status: "done" } as Doc, ctx), "Complete");
    assert.equal(status.get({ id: "r", status: "off_track" } as Doc, ctx), "Off Track");
  });

  test("private to-dos round trip as Private, not as a dropped column", () => {
    const vis = DATA_TYPE_BY_KEY.get("todos")!.columns.find(
      (c) => c.header === "Visibility",
    )!;
    assert.equal(vis.get({ id: "t", visibility: "private" } as Doc, ctx), "Private");
    assert.equal(vis.get({ id: "t", visibility: "team" } as Doc, ctx), "Public");
  });
});

describe("state normalization", () => {
  test("a legacy issue archived via the boolean reads as archived", () => {
    assert.equal(row("issues", { archived: true, status: "open" }).state, "archived");
  });

  test("a modern issue archived via archived_at reads as archived", () => {
    assert.equal(
      row("issues", { archived_at: new Date(), status: "open" }).state,
      "archived",
    );
  });

  test("issue status maps onto the shared lifecycle", () => {
    assert.equal(row("issues", { status: "solved" }).state, "done");
    assert.equal(row("issues", { status: "dropped" }).state, "cancelled");
    assert.equal(row("issues", { status: "solving" }).state, "active");
  });

  // The F4 backfill gap, pinned: a legacy import with no archived_at field at
  // all counts as Active. The page says so out loud rather than pretending.
  test("a doc with no archive field at all counts as active", () => {
    assert.equal(row("rocks", { status: "on_track" }).state, "active");
    assert.equal(row("todos", {}).state, "active");
  });

  test("rock and to-do lifecycles", () => {
    assert.equal(row("rocks", { status: "done" }).state, "done");
    assert.equal(row("rocks", { status: "cancelled" }).state, "cancelled");
    assert.equal(row("rocks", { status: "done", archived_at: new Date() }).state, "archived");
    assert.equal(row("todos", { completed_at: new Date() }).state, "done");
  });
});

describe("owners", () => {
  test("an unassigned rock is No Owner, not a blank cell", () => {
    const r = row("rocks", { owner_id: null, rock_type: "department" });
    assert.equal(r.ownerId, null);
    assert.equal(r.owner, "No Owner");
  });

  test("headlines carry their author, memberships their subject", () => {
    assert.equal(row("headlines", { created_by: "u9" }).ownerId, "u9");
    assert.equal(row("team_members", { user_id: "u9", team_id: "t1" }).ownerId, "u9");
  });

  test("types with no owner concept render a dash, not No Owner", () => {
    assert.equal(row("meetings", { team_id: "t1" }).owner, "—");
    assert.equal(row("agendas", { team_id: "t1", name: "Weekly" }).owner, "—");
  });
});

describe("indirect team resolution", () => {
  test("a scorecard entry takes its team from its metric", () => {
    const r = row("scorecard_entries", {
      metric_id: "m1",
      week_start_date: "2026-09-07",
      value: 12,
    });
    assert.equal(r.teamId, "t1");
    assert.match(r.title, /Metric m1/);
  });
});

describe("safety", () => {
  test("no registry type reads a denylisted collection", () => {
    for (const def of DATA_TYPES) {
      assert.ok(
        !(def.collection in DENYLISTED_COLLECTIONS),
        `${def.key} reads denylisted collection ${def.collection}`,
      );
    }
  });

  test("the token-bearing collections stay on the denylist", () => {
    assert.ok("google_tasks_connections" in DENYLISTED_COLLECTIONS);
    assert.ok("oauth_csrf_states" in DENYLISTED_COLLECTIONS);
    assert.ok("users" in DENYLISTED_COLLECTIONS);
  });
});

describe("toIso", () => {
  test("accepts Firestore Timestamps, Dates, date strings and null", () => {
    assert.equal(toIso(null), "");
    assert.equal(toIso(undefined), "");
    assert.equal(toIso("2026-09-07"), "2026-09-07T00:00:00.000Z");
    assert.equal(toIso(new Date("2026-09-07T12:00:00Z")), "2026-09-07T12:00:00.000Z");
    assert.equal(
      toIso({ toDate: () => new Date("2026-09-07T12:00:00Z") }),
      "2026-09-07T12:00:00.000Z",
    );
  });

  test("an unparseable value is empty, never Invalid Date", () => {
    assert.equal(toIso("not a date"), "");
    assert.equal(toIso({}), "");
  });
});
