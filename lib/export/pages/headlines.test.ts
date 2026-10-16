import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Timestamp } from "firebase-admin/firestore";
import { viewerOf } from "@/lib/access/types";
import type { HeadlineDoc } from "@/lib/firestore-types";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import {
  adminExportDeps,
  auditRowsOf,
  exportDepsAs,
  ts,
} from "@/lib/test-support/export-deps";
import { runExport } from "../run";
import { isRefusal } from "../types";
import { exportUrl, teamListExportParams } from "../urls";
import { HEADLINES_COLUMNS, headlinesViewRows, parseHeadlinesParams } from "./headlines";

type Doc = HeadlineDoc & { id: string };

let clock = 0;
function headline(id: string, over: Partial<Doc> = {}): Doc {
  clock += 1;
  return {
    id,
    team_id: "t1",
    title: id,
    body: null,
    kind: "customer",
    created_by: "u1",
    // Later seeds are newer.
    created_at: ts(`2026-10-${String(clock).padStart(2, "0")}T12:00:00Z`) as unknown as Timestamp,
    ...over,
  };
}

const names = new Map([
  ["u1", "Ada"],
  ["u2", "Grace"],
  ["admin", "Org Admin"],
]);
const admin = viewerOf("admin", true, [], []);
const outsider = viewerOf("u9", false, ["t2"], []);

function view(
  list: Doc[],
  opts: { archived?: boolean; ownerFilter?: string; viewer?: typeof admin } = {},
) {
  return headlinesViewRows({
    headlines: list,
    viewer: opts.viewer ?? admin,
    archived: opts.archived ?? false,
    ownerFilter: opts.ownerFilter ?? "all",
    nameOf: (id) => names.get(id),
  }).map((h) => [h.section, h.id, h.owner_label]);
}

describe("headlines export — columns", () => {
  test("column snapshot (a change here changes every auditor file)", () => {
    assert.deepEqual(
      HEADLINES_COLUMNS.map((c) => [c.key, c.header, c.kind]),
      [
        ["section", "Section", "text"],
        ["title", "Headline", "text"],
        ["body", "Details", "richtext"],
        ["kind", "Category", "text"],
        ["owner", "Owner", "text"],
        ["from_label", "From", "text"],
        ["broadcast", "Org-wide copy", "boolean"],
        ["discussed", "Discussed", "boolean"],
        ["created_at", "Created", "datetime"],
        ["archived_at", "Archived", "datetime"],
        ["id", "Headline ID", "text"],
      ],
    );
  });
});

describe("headlines export — the page's view", () => {
  const all = [
    headline("ada-old"),
    headline("grace", { created_by: "u2" }),
    headline("cascade", { kind: "cascading" }),
    headline("mine", { created_by: "admin" }),
    headline("broadcast", { broadcast: true, created_by: null, from_label: "Exec" }),
    headline("gone", { created_by: "u7" }),
    headline("ada-new"),
    headline("closed", { archived_at: ts("2026-10-20T12:00:00Z") as unknown as Timestamp }),
  ];

  test("Active: owner groups in first-appearance order (newest first), No owner last, then Cascading", () => {
    assert.deepEqual(view(all), [
      ["Ada", "ada-new", "Ada"],
      ["Ada", "ada-old", "Ada"],
      // The page says "You"; the file names the person.
      ["Org Admin", "mine", "Org Admin"],
      ["Grace", "grace", "Grace"],
      ["No owner", "gone", "—"],
      ["Cascading", "broadcast", "Exec"],
      ["Cascading", "cascade", "Ada"],
    ]);
  });

  test("Archived: flat, newest first", () => {
    assert.deepEqual(view(all, { archived: true }), [["Archived", "closed", "Ada"]]);
  });

  test("owner filter is the creator", () => {
    assert.deepEqual(view(all, { ownerFilter: "u2" }), [["Grace", "grace", "Grace"]]);
  });

  test("never more than the page shows: another team's viewer gets nothing", () => {
    assert.deepEqual(view(all, { viewer: outsider }), []);
  });

  test("a deactivated creator's headline reads Unassigned", () => {
    assert.deepEqual(view([headline("x", { owner_unassigned: true })]), [
      ["Unassigned", "x", "Unassigned"],
    ]);
  });

  test("params round-trip", () => {
    const params = teamListExportParams({ teamId: "t1", showArchived: true, ownerFilter: "u2" });
    const qs = new URL(exportUrl("headlines", params), "https://x").searchParams;
    assert.deepEqual(parseHeadlinesParams(qs), { teamId: "t1", archived: true, owner: "u2" });
    assert.ok(isRefusal(parseHeadlinesParams(new URLSearchParams())));
  });
});

describe("headlines export — through the core", () => {
  function seed() {
    const db = new FakeFirestore();
    db.seed("teams", "t1", { name: "Leadership" });
    db.seed("teams", "t2", { name: "Ops" });
    db.seed("team_members", "t1__u1", { team_id: "t1", user_id: "u1", role: "member" });
    db.seed("team_members", "t2__u3", { team_id: "t2", user_id: "u3", role: "member" });
    db.seed("users", "u1", { display_name: "Ada Lovelace" });
    db.seed("headlines", "h1", { ...headline("h1"), body: "**Won** the account" });
    // Another team's employee headline: never in t1's file.
    db.seed("headlines", "h2", {
      ...headline("h2"),
      team_id: "t2",
      title: "Ops employee news",
      created_by: "u3",
    });
    return db;
  }

  for (const who of [
    { label: "a member", deps: (db: FakeFirestore) => exportDepsAs(db, { uid: "u1" }) },
    { label: "an admin on no team", deps: (db: FakeFirestore) => adminExportDeps(db) },
  ]) {
    test(`${who.label} gets the team's headlines with plain-text bodies, no other team's`, async () => {
      const db = seed();
      const res = await runExport(
        "headlines",
        new URLSearchParams({ team: "t1" }),
        "csv",
        who.deps(db),
      );
      assert.ok(res.ok);
      assert.deepEqual(res.table.headers, HEADLINES_COLUMNS.map((c) => c.header));
      assert.equal(res.table.rows.length, 1);
      assert.deepEqual(res.table.rows[0].slice(0, 5), [
        "Ada Lovelace",
        "h1",
        "Won the account",
        "Customer",
        "Ada Lovelace",
      ]);
      assert.ok(!res.table.rows.flat().includes("Ops employee news"));
      assert.deepEqual(auditRowsOf(db).map((r) => r.outcome), ["ok"]);
    });
  }

  test("someone off the roster is refused before any headline is read", async () => {
    const db = seed();
    const res = await runExport(
      "headlines",
      new URLSearchParams({ team: "t1" }),
      "csv",
      exportDepsAs(db, { uid: "u3" }),
    );
    assert.equal(!res.ok && res.status, 404);
    assert.equal(!res.ok && res.reason, "no_page_access");
    assert.deepEqual(
      auditRowsOf(db).map((r) => [r.outcome, r.reason]),
      [["refused", "no_page_access"]],
    );
  });
});
