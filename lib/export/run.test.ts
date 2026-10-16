import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { viewerOf } from "@/lib/access/types";
import { readXlsx } from "@/lib/xlsx";
import { recordDataExport, type DataExportInput } from "./audit";
import {
  AUDIT_FAILED,
  EXPORT_ROW_CAP,
  NOT_ADMIN,
  NOT_SIGNED_IN,
  UNKNOWN_EXPORT,
  overCapMessage,
  runExport,
  type RunExportDeps,
} from "./run";
import { EXPORT_DEFINITIONS } from "./registry";
import { writeXlsx } from "./xlsx-writer";
import type { ExportDefinition } from "./types";

function seed() {
  const db = new FakeFirestore();
  db.seed("teams", "t1", { name: "Leadership", speaking_order: ["u2", "u1"] });
  db.seed("team_members", "t1__u1", { team_id: "t1", user_id: "u1", role: "member" });
  db.seed("team_members", "t1__u2", { team_id: "t1", user_id: "u2", role: "leader" });
  db.seed("users", "u1", { display_name: "Ada Lovelace" });
  db.seed("users", "u2", { first_name: "Grace", last_name: "Hopper" });
  db.seed("users", "u3", { display_name: "Off Roster" });
  db.seed("todos", "a", {
    team_id: "t1",
    title: '=HYPERLINK("https://evil.example","x")',
    description: "**Call** the vendor",
    owner_id: "u1",
    due_date: "2026-10-20",
    completed_at: null,
    visibility: "team",
    source_rock_id: null,
    created_by: "u2",
  });
  return db;
}

function admin(db: FakeFirestore, uid = "admin") {
  return async () => ({
    uid,
    email: "admin@highplainsbank.com",
    name: "Org Admin",
    isAdmin: true,
    db: db.asFirestore(),
  });
}

function deps(db: FakeFirestore, extra: Partial<RunExportDeps> = {}): RunExportDeps {
  return {
    user: admin(db),
    viewer: async (_db, uid, isAdmin) => viewerOf(uid, isAdmin, [], []),
    now: () => new Date("2026-10-16T19:05:00Z"),
    env: { DEPLOYMENT_ID: "b0ba525-build1" },
    ...extra,
  };
}

const todosParams = () => new URLSearchParams({ team: "t1" });

describe("runExport — admin gate", () => {
  test("a signed-in non-admin is refused before anything is loaded or recorded", async () => {
    const db = seed();
    let recorded = 0;
    let loaded = 0;
    const spy: ExportDefinition<never, never> = {
      id: "todos",
      title: "Spy",
      parseParams: () => ({}) as never,
      load: async () => {
        loaded += 1;
        return { ok: true, rows: [], filters: [], teamId: null, fileNameParts: [] };
      },
      columns: [],
    };
    const res = await runExport("todos", todosParams(), "xlsx", {
      ...deps(db),
      user: async () => ({ ...(await admin(db)()), uid: "u1", isAdmin: false }),
      record: async () => {
        recorded += 1;
      },
      definitions: { todos: spy },
    });
    assert.deepEqual(res, { ok: false, status: 403, message: NOT_ADMIN });
    assert.equal(loaded, 0);
    assert.equal(recorded, 0);
    assert.equal(db.docsIn("audit_log").length, 0);
  });

  test("no session → 401", async () => {
    const res = await runExport("todos", todosParams(), "xlsx", {
      ...deps(seed()),
      user: async () => null,
    });
    assert.deepEqual(res, { ok: false, status: 401, message: NOT_SIGNED_IN });
  });

  test("unknown export ids: 404 for an admin, still 403 for a non-admin", async () => {
    const db = seed();
    const a = await runExport("nope", todosParams(), "xlsx", deps(db));
    assert.deepEqual(a, { ok: false, status: 404, message: UNKNOWN_EXPORT });
    const n = await runExport("nope", todosParams(), "xlsx", {
      ...deps(db),
      user: async () => ({ ...(await admin(db)()), isAdmin: false }),
    });
    assert.equal(n.ok === false && n.status, 403);
    // Prototype keys are not export ids.
    const p = await runExport("constructor", todosParams(), "xlsx", deps(db));
    assert.equal(p.ok === false && p.status, 404);
  });
});

