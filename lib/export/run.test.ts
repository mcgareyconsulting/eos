import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Query } from "firebase-admin/firestore";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { viewerOf } from "@/lib/access/types";
import { readXlsx } from "@/lib/xlsx";
import { recordDataExport, type DataExportInput } from "./audit";
import { EXPORT_QUERY_LIMIT, readCapped } from "./cap";
import { todosExport } from "./pages/todos";
import { PRINT_TOKEN_COLLECTION, PRINT_TOKEN_TTL_MS } from "./print-token";
import { printPageAction } from "./response";
import {
  AUDIT_FAILED,
  EXPORT_ROW_CAP,
  NOT_ADMIN,
  NOT_SIGNED_IN,
  PRINT_LINK_INVALID,
  UNKNOWN_EXPORT,
  overCapMessage,
  runExport,
  runPrintExport,
  startPrintExport,
  type RunExportDeps,
} from "./run";
import { EXPORT_DEFINITIONS } from "./registry";
import { writeXlsx } from "./xlsx-writer";
import type { ExportDefinition } from "./types";

const NOW = new Date("2026-10-16T19:05:00Z");

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

function nonAdmin(db: FakeFirestore, uid = "u1") {
  return async () => ({ ...(await admin(db, uid)()), isAdmin: false });
}

function deps(db: FakeFirestore, extra: Partial<RunExportDeps> = {}): RunExportDeps {
  return {
    user: admin(db),
    viewer: async (_db, uid, isAdmin) => viewerOf(uid, isAdmin, [], []),
    now: () => NOW,
    env: { DEPLOYMENT_ID: "b0ba525-build1" },
    ...extra,
  };
}

const todosParams = () => new URLSearchParams({ team: "t1" });

function auditRows(db: FakeFirestore) {
  return db.docsIn("audit_log").map((d) => d.data as Record<string, unknown>);
}

