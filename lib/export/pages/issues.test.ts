import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { viewerOf } from "@/lib/access/types";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import {
  adminExportDeps,
  auditRowsOf,
  exportDepsAs,
  ts,
} from "@/lib/test-support/export-deps";
import { writeCsv } from "../csv";
import { runExport } from "../run";
import { isRefusal } from "../types";
import { exportUrl, issuesExportParams } from "../urls";
import {
  ISSUES_COLUMNS,
  issuesViewRows,
  parseIssuesParams,
  type IssueExportRow,
} from "./issues";

function issue(id: string, over: Partial<IssueExportRow> = {}): IssueExportRow {
  return {
    id,
    team_id: "t1",
    title: id,
    description: null,
    owner_id: "u1",
    priority: null,
    votes: 0,
    type: "short",
    status: "open",
    ...over,
  };
}

const admin = viewerOf("admin", true, [], []);
const outsider = viewerOf("u9", false, ["t2"], []);

function rows(
  issues: IssueExportRow[],
  opts: { archived?: boolean; ownerFilter?: string; term?: "short" | "long"; viewer?: typeof admin } = {},
) {
  return issuesViewRows({
    issues,
    viewer: opts.viewer ?? admin,
    archived: opts.archived ?? false,
    ownerFilter: opts.ownerFilter ?? "all",
    term: opts.term ?? "short",
  }).map((i) => i.id);
}

describe("issues export — columns", () => {
  test("column snapshot (a change here changes every auditor file)", () => {
    assert.deepEqual(
      ISSUES_COLUMNS.map((c) => [c.key, c.header, c.kind]),
      [
        ["title", "Issue", "text"],
        ["description", "Description", "richtext"],
        ["owner", "Owner", "user"],
        ["status", "Status", "text"],
        ["priority", "Priority", "text"],
        ["votes", "Votes", "number"],
        ["type", "Term", "text"],
        ["created_at", "Created", "datetime"],
        ["archived_at", "Archived", "datetime"],
        ["id", "Issue ID", "text"],
      ],
    );
  });
});

describe("issues export — the page's view", () => {
  const all = [
    issue("few-votes", { votes: 1 }),
    issue("many-votes", { votes: 5 }),
    issue("solving", { status: "solving", votes: 9 }),
    issue("untyped", { type: undefined as never, votes: 2 }),
    issue("grace", { owner_id: "u2", votes: 3 }),
    issue("long-low", { type: "long", priority: "low" }),
    issue("long-urgent", { type: "long", priority: "urgent" }),
    issue("archived", { archived_at: ts("2026-10-01T12:00:00Z") }),
    issue("legacy-archived", { archived: true }),
  ];

  test("Short-term: open before solving, then by votes; untyped counts as short", () => {
    assert.deepEqual(rows(all), ["many-votes", "grace", "untyped", "few-votes", "solving"]);
  });

  test("Long-term: by priority", () => {
    assert.deepEqual(rows(all, { term: "long" }), ["long-urgent", "long-low"]);
  });

  test("Archived honours the legacy boolean too", () => {
    assert.deepEqual(rows(all, { archived: true }), ["archived", "legacy-archived"]);
  });

  test("owner filter", () => {
    assert.deepEqual(rows(all, { ownerFilter: "u2" }), ["grace"]);
  });

  test("never more than the page shows: another team's viewer gets nothing", () => {
    assert.deepEqual(rows(all, { viewer: outsider }), []);
  });

  test("params: the page's own keys plus the term toggle, round-tripped", () => {
    const params = issuesExportParams({
      teamId: "t1",
      showArchived: true,
      ownerFilter: "u2",
      term: "long",
    });
    const qs = new URL(exportUrl("issues", params), "https://x").searchParams;
    assert.deepEqual(parseIssuesParams(qs), {
      teamId: "t1",
      archived: true,
      owner: "u2",
      term: "long",
    });
    assert.deepEqual(
      issuesExportParams({ teamId: "t1", showArchived: false, ownerFilter: "all", term: "short" }),
      { team: "t1", archived: undefined, owner: undefined, term: undefined },
    );
    assert.ok(isRefusal(parseIssuesParams(new URLSearchParams("team=a/b"))));
  });
});

describe("issues export — through the core", () => {
  /** t1 (Leadership): u1. t2 (Ops): u3. Each team has one issue. */
  function seed() {
    const db = new FakeFirestore();
    db.seed("teams", "t1", { name: "Leadership" });
    db.seed("teams", "t2", { name: "Ops" });
    db.seed("team_members", "t1__u1", { team_id: "t1", user_id: "u1", role: "member" });
    db.seed("team_members", "t2__u3", { team_id: "t2", user_id: "u3", role: "member" });
    db.seed("users", "u1", { display_name: "Ada Lovelace" });
    db.seed("issues", "i1", { ...issue("i1"), title: "+1 vendor", votes: 2 });
    // Another team's issue (an employee issue on Ops): never in t1's file.
    db.seed("issues", "other", { ...issue("other"), team_id: "t2", title: "Ops employee issue", owner_id: "u3" });
    return db;
  }

  test("a member gets their team's list: names, no other team's issue, the filters audited", async () => {
    const db = seed();
    const res = await runExport(
      "issues",
      new URLSearchParams({ team: "t1" }),
      "csv",
      exportDepsAs(db, { uid: "u1" }),
    );
    assert.ok(res.ok);
    assert.deepEqual(res.table.headers, ISSUES_COLUMNS.map((c) => c.header));
    assert.ok(!res.table.headers.some((h) => /comment/i.test(h)));
    assert.equal(res.table.rows.length, 1);
    assert.deepEqual(res.table.rows[0].slice(0, 7), [
      "+1 vendor",
      "",
      "Ada Lovelace",
      "Open",
      "",
      2,
      "Short-term",
    ]);
    assert.ok(!res.table.rows.flat().includes("Ops employee issue"));
    const audit = auditRowsOf(db);
    assert.deepEqual(
      audit.map((r) => [r.outcome, r.entity_id, r.actor_uid, r.team_id]),
      [["ok", "issues", "u1", "t1"]],
    );
    assert.deepEqual((audit[0].export as { filters: unknown }).filters, {
      Team: "Leadership",
      View: "Active",
      Term: "Short-term",
      Owner: "All owners",
    });

    // A title starting with "+" is neutralized in the file.
    const csv = writeCsv(res.table);
    assert.ok(csv.includes("\r\n'+1 vendor,"));
  });

  test("an admin on no team gets the same list", async () => {
    const db = seed();
    const res = await runExport(
      "issues",
      new URLSearchParams({ team: "t1" }),
      "csv",
      adminExportDeps(db),
    );
    assert.ok(res.ok);
    assert.deepEqual(res.table.rows.map((r) => r[0]), ["+1 vendor"]);
  });

  test("someone off the roster is refused before any issue is read", async () => {
    const db = seed();
    const res = await runExport(
      "issues",
      new URLSearchParams({ team: "t1" }),
      "csv",
      exportDepsAs(db, { uid: "u3" }),
    );
    assert.deepEqual(res, {
      ok: false,
      status: 404,
      message: "Team not found.",
      reason: "no_page_access",
    });
    assert.deepEqual(
      auditRowsOf(db).map((r) => [r.outcome, r.reason, r.actor_uid]),
      [["refused", "no_page_access", "u3"]],
    );
  });
});