describe("runExport — every registered page", () => {
  test("each page is refused to a non-admin, with nothing loaded or recorded", async () => {
    const db = seed();
    const ids = Object.keys(EXPORT_DEFINITIONS);
    assert.deepEqual(ids.sort(), [
      "directory",
      "headlines",
      "issues",
      "meetings",
      "rocks",
      "scorecard",
      "todos",
    ]);
    for (const id of ids) {
      let loaded = 0;
      const real = EXPORT_DEFINITIONS[id] as unknown as ExportDefinition<unknown, unknown>;
      const spy = {
        ...real,
        load: async () => {
          loaded += 1;
          return { ok: true as const, rows: [], filters: [], teamId: null, fileNameParts: [] };
        },
      } as unknown as ExportDefinition<never, never>;
      const res = await runExport(id, new URLSearchParams({ team: "t1" }), "xlsx", {
        ...deps(db),
        user: async () => ({ ...(await admin(db)()), uid: "u1", isAdmin: false }),
        definitions: { [id]: spy },
      });
      assert.deepEqual(res, { ok: false, status: 403, message: NOT_ADMIN }, id);
      assert.equal(loaded, 0, id);
    }
    assert.equal(db.docsIn("audit_log").length, 0);
  });

  test("a view may carry its own columns (the Scorecard's periods)", async () => {
    const def: ExportDefinition<{ v: number }, Record<string, never>> = {
      id: "dyn",
      title: "Dynamic",
      parseParams: () => ({}),
      columns: [{ key: "fixed", header: "Fixed", kind: "text", value: () => "x" }],
      load: async () => ({
        ok: true,
        rows: [{ v: 3 }],
        filters: [],
        teamId: null,
        fileNameParts: [],
        columns: [
          { key: "fixed", header: "Fixed", kind: "text", value: () => "x" },
          { key: "p1", header: "Oct 2026", kind: "number", value: (r) => r.v, width: 9 },
        ],
      }),
    };
    const res = await runExport("dyn", new URLSearchParams(), "xlsx", {
      ...deps(seed()),
      definitions: { dyn: def as unknown as ExportDefinition<never, never> },
    });
    assert.ok(res.ok);
    assert.deepEqual(res.table.headers, ["Fixed", "Oct 2026"]);
    assert.deepEqual(res.table.widths, [16, 9]);
    assert.deepEqual(res.table.rows, [["x", 3]]);
  });
});

