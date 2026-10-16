// Export definition: a team's To-Dos page (app/(app)/teams/[teamId]/todos).
//
// Reads the page's own URL state (`?archived=`, `?owner=`, plus `team`, the
// path segment) and loads with the page's own query and visibility rule
// (page.tsx: `todos where team_id ==`, then lib/todo-lists listShowsTodo),
// double-checked against the access module (lib/access accessFor). The rows
// are the "To-Dos" list exactly as it renders — owner cards in speaking
// order, open then done, by due date (lib/todo-board-order.ts); Archived is
// the flat owner-then-due list.
//
// Deliberately NOT in the file: the "Your milestones" reminder column (rock
// milestones, which belong to the Rocks export) and the personal "Assigned
// to me from other teams" box (other teams' to-dos, which belong to those
// teams' exports). Both are per-viewer reminders, not this team's list.

import { accessFor, type Viewer } from "@/lib/access";
import type { TodoDoc } from "@/lib/firestore-types";
import { reconcileSpeakingOrder } from "@/lib/l10/speaking-order";
import { byDue, groupByOwner } from "@/lib/todo-board-order";
import { listShowsTodo } from "@/lib/todo-lists";
import { ownerLabel } from "@/lib/user-name";
import {
  isRefusal,
  type ExportColumn,
  type ExportDefinition,
  type ExportRefusal,
  type LoadedView,
} from "../types";
import {
  archivedParam,
  loadRoster,
  loadTeamOr404,
  ownerFilterLine,
  ownerParam,
  parseTeamParam,
  resolveOwnerFilter,
  type Member,
} from "./shared";

// The owner-filter rule every team page shares; re-exported for its tests.
export { resolveOwnerFilter };

export type TodosExportParams = {
  teamId: string;
  archived: boolean;
  /** Raw `?owner=`; validated against the roster in `load`, as the page does. */
  owner: string | null;
};

export type TodoExportRow = TodoDoc & { id: string };

export function parseTodosParams(sp: URLSearchParams): TodosExportParams | ExportRefusal {
  const teamId = parseTeamParam(sp);
  if (isRefusal(teamId)) return teamId;
  return {
    teamId,
    // page.tsx: `archived === "1" || archived === "true"`.
    archived: archivedParam(sp.get("archived")),
    owner: ownerParam(sp),
  };
}

/**
 * The To-Dos list rows the page renders for this view, in its order. Pure:
 * `todos` is every doc the page's query returned.
 */
export function todosViewRows(input: {
  todos: readonly TodoExportRow[];
  viewer: Viewer;
  archived: boolean;
  ownerFilter: string;
  members: readonly Member[];
  speakingOrder: string[];
  nameOf: (uid: string) => string | null | undefined;
}): TodoExportRow[] {
  const { viewer } = input;
  const visible = input.todos.filter(
    (t) =>
      !t.source_rock_id &&
      listShowsTodo(t, viewer.uid, viewer.isAdmin) &&
      accessFor("todo").canSee(t, viewer) &&
      (t.archived_at != null) === input.archived &&
      (input.ownerFilter === "all" || t.owner_id === input.ownerFilter),
  );

  const due = (t: TodoExportRow) => ({ due_date: t.due_date ?? null });
  const dueOrder = (a: TodoExportRow, b: TodoExportRow) => byDue(due(a), due(b));

  if (input.archived) {
    const name = (t: TodoExportRow) => ownerLabel(t.owner_id, input.nameOf);
    return [...visible].sort((a, b) => name(a).localeCompare(name(b)) || dueOrder(a, b));
  }
  const groups = groupByOwner(
    visible.map((t) => ({ ...t, owner_id: t.owner_id ?? null })),
    [...input.members],
    input.speakingOrder,
  );
  return groups.flatMap((g) => [
    ...g.items.filter((t) => !t.completed_at).sort(dueOrder),
    ...g.items.filter((t) => !!t.completed_at).sort(dueOrder),
  ]);
}

export const TODOS_COLUMNS: readonly ExportColumn<TodoExportRow>[] = [
  { key: "owner", header: "Owner", kind: "user", value: (t) => t.owner_id, width: 22 },
  { key: "title", header: "To-do", kind: "text", value: (t) => t.title, width: 48 },
  {
    key: "description",
    header: "Description",
    kind: "richtext",
    value: (t) => t.description,
    width: 60,
  },
  { key: "due_date", header: "Due", kind: "date", value: (t) => t.due_date, width: 12 },
  {
    key: "status",
    header: "Status",
    kind: "text",
    value: (t) => (t.completed_at ? "Done" : "Open"),
    width: 8,
  },
  {
    key: "completed_at",
    header: "Completed",
    kind: "datetime",
    value: (t) => t.completed_at,
    width: 20,
  },
  {
    key: "archived_at",
    header: "Archived",
    kind: "datetime",
    value: (t) => t.archived_at,
    width: 20,
  },
  {
    key: "visibility",
    header: "Visibility",
    kind: "text",
    value: (t) => (t.visibility === "private" ? "Private" : "Team"),
    width: 10,
  },
  {
    key: "weekly_focus",
    header: "Weekly focus",
    kind: "boolean",
    value: (t) => t.weekly_focus === true,
    width: 12,
  },
  {
    key: "assigned_by",
    header: "Assigned by",
    kind: "user",
    // lib/follow.ts assignerOf: legacy docs fall back to the creator.
    value: (t) => t.assigned_by ?? t.created_by ?? null,
    width: 22,
  },
  { key: "id", header: "To-do ID", kind: "text", value: (t) => t.id, width: 24 },
];

export const todosExport: ExportDefinition<TodoExportRow, TodosExportParams> = {
  id: "todos",
  title: "To-Dos",
  parseParams: parseTodosParams,
  columns: TODOS_COLUMNS,
  async load({ db, uid, viewer }, p): Promise<LoadedView<TodoExportRow> | ExportRefusal> {
    const teamDoc = await loadTeamOr404(db, p.teamId, viewer);
    if (isRefusal(teamDoc)) return teamDoc;
    const { name: teamName, data: team } = teamDoc;

    const [members, snap] = await Promise.all([
      loadRoster(db, p.teamId),
      db.collection("todos").where("team_id", "==", p.teamId).get(),
    ]);
    const names = new Map(members.map((m) => [m.user_id, m.full_name]));
    const rosterIds = new Set(members.map((m) => m.user_id));
    const ownerFilter = resolveOwnerFilter(p.owner, uid, rosterIds);
    const speakingOrder = reconcileSpeakingOrder(
      (team.speaking_order as string[] | undefined) ?? [],
      members,
    );

    const rows = todosViewRows({
      todos: snap.docs.map((d) => ({ ...(d.data() as TodoDoc), id: d.id })),
      viewer,
      archived: p.archived,
      ownerFilter,
      members,
      speakingOrder,
      // Archived sorts by owner name; off-roster owners sort under "—"
      // until the core resolves them, a negligible difference in order.
      nameOf: (id) => names.get(id),
    });

    return {
      ok: true,
      rows,
      teamId: p.teamId,
      names,
      filters: [
        { label: "Team", value: teamName },
        { label: "View", value: p.archived ? "Archived" : "Active" },
        ownerFilterLine(ownerFilter, names),
      ],
      fileNameParts: [teamName, p.archived ? "archived" : "active"],
    };
  },
};
