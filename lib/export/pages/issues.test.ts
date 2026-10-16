import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { viewerOf } from "@/lib/access/types";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import { adminExportDeps, ts } from "@/lib/test-support/export-deps";
import { readXlsx } from "@/lib/xlsx";
import { runExport } from "../run";
import { writeXlsx } from "../xlsx-writer";
import { isRefusal } from "../types";
import { exportUrls, issuesExportParams } from "../urls";
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
    const qs = new URL(exportUrls("issues", params).xlsx, "https://x").searchParams;
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
  test("loads the team's issues, names owners, records the term filter", async () => {
    const db = new FakeFirestore();
    db.seed("teams", "t1", { name: "Leadership" });
    db.seed("team_members", "t1__u1", { team_id: "t1", user_id: "u1" });
    db.seed("users", "u1", { display_name: "Ada Lovelace" });
    db.seed("issues", "i1", { ...issue("i1"), title: "+1 vendor", votes: 2 });
    db.seed("issues", "other", { ...issue("other"), team_id: "t2" });
    const res = await runExport(
      "issues",
      new URLSearchParams({ team: "t1" }),
      "xlsx",
      adminExportDeps(db),
    );
    assert.ok(res.ok);
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
    const filters = res.table.provenance.find((l) => l.label === "Filters applied")?.value;
    assert.equal(
      filters,
      "Team: Leadership · View: Active · Term: Short-term · Owner: All owners",
    );
    assert.equal(db.docsIn("audit_log").length, 1);

    // A title starting with "+" is neutralized in the spreadsheet.
    const t = res.table;
    const [sheet] = readXlsx(
      writeXlsx({ sheetName: t.title, preamble: t.provenance, headers: t.headers, rows: t.rows }),
    );
    assert.equal(sheet.rows.at(-1)![0], "'+1 vendor");
  });
});