function bulkTodos(db: FakeFirestore, n: number) {
  for (let i = 0; i < n; i++) {
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
}

describe("runExport — admin gate", () => {
  test("a signed-in non-admin is refused before anything is loaded; the attempt is audited", async () => {
    const db = seed();
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
      user: nonAdmin(db),
      definitions: { todos: spy },
    });
    assert.deepEqual(res, { ok: false, status: 403, message: NOT_ADMIN, reason: "not_admin" });
    assert.equal(loaded, 0);
    const rows = auditRows(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, "refused");
    assert.equal(rows[0].reason, "not_admin");
    assert.equal(rows[0].http_status, 403);
    assert.equal(rows[0].actor_uid, "u1");
    assert.equal(rows[0].entity_id, "todos");
    assert.deepEqual(rows[0].export, {
      page: "todos",
      format: "xlsx",
      filters: {},
      row_count: null,
      app_version: "b0ba525-build1",
      query: "team=t1",
    });
  });

  test("no session → 401, and nothing to audit (no actor)", async () => {
    const db = seed();
    const res = await runExport("todos", todosParams(), "xlsx", {
      ...deps(db),
      user: async () => null,
    });
    assert.deepEqual(res, { ok: false, status: 401, message: NOT_SIGNED_IN });
    assert.equal(auditRows(db).length, 0);
  });

  test("unknown export ids: 404 for an admin, still 403 for a non-admin; both audited", async () => {
    const db = seed();
    const a = await runExport("nope", todosParams(), "xlsx", deps(db));
    assert.deepEqual(a, { ok: false, status: 404, message: UNKNOWN_EXPORT, reason: "unknown_export" });
    const n = await runExport("nope", todosParams(), "xlsx", { ...deps(db), user: nonAdmin(db) });
    assert.equal(n.ok === false && n.status, 403);
    // Prototype keys are not export ids.
    const p = await runExport("constructor", todosParams(), "xlsx", deps(db));
    assert.equal(p.ok === false && p.status, 404);
    assert.deepEqual(
      auditRows(db).map((r) => [r.outcome, r.reason, r.http_status]),
      [
        ["refused", "unknown_export", 404],
        ["refused", "not_admin", 403],
        ["refused", "unknown_export", 404],
      ],
    );
  });

  test("a refusal whose audit write fails is still the same refusal", async () => {
    const res = await runExport("todos", todosParams(), "xlsx", {
      ...deps(seed()),
      user: nonAdmin(seed()),
      record: async () => {
        throw new Error("unavailable");
      },
    });
    assert.equal(res.ok === false && res.status, 403);
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
      { label: "Exported at", value: "2026-10-16 13:05 MDT (Mountain Time, America/Denver)" },
      { label: "Filters applied", value: "Team: Leadership · View: Active · Owner: All owners" },
      { label: "Rows", value: "1" },
      { label: "App version", value: "b0ba525-build1" },
      { label: "Times", value: "Dates and times are Mountain Time (America/Denver)" },
    ]);
    assert.deepEqual(table.rows, [
      [
        "Ada Lovelace",
        '=HYPERLINK("https://evil.example","x")',
        "Call the vendor",
        { kind: "date", serial: 46315, text: "2026-10-20" },
        "Open",
        "",
        "",
        "Team",
        "No",
        "Grace Hopper",
        "a",
      ],
    ]);

    const audit = auditRows(db);
    assert.equal(audit.length, 1);
    const row = audit[0];
    assert.equal(row.entity_type, "data_export");
    assert.equal(row.action, "data_export");
    assert.equal(row.entity_id, "todos");
    assert.equal(row.actor_uid, "admin");
    assert.equal(row.actor_source, "app");
    assert.equal(row.team_id, "t1");
    assert.equal(row.outcome, "ok");
    assert.equal(row.reason, null);
    assert.equal(row.http_status, 200);
    assert.deepEqual(row.export, {
      page: "todos",
      format: "xlsx",
      filters: { Team: "Leadership", View: "Active", Owner: "All owners" },
      row_count: 1,
      app_version: "b0ba525-build1",
      query: null,
    });
    assert.ok(row.timestamp, "server timestamp set");
  });

  test("the spreadsheet neutralizes the injected title and writes the due date as a date", async () => {
    const res = await runExport("todos", todosParams(), "xlsx", deps(seed()));
    assert.ok(res.ok);
    const t = res.table;
    const [sheet] = readXlsx(
      writeXlsx({ sheetName: t.title, preamble: t.provenance, headers: t.headers, rows: t.rows }),
    );
    const dataRow = sheet.rows.at(-1)!;
    assert.equal(dataRow[1], `'=HYPERLINK("https://evil.example","x")`);
    assert.equal(dataRow[3], "2026-10-20");
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

  test("over the row cap: refused by the loader, before name lookups; audited, never truncated", async () => {
    const db = seed();
    bulkTodos(db, EXPORT_ROW_CAP);
    let nameLookups = 0;
    const res = await runExport("todos", todosParams(), "xlsx", {
      ...deps(db),
      names: async () => {
        nameLookups += 1;
        return new Map();
      },
    });
    assert.deepEqual(res, {
      ok: false,
      status: 413,
      message: overCapMessage(EXPORT_ROW_CAP + 1),
      reason: "over_cap",
    });
    assert.match(overCapMessage(5001), /5,001 rows.*5,000.*Narrow the filters/);
    assert.equal(nameLookups, 0);
    const rows = auditRows(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, "refused");
    assert.equal(rows[0].reason, "over_cap");
    assert.equal(rows[0].http_status, 413);
  });

  test("a missing team is a 404, audited as refused", async () => {
    const db = seed();
    const res = await runExport("todos", new URLSearchParams({ team: "zz" }), "xlsx", deps(db));
    assert.equal(res.ok === false && res.status, 404);
    const [row] = auditRows(db);
    assert.equal(row.outcome, "refused");
    assert.equal(row.reason, "not_found");
    assert.equal(row.http_status, 404);
    assert.equal((row.export as { query: string }).query, "team=zz");
  });

  test("bad parameters are a 400, audited as refused", async () => {
    const db = seed();
    const res = await runExport("todos", new URLSearchParams({ team: "../x" }), "xlsx", deps(db));
    assert.equal(res.ok === false && res.status, 400);
    const [row] = auditRows(db);
    assert.equal(row.reason, "bad_params");
    assert.equal(row.http_status, 400);
  });
});

