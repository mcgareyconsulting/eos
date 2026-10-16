import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Firestore, Query } from "firebase-admin/firestore";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { viewerOf } from "@/lib/access/types";
import {
  REFUSED_DEDUPE_MS,
  recordDataExport,
  recordRefusedExport,
  refusedAuditDocId,
  type DataExportInput,
} from "./audit";
import { EXPORT_QUERY_LIMIT, readCapped } from "./cap";
import { todosExport, TODOS_COLUMNS } from "./pages/todos";
import { csvResponse } from "./response";
import {
  ACCOUNT_INACTIVE,
  AUDIT_FAILED,
  EXPORT_ROW_CAP,
  NOT_SIGNED_IN,
  UNKNOWN_EXPORT,
  overCapMessage,
  runExport,
  type RunExportDeps,
} from "./run";
import type { ExportDefinition } from "./types";

// 13:05 MDT.
const NOW = new Date("2026-10-16T19:05:00Z");

function todoDoc(over: Record<string, unknown>) {
  return {
    team_id: "t1",
    title: "x",
    description: null,
    owner_id: "u1",
    due_date: null,
    completed_at: null,
    archived_at: null,
    visibility: "team",
    source_rock_id: null,
    created_by: "u1",
    ...over,
  };
}

/**
 * Team t1 (Leadership): u1 (Ada, member), u2 (Grace, leader). Team t2
 * (Ops): u3 only. `admin` is on no team.
 */
function seed() {
  const db = new FakeFirestore();
  db.seed("teams", "t1", { name: "Leadership", speaking_order: ["u2", "u1"] });
  db.seed("teams", "t2", { name: "Ops" });
  db.seed("team_members", "t1__u1", { team_id: "t1", user_id: "u1", role: "member" });
  db.seed("team_members", "t1__u2", { team_id: "t1", user_id: "u2", role: "leader" });
  db.seed("team_members", "t2__u3", { team_id: "t2", user_id: "u3", role: "member" });
  db.seed("users", "u1", { display_name: "Ada Lovelace" });
  db.seed("users", "u2", { first_name: "Grace", last_name: "Hopper" });
  db.seed("users", "u3", { display_name: "Off Roster" });
  db.seed(
    "todos",
    "a",
    todoDoc({
      title: '=HYPERLINK("https://evil.example","x")',
      description: "**Call** the vendor, today",
      due_date: "2026-10-20",
      created_by: "u2",
    }),
  );
  return db;
}

/** The hidden items a member must never see in their file. */
function seedHidden(db: FakeFirestore) {
  // Grace's private to-do on t1: only Grace (and admins) see it on the list.
  db.seed(
    "todos",
    "grace-private",
    todoDoc({ title: "Grace private", owner_id: "u2", created_by: "u2", visibility: "private" }),
  );
  // Ada's own private to-do: she sees it.
  db.seed(
    "todos",
    "ada-private",
    todoDoc({ title: "Ada private", owner_id: "u1", created_by: "u1", visibility: "private" }),
  );
  // Another team's to-do.
  db.seed("todos", "ops-item", todoDoc({ team_id: "t2", title: "Ops item", owner_id: "u3" }));
}

function signedIn(
  db: FakeFirestore,
  uid: string,
  over: { isAdmin?: boolean; active?: boolean } = {},
): RunExportDeps["user"] {
  return async () => ({
    uid,
    isAdmin: over.isAdmin ?? false,
    active: over.active ?? true,
    db: db.asFirestore(),
  });
}

/** loadViewer's answer, from the fake's roster (lib/firebase/viewer.ts). */
async function fakeViewer(db: Firestore, uid: string, isAdmin: boolean) {
  const snap = await db.collection("team_members").where("user_id", "==", uid).get();
  const teams = snap.docs.map((d) => d.data().team_id as string);
  const leads = snap.docs.filter((d) => d.data().role === "leader").map((d) => d.data().team_id as string);
  return viewerOf(uid, isAdmin, teams, leads);
}

