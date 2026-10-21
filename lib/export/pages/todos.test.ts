import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { viewerOf } from "@/lib/access/types";
import { isRefusal } from "../types";
import {
  TODOS_COLUMNS,
  parseTodosParams,
  resolveOwnerFilter,
  todosViewRows,
  type TodoExportRow,
} from "./todos";

const ts = (iso: string) => ({
  toMillis: () => Date.parse(iso),
  toDate: () => new Date(iso),
});

function todo(id: string, over: Partial<TodoExportRow> = {}): TodoExportRow {
  return {
    id,
    team_id: "t1",
    title: id,
    description: null,
    owner_id: "u1",
    due_date: null,
    completed_at: null,
    archived_at: null,
    visibility: "team",
    weekly_focus: false,
    source_issue_id: null,
    source_meeting_id: null,
    source_rock_id: null,
    ...over,
  };
}

const members = [
  { user_id: "u1", full_name: "Ada" },
  { user_id: "u2", full_name: "Grace" },
];
const names = new Map(members.map((m) => [m.user_id, m.full_name]));
const admin = viewerOf("admin", true, [], []);
const member = viewerOf("u1", false, ["t1"], []);

function rows(
  todos: TodoExportRow[],
  opts: { archived?: boolean; ownerFilter?: string; viewer?: typeof admin } = {},
) {
  return todosViewRows({
    todos,
    viewer: opts.viewer ?? admin,
    archived: opts.archived ?? false,
    ownerFilter: opts.ownerFilter ?? "all",
    members,
    speakingOrder: ["u2", "u1"],
    nameOf: (id) => names.get(id),
  }).map((t) => t.id);
}

describe("todos export — columns", () => {
  test("column snapshot (a change here changes every auditor file)", () => {
    assert.deepEqual(
      TODOS_COLUMNS.map((c) => [c.key, c.header, c.kind]),
      [
        ["owner", "Owner", "user"],
        ["title", "To-do", "text"],
        ["description", "Description", "richtext"],
        ["due_date", "Due", "date"],
        ["status", "Status", "text"],
        ["completed_at", "Completed", "datetime"],
        ["archived_at", "Archived", "datetime"],
        ["visibility", "Visibility", "text"],
        ["weekly_focus", "Weekly focus", "boolean"],
        ["assigned_by", "Assigned by", "user"],
        ["id", "To-do ID", "text"],
      ],
    );
  });

  test("assigned by falls back to the creator on legacy docs", () => {
    const col = TODOS_COLUMNS.find((c) => c.key === "assigned_by")!;
    assert.equal(col.value(todo("x", { created_by: "u2" })), "u2");
    assert.equal(col.value(todo("x", { created_by: "u2", assigned_by: "u1" })), "u1");
  });
});

describe("todos export — the page's view", () => {
  const all = [
    todo("open-ada-late", { due_date: "2026-11-01" }),
    todo("open-ada-soon", { due_date: "2026-10-20" }),
    todo("done-ada", { completed_at: ts("2026-10-10T12:00:00Z") }),
    todo("open-grace", { owner_id: "u2" }),
    todo("unassigned", { owner_id: null }),
    todo("outside", { owner_id: "u9" }),
    todo("archived-ada", { archived_at: ts("2026-10-01T12:00:00Z") }),
    todo("archived-grace", { owner_id: "u2", archived_at: ts("2026-10-01T12:00:00Z") }),
    todo("milestone", { source_rock_id: "r1" }),
    todo("private-other", { visibility: "private", owner_id: "u2", created_by: "u2" }),
  ];

  test("Active: owner cards in speaking order, open by due then done; no milestones", () => {
    assert.deepEqual(rows(all), [
      "open-grace",
      "private-other", // an admin sees every private to-do on the list (spec §3.2)
      "open-ada-soon",
      "open-ada-late",
      "done-ada",
      "outside",
      "unassigned",
    ]);
  });

  test("Archived: flat, by owner name", () => {
    assert.deepEqual(rows(all, { archived: true }), ["archived-ada", "archived-grace"]);
  });

  test("owner filter", () => {
    assert.deepEqual(rows(all, { ownerFilter: "u2" }), ["open-grace", "private-other"]);
  });

  test("never more than the list shows the viewer: others' private to-dos stay out", () => {
    assert.ok(!rows(all, { viewer: member }).includes("private-other"));
  });

  test("params: the page's own query parameters", () => {
    const p = parseTodosParams(new URLSearchParams("team=t1&archived=true&owner=u2"));
    assert.deepEqual(p, { teamId: "t1", archived: true, owner: "u2" });
    assert.ok(isRefusal(parseTodosParams(new URLSearchParams("team=../x"))));
    assert.ok(isRefusal(parseTodosParams(new URLSearchParams(""))));
  });

  test("owner filter resolves like page.tsx", () => {
    const roster = new Set(["u1", "u2"]);
    assert.equal(resolveOwnerFilter(null, "u1", roster), "all");
    assert.equal(resolveOwnerFilter("mine", "u1", roster), "u1");
    assert.equal(resolveOwnerFilter("others", "u1", roster), "all");
    assert.equal(resolveOwnerFilter("u2", "u1", roster), "u2");
    assert.equal(resolveOwnerFilter("stranger", "u1", roster), "all");
  });
});