describe("row cap — early", () => {
  // A page whose query IS its view, with a per-row sub-read (like milestones
  // per rock).
  function cappedDef(counters: { subReads: number; limit?: number }) {
    const def: ExportDefinition<{ id: string }, null> = {
      id: "things",
      title: "Things",
      parseParams: () => null,
      async load({ db }) {
        const base = db.collection("things") as unknown as Query;
        const spied = {
          limit(n: number) {
            counters.limit = n;
            return base.limit(n);
          },
        } as unknown as Query;
        const read = await readCapped(spied);
        if (!read.ok) return read;
        for (const d of read.docs) {
          counters.subReads += 1;
          await db.collection("subs").doc(d.id).get();
        }
        return {
          ok: true,
          rows: read.docs.map((d) => ({ id: d.id })),
          filters: [],
          teamId: null,
          fileNameParts: [],
        };
      },
      columns: [{ key: "id", header: "ID", kind: "text", value: (r) => r.id }],
    };
    return { things: def as unknown as ExportDefinition<never, never> };
  }

  test("readCapped asks for cap + 1 and refuses before any sub-read", async () => {
    const db = seed();
    for (let i = 0; i < EXPORT_ROW_CAP + 50; i++) db.seed("things", `x${i}`, {});
    const counters = { subReads: 0 } as { subReads: number; limit?: number };
    const res = await runExport("things", new URLSearchParams(), "xlsx", {
      ...deps(db),
      definitions: cappedDef(counters),
    });
    assert.equal(counters.limit, EXPORT_QUERY_LIMIT);
    assert.equal(counters.subReads, 0);
    assert.deepEqual(res, {
      ok: false,
      status: 413,
      message: overCapMessage(null),
      reason: "over_cap",
    });
    assert.match(overCapMessage(null), /more than 5,000 rows/);
    assert.equal(auditRows(db)[0].reason, "over_cap");
  });

  test("exactly the cap fits", async () => {
    const db = seed();
    for (let i = 0; i < EXPORT_ROW_CAP; i++) db.seed("things", `x${i}`, {});
    const counters = { subReads: 0 };
    const res = await runExport("things", new URLSearchParams(), "xlsx", {
      ...deps(db),
      definitions: cappedDef(counters),
    });
    assert.ok(res.ok);
    assert.equal(res.table.rows.length, EXPORT_ROW_CAP);
  });
});

