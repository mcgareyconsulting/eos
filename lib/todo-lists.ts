// Which to-dos a surface shows to whom (docs/PERMISSIONS_SPEC.md §3.2, §4,
// D1; P8a). Pure; the To-Dos page, the board, Home, the L10 segment and the
// recap share these so the surfaces cannot disagree.

type Id = string | null | undefined;

export type ListTodo = {
  team_id?: Id;
  owner_id?: Id;
  created_by?: Id;
  assigned_by?: Id;
  visibility?: unknown;
  source_rock_id?: Id;
  archived_at?: unknown;
};

function is(id: Id, uid: string): boolean {
  return typeof id === "string" && id !== "" && id === uid;
}

export type TodoViewer = { uid: string; isAdmin?: boolean };

/** Where a to-do is shown: a team's To-Dos list, Home, or the L10. */
export type TodoSurface = "list" | "home" | "l10";

/**
 * The one visibility predicate behind every to-do surface (spec §3.2, §4).
 * A team to-do shows everywhere. A private one shows:
 *  - on lists and Home: to its creator, its assignee and org admins — never
 *    to leaders or other members;
 *  - on the L10: to no one. The L10 is the team's view, not the reader's.
 */
export function surfaceShowsTodo(
  todo: ListTodo,
  viewer: TodoViewer,
  surface: TodoSurface,
): boolean {
  if (todo.visibility !== "private") return true;
  if (surface === "l10") return false;
  return (
    viewer.isAdmin === true ||
    is(todo.owner_id, viewer.uid) ||
    is(todo.created_by, viewer.uid)
  );
}

/** A team's To-Dos list (see `surfaceShowsTodo`). */
export function listShowsTodo(
  todo: ListTodo,
  uid: string,
  isAdmin = false,
): boolean {
  return surfaceShowsTodo(todo, { uid, isAdmin }, "list");
}

/** Home (same rule as the lists). */
export function homeShowsTodo(
  todo: ListTodo,
  uid: string,
  isAdmin = false,
): boolean {
  return surfaceShowsTodo(todo, { uid, isAdmin }, "home");
}

/** The L10 segment and recap: never a private to-do, for anyone. */
export function l10ShowsTodo(todo: ListTodo): boolean {
  return surfaceShowsTodo(todo, { uid: "" }, "l10");
}

/**
 * "Assigned to me from other teams" (D1): plain to-dos the viewer owns on a
 * team they are not rostered on, not archived. Milestones are excluded —
 * they have their own column and rock blocks.
 */
export function isAssignedFromOtherTeam(
  todo: ListTodo,
  uid: string,
  viewerTeamIds: ReadonlySet<string> | readonly string[],
): boolean {
  if (todo.source_rock_id) return false;
  if (todo.archived_at != null) return false;
  if (!is(todo.owner_id, uid)) return false;
  const teamId = typeof todo.team_id === "string" ? todo.team_id : "";
  if (!teamId) return false;
  const teams = viewerTeamIds instanceof Set ? viewerTeamIds : new Set(viewerTeamIds as readonly string[]);
  return !teams.has(teamId);
}

/** Who made the assignment: `assigned_by`, legacy `created_by` (lib/follow.ts). */
export function assignerIdOf(todo: ListTodo): string | null {
  for (const v of [todo.assigned_by, todo.created_by]) {
    if (typeof v === "string" && v !== "") return v;
  }
  return null;
}

/** The pill on a cross-team row: "Assigned by Dana Lee · Ops". */
export function assignedPillText(
  todo: ListTodo,
  uid: string,
  nameOf: (id: string) => string | undefined,
  teamName: string | undefined,
): string {
  const by = assignerIdOf(todo);
  const who = !by ? "someone" : by === uid ? "you" : (nameOf(by) ?? "someone");
  return `Assigned by ${who} · ${teamName ?? "another team"}`;
}

/** Owner ids of `todos` that are not on `rosterIds` — the outside assignees. */
export function outsideOwnerIds(
  todos: readonly { owner_id?: Id }[],
  rosterIds: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const t of todos) {
    if (typeof t.owner_id === "string" && t.owner_id && !rosterIds.has(t.owner_id)) {
      out.add(t.owner_id);
    }
  }
  return [...out];
}

/** The owner-card key and title for to-dos owned off the roster (§3.1). */
export const OUTSIDE_GROUP_KEY = "outside";
export const OUTSIDE_GROUP_TITLE = "Outside assignees";
