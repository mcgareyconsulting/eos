// Which to-dos a list shows to whom (docs/PERMISSIONS_SPEC.md §3.2, §4, D1;
// P8a). Pure; the To-Dos page, the board, Home and the L10 segment share
// these so the surfaces cannot disagree.

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

/**
 * Does a team list show this to-do to `uid`? A team to-do: yes. A private
 * one: only to its creator and its assignee (spec §3.2 — never to the
 * team, leaders or admins in a list; an admin opens it by link).
 */
export function listShowsTodo(todo: ListTodo, uid: string): boolean {
  if (todo.visibility !== "private") return true;
  return is(todo.owner_id, uid) || is(todo.created_by, uid);
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