describe("print door — single-use token", () => {
  async function mint(db: FakeFirestore, extra: Partial<RunExportDeps> = {}, params = todosParams()) {
    const started = await startPrintExport("todos", params, { ...deps(db), ...extra });
    assert.ok(started.ok, "minted");
    return started.token;
  }

  test("a valid token renders once; the export is audited as print", async () => {
    const db = seed();
    const token = await mint(db);
    // Minting reads nothing and audits nothing: the export is the render.
    assert.equal(auditRows(db).length, 0);

    const first = await runPrintExport("todos", token, { crossSite: false }, deps(db));
    assert.ok(first.ok);
    assert.equal(printPageAction(first).kind, "sheet");
    const [row] = auditRows(db);
    assert.equal(row.outcome, "ok");
    assert.equal((row.export as { format: string }).format, "print");

    const again = await runPrintExport("todos", token, { crossSite: false }, deps(db));
    assert.deepEqual(again, {
      ok: false,
      status: 410,
      message: PRINT_LINK_INVALID,
      reason: "print_token_invalid",
    });
    assert.deepEqual(printPageAction(again), { kind: "message", message: PRINT_LINK_INVALID });
    assert.equal(auditRows(db).at(-1)!.reason, "print_token_invalid");
  });

  test("the view comes from the token, not the print URL", async () => {
    const db = seed();
    const token = await mint(db, {}, new URLSearchParams({ team: "t1", archived: "1" }));
    const res = await runPrintExport("todos", token, { crossSite: false }, deps(db));
    assert.ok(res.ok);
    assert.equal(
      res.table.provenance.find((l) => l.label === "Filters applied")?.value,
      "Team: Leadership · View: Archived · Owner: All owners",
    );
  });

  test("only the token's hash is stored, and spending it removes it", async () => {
    const db = seed();
    const token = await mint(db);
    const stored = db.docsIn(PRINT_TOKEN_COLLECTION);
    assert.equal(stored.length, 1);
    assert.notEqual(stored[0].id, token);
    assert.ok(!JSON.stringify(stored[0].data).includes(token));
    assert.equal(stored[0].data.uid, "admin");
    assert.equal(stored[0].data.export_id, "todos");
    assert.equal(stored[0].data.params, "team=t1");
    await runPrintExport("todos", token, { crossSite: false }, deps(db));
    assert.equal(db.docsIn(PRINT_TOKEN_COLLECTION).length, 0);
  });

  test("missing, garbage and expired tokens are refused and audited", async () => {
    const db = seed();
    const missing = await runPrintExport("todos", null, { crossSite: false }, deps(db));
    assert.equal(missing.ok === false && missing.reason, "print_token_missing");
    const junk = await runPrintExport("todos", "not-a-token", { crossSite: false }, deps(db));
    assert.equal(junk.ok === false && junk.reason, "print_token_invalid");

    const token = await mint(db);
    const late = new Date(NOW.getTime() + PRINT_TOKEN_TTL_MS + 1);
    const expired = await runPrintExport("todos", token, { crossSite: false }, {
      ...deps(db),
      now: () => late,
    });
    assert.equal(expired.ok === false && expired.status, 410);
    assert.equal(expired.ok === false && expired.reason, "print_token_expired");
    // Burned, not just rejected.
    assert.equal(db.docsIn(PRINT_TOKEN_COLLECTION).length, 0);

    assert.deepEqual(
      auditRows(db).map((r) => [r.outcome, r.reason, r.http_status, (r.export as { query: unknown }).query]),
      [
        ["refused", "print_token_missing", 410, null],
        ["refused", "print_token_invalid", 410, null],
        ["refused", "print_token_expired", 410, null],
      ],
    );
  });

  test("a token works only for the admin and the export it was minted for", async () => {
    const db = seed();
    const other = { ...todosExport, id: "other" } as unknown as ExportDefinition<never, never>;
    const definitions = {
      todos: todosExport as unknown as ExportDefinition<never, never>,
      other,
    };
    const t1 = await mint(db, { definitions });
    const otherAdmin = await runPrintExport("todos", t1, { crossSite: false }, {
      ...deps(db),
      definitions,
      user: admin(db, "admin2"),
    });
    assert.equal(otherAdmin.ok === false && otherAdmin.reason, "print_token_mismatch");

    const t2 = await mint(db, { definitions });
    const otherExport = await runPrintExport("other", t2, { crossSite: false }, {
      ...deps(db),
      definitions,
    });
    assert.equal(otherExport.ok === false && otherExport.reason, "print_token_mismatch");
  });

  test("a non-admin gets the 404, can't mint, and doesn't spend an admin's token", async () => {
    const db = seed();
    const token = await mint(db);
    const res = await runPrintExport("todos", token, { crossSite: false }, {
      ...deps(db),
      user: nonAdmin(db),
    });
    assert.equal(res.ok === false && res.status, 403);
    assert.deepEqual(printPageAction(res), { kind: "not_found" });
    assert.equal(db.docsIn(PRINT_TOKEN_COLLECTION).length, 1);

    const minted = await startPrintExport("todos", todosParams(), { ...deps(db), user: nonAdmin(db) });
    assert.equal(minted.ok === false && minted.status, 403);
    assert.equal(db.docsIn(PRINT_TOKEN_COLLECTION).length, 1);

    assert.deepEqual(
      auditRows(db).map((r) => [r.reason, (r.export as { format: string }).format]),
      [
        ["not_admin", "print"],
        ["not_admin", "print"],
      ],
    );
  });

  test("a cross-site navigation is refused without spending the token", async () => {
    const db = seed();
    const token = await mint(db);
    const res = await runPrintExport("todos", token, { crossSite: true }, deps(db));
    assert.equal(res.ok === false && res.reason, "cross_site");
    assert.equal(db.docsIn(PRINT_TOKEN_COLLECTION).length, 1);
    const ok = await runPrintExport("todos", token, { crossSite: false }, deps(db));
    assert.ok(ok.ok);
  });

  test("minting refuses bad parameters (audited) and an unknown page", async () => {
    const db = seed();
    const bad = await startPrintExport("todos", new URLSearchParams({ team: "../x" }), deps(db));
    assert.equal(bad.ok === false && bad.status, 400);
    const unknown = await startPrintExport("nope", todosParams(), deps(db));
    assert.equal(unknown.ok === false && unknown.status, 404);
    assert.equal(db.docsIn(PRINT_TOKEN_COLLECTION).length, 0);
    assert.deepEqual(
      auditRows(db).map((r) => r.reason),
      ["bad_params", "unknown_export"],
    );
  });

  test("no session at the print door → login", async () => {
    const res = await runPrintExport("todos", "x", { crossSite: false }, {
      ...deps(seed()),
      user: async () => null,
    });
    assert.deepEqual(printPageAction(res), { kind: "login" });
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
    const rows = auditRows(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, "ok");
  });

  test("refused rows truncate URL-shaped input", async () => {
    const db = new FakeFirestore();
    await recordDataExport(db.asFirestore(), {
      actorUid: "a",
      exportId: "x".repeat(500),
      teamId: null,
      format: "print",
      filters: [],
      rowCount: null,
      appVersion: "local build",
      outcome: "refused",
      reason: "unknown_export",
      httpStatus: 404,
      query: "q".repeat(5000),
    });
    const [row] = auditRows(db);
    assert.equal((row.entity_id as string).length, 128);
    assert.equal((row.export as { query: string }).query.length, 1000);
  });
});
