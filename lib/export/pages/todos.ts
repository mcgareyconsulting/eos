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

import type { Firestore } from "firebase-admin/firestore";
import { accessFor, type Viewer } from "@/lib/access";
import type { TodoDoc } from "@/lib/firestore-types";
import { reconcileSpeakingOrder } from "@/lib/l10/speaking-order";
import { byDue, groupByOwner } from "@/lib/todo-board-order";
import { listShowsTodo } from "@/lib/todo-lists";
import { userDisplayName, ownerLabel, type UserDocData } from "@/lib/user-name";
import { checkRowCap } from "../cap";
import type {
  ExportColumn,
  ExportDefinition,
  ExportRefusal,
  LoadedView,
} from "../types";

export type TodosExportParams = {
  teamId: string;
  archived: boolean;
  /** Raw `?owner=`; validated against the roster in `load`, as the page does. */
  owner: string | null;
};

export type TodoExportRow = TodoDoc & { id: string };

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function refuse(status: number, message: string): ExportRefusal {
  return { ok: false, status, message };
}

export function parseTodosParams(sp: URLSearchParams): TodosExportParams | ExportRefusal {
  const teamId = sp.get("team") ?? "";
  if (!ID_RE.test(teamId)) return refuse(400, "Missing or invalid team.");
  const archivedParam = sp.get("archived");
  const owner = sp.get("owner");
  return {
    teamId,
    // page.tsx: `archived === "1" || archived === "true"`.
    archived: archivedParam === "1" || archivedParam === "true",
    owner: owner && owner.length <= 128 ? owner : null,
  };
}

/** The page's owner-filter resolution (page.tsx): legacy values, then roster. */
export function resolveOwnerFilter(
  raw: string | null,
  uid: string,
  rosterIds: ReadonlySet<string>,
): string {
  const filterRaw = raw || "all";
  const legacyMapped =
    filterRaw === "self" || filterRaw === "mine"
      ? uid
      : filterRaw === "team" || filterRaw === "others"
        ? "all"
        : filterRaw;
  return rosterIds.has(legacyMapped) ? legacyMapped : "all";
}

type Member = { user_id: string; full_name: string };

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

async function loadRoster(db: Firestore, teamId: string): Promise<Member[]> {
  const snap = await db.collection("team_members").where("team_id", "==", teamId).get();
  const ids = snap.docs
    .map((d) => d.data().user_id as string | undefined)
    .filter((id): id is string => typeof id === "string" && id !== "");
  if (ids.length === 0) return [];
  const users = await db.getAll(...ids.map((id) => db.collection("users").doc(id)));
  const nameById = new Map(
    users.map((u) => [u.id, userDisplayName(u.data() as UserDocData | undefined)]),
  );
  // getTeamMembers' fallback for a profile-less member.
  return ids.map((id) => ({ user_id: id, full_name: nameById.get(id) || "—" }));
}

export const todosExport: ExportDefinition<TodoExportRow, TodosExportParams> = {
  id: "todos",
  title: "To-Dos",
  parseParams: parseTodosParams,
  columns: TODOS_COLUMNS,
  async load({ db, uid, viewer }, p): Promise<LoadedView<TodoExportRow> | ExportRefusal> {
    const teamSnap = await db.collection("teams").doc(p.teamId).get();
    // requireTeamAccess: a non-member who is not an admin gets the same
    // answer as a team that doesn't exist.
    if (!teamSnap.exists || (!viewer.isAdmin && !viewer.teamIds.has(p.teamId))) {
      return refuse(404, "Team not found.");
    }
    const team = teamSnap.data() ?? {};
    const teamName = (team.name as string) ?? "Team";

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
    // Row cap (lib/export/cap.ts). The query can't carry a limit: the view
    // is its docs filtered in memory (visibility, archived, owner), the
    // same query the page itself runs, so a limit would refuse views that
    // fit. Check the filtered count here instead, before anything per-row.
    const overCap = checkRowCap(rows.length);
    if (overCap) return overCap;

    return {
      ok: true,
      rows,
      teamId: p.teamId,
      names,
      filters: [
        { label: "Team", value: teamName },
        { label: "View", value: p.archived ? "Archived" : "Active" },
        {
          label: "Owner",
          value: ownerFilter === "all" ? "All owners" : (names.get(ownerFilter) ?? "—"),
        },
      ],
      fileNameParts: [teamName, p.archived ? "archived" : "active"],
    };
  },
};