describe("runExport — to-dos, end to end", () => {
  test("provenance, normalized rows and one audit row", async () => {
    const db = seed();
    const res = await runExport("todos", todosParams(), "xlsx", deps(db));
    assert.ok(res.ok);
    const { table } = res;
    assert.equal(table.fileName, "hpb-pulse_todos_leadership_active_2026-10-16");
    assert.deepEqual(table.provenance, [
      { label: "Export", value: "HPB Pulse — To-Dos" },
      { label: "Exported by", value: "Org Admin <admin@highplainsbank.com>" },
      { label: "Exported at", value: "2026-10-16 14:05 CDT (America/Chicago)" },
      { label: "Filters applied", value: "Team: Leadership · View: Active · Owner: All owners" },
      { label: "Rows", value: "1" },
      { label: "App version", value: "b0ba525-build1" },
    ]);
    assert.deepEqual(table.rows, [
      [
        "Ada Lovelace",
        '=HYPERLINK("https://evil.example","x")',
        "Call the vendor",
        "2026-10-20",
        "Open",
        "",
        "",
        "Team",
        "No",
        "Grace Hopper",
        "a",
      ],
    ]);

    const audit = db.docsIn("audit_log");
    assert.equal(audit.length, 1);
    const row = audit[0].data;
    assert.equal(row.entity_type, "data_export");
    assert.equal(row.action, "data_export");
    assert.equal(row.entity_id, "todos");
    assert.equal(row.actor_uid, "admin");
    assert.equal(row.actor_source, "app");
    assert.equal(row.team_id, "t1");
    assert.deepEqual(row.export, {
      page: "todos",
      format: "xlsx",
      filters: { Team: "Leadership", View: "Active", Owner: "All owners" },
      row_count: 1,
      app_version: "b0ba525-build1",
    });
    assert.ok(row.timestamp, "server timestamp set");
  });

  test("the spreadsheet neutralizes the injected title", async () => {
    const res = await runExport("todos", todosParams(), "xlsx", deps(seed()));
    assert.ok(res.ok);
    const t = res.table;
    const [sheet] = readXlsx(
      writeXlsx({ sheetName: t.title, preamble: t.provenance, headers: t.headers, rows: t.rows }),
    );
    const dataRow = sheet.rows.at(-1)!;
    assert.equal(dataRow[1], `'=HYPERLINK("https://evil.example","x")`);
  });

  test("print format is audited as print", async () => {
    const db = seed();
    const res = await runExport("todos", todosParams(), "print", deps(db));
    assert.ok(res.ok);
    assert.equal((db.docsIn("audit_log")[0].data.export as { format: string }).format, "print");
  });

  test("off-roster user ids are resolved from /users", async () => {
    const db = seed();
    db.seed("todos", "b", {
      team_id: "t1",
      title: "Outside",
      owner_id: "u3",
      due_date: null,
      completed_at: null,
      visibility: "team",
      source_rock_id: null,
    });
    const res = await runExport("todos", todosParams(), "xlsx", deps(db));
    assert.ok(res.ok);
    assert.deepEqual(
      res.table.rows.map((r) => r[0]),
      ["Ada Lovelace", "Off Roster"],
    );
  });

  test("the audit write failing means no file", async () => {
    const res = await runExport("todos", todosParams(), "xlsx", {
      ...deps(seed()),
      record: async () => {
        throw new Error("unavailable");
      },
    });
    assert.deepEqual(res, { ok: false, status: 500, message: AUDIT_FAILED });
  });

  test("over the row cap: refused with a narrow-the-filters message, not truncated or audited", async () => {
    const db = seed();
    for (let i = 0; i < EXPORT_ROW_CAP; i++) {
      db.seed("todos", `bulk-${i}`, {
        team_id: "t1",
        title: `Bulk ${i}`,
        owner_id: "u2",
        due_date: null,
        completed_at: null,
        visibility: "team",
        source_rock_id: null,
      });
    }
    const res = await runExport("todos", todosParams(), "xlsx", deps(db));
    assert.deepEqual(res, { ok: false, status: 413, message: overCapMessage(EXPORT_ROW_CAP + 1) });
    assert.match(overCapMessage(5001), /5,001 rows.*5,000.*Narrow the filters/);
    assert.equal(db.docsIn("audit_log").length, 0);
  });

  test("a missing team is a 404 and is not audited", async () => {
    const db = seed();
    const res = await runExport("todos", new URLSearchParams({ team: "zz" }), "xlsx", deps(db));
    assert.equal(res.ok === false && res.status, 404);
    assert.equal(db.docsIn("audit_log").length, 0);
  });
});

describe("recordDataExport", () => {
  test("adds one row to audit_log", async () => {
    const db = new FakeFirestore();
    const input: DataExportInput = {
      actorUid: "a",
      exportId: "todos",
      teamId: null,
      format: "xlsx",
      filters: [],
      rowCount: 0,
      appVersion: "local build",
    };
    await recordDataExport(db.asFirestore(), input);
    assert.equal(db.docsIn("audit_log").length, 1);
  });
});