function deps(db: FakeFirestore, extra: Partial<RunExportDeps> = {}): RunExportDeps {
  return {
    user: signedIn(db, "admin", { isAdmin: true }),
    db: () => db.asFirestore(),
    viewer: fakeViewer,
    now: () => NOW,
    env: { DEPLOYMENT_ID: "b0ba525-build1" },
    ...extra,
  };
}

const todosParams = () => new URLSearchParams({ team: "t1" });

function auditRows(db: FakeFirestore) {
  return db.docsIn("audit_log").map((d) => d.data as Record<string, unknown>);
}

/** The to-dos definition with its loader counted. */
function spiedTodos() {
  const calls = { load: 0 };
  const def = {
    ...todosExport,
    load: async (...args: Parameters<typeof todosExport.load>) => {
      calls.load += 1;
      return todosExport.load(...args);
    },
  };
  return { calls, definitions: { todos: def as unknown as ExportDefinition<never, never> } };
}

function bulkTodos(db: FakeFirestore, n: number) {
  for (let i = 0; i < n; i++) {
    db.seed("todos", `bulk-${i}`, todoDoc({ title: `Bulk ${i}`, owner_id: "u2" }));
  }
}

const ids = (rows: (string | number)[][]) => rows.map((r) => r[TODOS_COLUMNS.length - 1]);

describe("runExport — who may export", () => {
  test("no session → 401, refused before any load, audited as anonymous", async () => {
    const db = seed();
    const { calls, definitions } = spiedTodos();
    const res = await runExport("todos", todosParams(), "csv", {
      ...deps(db),
      definitions,
      user: async () => null,
    });
    assert.deepEqual(res, { ok: false, status: 401, message: NOT_SIGNED_IN, reason: "not_signed_in" });
    assert.equal(calls.load, 0);
    const [row] = auditRows(db);
    assert.equal(row.actor_uid, null);
    assert.equal(row.outcome, "refused");
    assert.equal(row.reason, "not_signed_in");
    assert.equal(row.http_status, 401);
  });

  test("a disabled or deleted account is refused before any load", async () => {
    const db = seed();
    const { calls, definitions } = spiedTodos();
    const res = await runExport("todos", todosParams(), "csv", {
      ...deps(db),
      definitions,
      user: signedIn(db, "u1", { active: false }),
    });
    assert.deepEqual(res, {
      ok: false,
      status: 403,
      message: ACCOUNT_INACTIVE,
      reason: "account_inactive",
    });
    assert.equal(calls.load, 0);
    assert.equal(auditRows(db)[0].reason, "account_inactive");
  });

  test("someone who can't open the page is refused before any load, with the page's 404", async () => {
    const db = seed();
    const { calls, definitions } = spiedTodos();
    // u3 is on Ops, not Leadership.
    const res = await runExport("todos", todosParams(), "csv", {
      ...deps(db),
      definitions,
      user: signedIn(db, "u3"),
    });
    assert.equal(res.ok, false);
    assert.equal(!res.ok && res.status, 404);
    assert.equal(!res.ok && res.reason, "no_page_access");
    assert.equal(calls.load, 0);
    const [row] = auditRows(db);
    assert.equal(row.actor_uid, "u3");
    assert.equal(row.reason, "no_page_access");
    assert.equal(row.http_status, 404);
    assert.deepEqual(row.export, {
      page: "todos",
      format: "csv",
      filters: {},
      row_count: null,
      app_version: "b0ba525-build1",
      query: "team=t1",
      file_name: null,
    });
  });

  test("a missing team is the same 404, before any load", async () => {
    const db = seed();
    const { calls, definitions } = spiedTodos();
    const res = await runExport("todos", new URLSearchParams({ team: "zz" }), "csv", {
      ...deps(db),
      definitions,
    });
    assert.equal(!res.ok && res.status, 404);
    assert.equal(calls.load, 0);
  });

  test("a stale admin claim is not admin: the core trusts only the live one", async () => {
    // sessionUser() sets isAdmin from the account right now; a member whose
    // admin role was removed arrives here with isAdmin false.
    const db = seed();
    seedHidden(db);
    const res = await runExport("todos", todosParams(), "csv", {
      ...deps(db),
      user: signedIn(db, "u1", { isAdmin: false }),
    });
    assert.ok(res.ok);
    assert.ok(!ids(res.table.rows).includes("grace-private"));
  });

  test("unknown export ids are a 404; prototype keys are not export ids", async () => {
    const db = seed();
    const a = await runExport("nope", todosParams(), "csv", deps(db));
    assert.deepEqual(a, { ok: false, status: 404, message: UNKNOWN_EXPORT, reason: "unknown_export" });
    const p = await runExport("constructor", todosParams(), "csv", deps(db));
    assert.equal(!p.ok && p.status, 404);
  });

  test("bad parameters are a 400", async () => {
    const db = seed();
    const res = await runExport("todos", new URLSearchParams({ team: "../x" }), "csv", deps(db));
    assert.equal(!res.ok && res.status, 400);
    assert.equal(auditRows(db)[0].reason, "bad_params");
  });

  test("a refusal whose audit write fails is still the same refusal", async () => {
    const db = seed();
    const res = await runExport("todos", todosParams(), "csv", {
      ...deps(db),
      user: signedIn(db, "u3"),
      recordRefused: async () => {
        throw new Error("unavailable");
      },
    });
    assert.equal(!res.ok && res.status, 404);
  });
});

describe("runExport — scoped to what the viewer can see", () => {
  test("a member gets exactly their page: no one else's private to-do, no other team's", async () => {
    const db = seed();
    seedHidden(db);
    const res = await runExport("todos", todosParams(), "csv", {
      ...deps(db),
      user: signedIn(db, "u1"),
    });
    assert.ok(res.ok);
    // Owner cards in speaking order (Grace, then Ada); Grace has nothing Ada can see.
    assert.deepEqual(ids(res.table.rows), ["a", "ada-private"]);
  });

  test("a leader doesn't see a member's private to-do either", async () => {
    const db = seed();
    seedHidden(db);
    const res = await runExport("todos", todosParams(), "csv", {
      ...deps(db),
      user: signedIn(db, "u2"),
    });
    assert.ok(res.ok);
    assert.deepEqual(ids(res.table.rows), ["grace-private", "a"]);
  });

  test("an admin still sees what admins see on the page — every private to-do — but never another team's", async () => {
    const db = seed();
    seedHidden(db);
    const res = await runExport("todos", todosParams(), "csv", deps(db));
    assert.ok(res.ok);
    assert.deepEqual(ids(res.table.rows), ["grace-private", "a", "ada-private"]);
  });

  test("every successful export is audited, for every user, never deduped", async () => {
    const db = seed();
    const member = { ...deps(db), user: signedIn(db, "u1") };
    assert.ok((await runExport("todos", todosParams(), "csv", member)).ok);
    assert.ok((await runExport("todos", todosParams(), "csv", member)).ok);
    const rows = auditRows(db);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.entity_type, "data_export");
      assert.equal(row.action, "data_export");
      assert.equal(row.entity_id, "todos");
      assert.equal(row.actor_uid, "u1");
      assert.equal(row.actor_source, "app");
      assert.equal(row.team_id, "t1");
      assert.equal(row.outcome, "ok");
      assert.equal(row.reason, null);
      assert.equal(row.http_status, 200);
      assert.deepEqual(row.export, {
        page: "todos",
        format: "csv",
        filters: { Team: "Leadership", View: "Active", Owner: "All owners" },
        row_count: 1,
        app_version: "b0ba525-build1",
        query: null,
        file_name: "todos-leadership-active-2026-10-16-1305-MT.csv",
      });
      assert.ok(row.timestamp, "server timestamp set");
    }
  });
});

describe("runExport — the file", () => {
  test("normalized rows; the CSV neutralizes injection and names the file", async () => {
    const db = seed();
    const res = await runExport("todos", todosParams(), "csv", deps(db));
    assert.ok(res.ok);
    assert.deepEqual(res.table.headers, TODOS_COLUMNS.map((c) => c.header));
    assert.deepEqual(res.table.rows, [
      [
        "Ada Lovelace",
        '=HYPERLINK("https://evil.example","x")',
        "Call the vendor, today",
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

    const http = csvResponse(res);
    assert.equal(http.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(
      http.headers.get("content-disposition"),
      'attachment; filename="todos-leadership-active-2026-10-16-1305-MT.csv"',
    );
    const text = Buffer.from(await http.arrayBuffer()).toString("utf8");
    assert.equal(
      text,
      "﻿Owner,To-do,Description,Due,Status,Completed,Archived,Visibility,Weekly focus,Assigned by,To-do ID\r\n" +
        `Ada Lovelace,"'=HYPERLINK(""https://evil.example"",""x"")","Call the vendor, today",2026-10-20,Open,,,Team,No,Grace Hopper,a\r\n`,
    );
  });

  test("archived view: completed and archived times are Mountain text", async () => {
    const db = seed();
    db.seed(
      "todos",
      "old",
      todoDoc({
        title: "Old",
        completed_at: new Date("2026-10-01T17:30:00Z"),
        archived_at: new Date("2026-10-02T03:00:00Z"),
      }),
    );
    const res = await runExport("todos", new URLSearchParams({ team: "t1", archived: "1" }), "csv", deps(db));
    assert.ok(res.ok);
    const [row] = res.table.rows;
    assert.equal(row[5], "2026-10-01 11:30");
    // 03:00Z on the 2nd is still the 1st in Denver.
    assert.equal(row[6], "2026-10-01 21:00");
    assert.equal(res.table.fileName, "todos-leadership-archived-2026-10-16-1305-MT.csv");
  });

  test("off-roster user ids are resolved from /users", async () => {
    const db = seed();
    db.seed("todos", "b", todoDoc({ title: "Outside", owner_id: "u3" }));
    const res = await runExport("todos", todosParams(), "csv", deps(db));
    assert.ok(res.ok);
    assert.deepEqual(
      res.table.rows.map((r) => r[0]),
      ["Ada Lovelace", "Off Roster"],
    );
  });

  test("the audit write failing means no file", async () => {
    const res = await runExport("todos", todosParams(), "csv", {
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
    const res = await runExport("todos", todosParams(), "csv", {
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
});

describe("refused attempts — deduped per (actor, export, reason, 10 minutes)", () => {
  test("a second identical refusal in the window writes no new row; a different reason does", async () => {
    const db = seed();
    const outsider = { ...deps(db), user: signedIn(db, "u3") };
    await runExport("todos", todosParams(), "csv", outsider);
    await runExport("todos", todosParams(), "csv", outsider);
    // Different team, same page, same reason: still the same key.
    await runExport("todos", new URLSearchParams({ team: "zz" }), "csv", outsider);
    assert.equal(auditRows(db).length, 1);

    await runExport("todos", new URLSearchParams({ team: "../x" }), "csv", outsider);
    assert.deepEqual(
      auditRows(db).map((r) => r.reason).sort(),
      ["bad_params", "no_page_access"],
    );
  });

  test("a different person, or the next window, gets its own row", async () => {
    const db = seed();
    await runExport("todos", todosParams(), "csv", { ...deps(db), user: signedIn(db, "u3") });
    await runExport("todos", todosParams(), "csv", { ...deps(db), user: signedIn(db, "u9") });
    assert.equal(auditRows(db).length, 2);
    const later = new Date(NOW.getTime() + REFUSED_DEDUPE_MS);
    await runExport("todos", todosParams(), "csv", {
      ...deps(db),
      user: signedIn(db, "u3"),
      now: () => later,
    });
    assert.equal(auditRows(db).length, 3);
  });

  test("anonymous attempts and made-up export ids share one key each", async () => {
    const db = seed();
    const anon = { ...deps(db), user: async () => null };
    await runExport("todos", todosParams(), "csv", anon);
    await runExport("todos", todosParams(), "csv", anon);
    assert.equal(auditRows(db).length, 1);
    for (const id of ["nope", "x1", "x2", "constructor"]) {
      await runExport(id, todosParams(), "csv", { ...deps(db), user: signedIn(db, "u1") });
    }
    const unknown = auditRows(db).filter((r) => r.reason === "unknown_export");
    assert.equal(unknown.length, 1);
    assert.equal(unknown[0].entity_id, "nope");
  });

  test("the doc id is a hash of the key plus the window; URL input never lands in it raw", () => {
    const id = refusedAuditDocId("u1", "todos", "no_page_access", NOW);
    assert.equal(id, refusedAuditDocId("u1", "todos", "no_page_access", new Date(NOW.getTime() + 1000)));
    assert.notEqual(id, refusedAuditDocId("u1", "todos", "bad_params", NOW));
    assert.notEqual(id, refusedAuditDocId(null, "todos", "no_page_access", NOW));
    assert.match(refusedAuditDocId("a/b", "../..", "x", NOW), /^data_export_refused__[0-9a-f]{40}__\d+$/);
  });

  test("recordRefusedExport says whether it wrote", async () => {
    const db = new FakeFirestore();
    const input = {
      actorUid: "u1",
      exportId: "todos",
      exportKey: "todos",
      teamId: null,
      format: "csv" as const,
      filters: [],
      rowCount: null,
      appVersion: "local build",
      reason: "bad_params",
      httpStatus: 400,
      query: "q".repeat(5000),
      now: NOW,
    };
    assert.equal(await recordRefusedExport(db.asFirestore(), input), true);
    assert.equal(await recordRefusedExport(db.asFirestore(), input), false);
    const [row] = auditRows(db);
    assert.equal(row.outcome, "refused");
    assert.equal(row.dedupe_window, "2026-10-16T19:00:00.000Z");
    assert.equal((row.export as { query: string }).query.length, 1000);
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
      authorize: async () => null,
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
    const res = await runExport("things", new URLSearchParams(), "csv", {
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
    const res = await runExport("things", new URLSearchParams(), "csv", {
      ...deps(db),
      definitions: cappedDef(counters),
    });
    assert.ok(res.ok);
    assert.equal(res.table.rows.length, EXPORT_ROW_CAP);
  });
});

describe("recordDataExport", () => {
  test("adds one row to audit_log", async () => {
    const db = new FakeFirestore();
    const input: DataExportInput = {
      actorUid: "a",
      exportId: "todos",
      teamId: null,
      format: "csv",
      filters: [],
      rowCount: 0,
      appVersion: "local build",
      fileName: "todos-2026-10-16-1305-MT.csv",
    };
    await recordDataExport(db.asFirestore(), input);
    const rows = auditRows(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, "ok");
    assert.equal((rows[0].export as { file_name: string }).file_name, "todos-2026-10-16-1305-MT.csv");
  });

  test("URL-shaped ids are truncated", async () => {
    const db = new FakeFirestore();
    await recordDataExport(db.asFirestore(), {
      actorUid: "a",
      exportId: "x".repeat(500),
      teamId: null,
      format: "csv",
      filters: [],
      rowCount: null,
      appVersion: "local build",
    });
    const [row] = auditRows(db);
    assert.equal((row.entity_id as string).length, 128);
  });
});
