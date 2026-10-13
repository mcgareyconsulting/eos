// Who may change a private to-do (docs/PERMISSIONS_SPEC.md §3, §3.2; P8a).
//
// A team-visible to-do is changed by its team (and admins) — the team gate
// in lib/access/team-item.ts decides that; this helper is a no-op for it.
// A *private* to-do belongs to its creator and its assignee: they, and org
// admins, may tick, edit, archive or delete it. Leaders have no special
// power over a private to-do (spec §3.2) — the C-11 "leader may change it"
// rule is gone. The server actions enforce this because the Admin SDK
// bypasses firestore.rules.

export type TodoAccessSubject = {
  visibility?: unknown;
  owner_id?: unknown;
  /** Stored since the follow feature; absent on older docs and imports. */
  created_by?: unknown;
};

export type TodoAccessCaller = {
  uid: string;
  isAdmin: boolean;
  /**
   * The caller's `team_members.role` on the to-do's team, if rostered.
   * No longer read: leaders have no private-to-do power (spec §3.2).
   */
  membershipRole?: string | null;
};

function is(id: unknown, uid: string): boolean {
  return typeof id === "string" && id !== "" && id === uid;
}

/** The creator or the assignee of the to-do. */
export function isTodoParty(todo: TodoAccessSubject, uid: string): boolean {
  return is(todo.owner_id, uid) || is(todo.created_by, uid);
}

export function canMutateTodo(
  todo: TodoAccessSubject,
  caller: TodoAccessCaller,
): boolean {
  if (todo.visibility !== "private") return true;
  if (caller.isAdmin) return true;
  return isTodoParty(todo, caller.uid);
}

/**
 * May the caller save `next` as the to-do's visibility? Only the creator or
 * the assignee may turn a private to-do into a team to-do (spec §3.2) — not
 * an admin, not a leader. Every other change is up to whoever may edit it.
 */
export function canChangeTodoVisibility(
  todo: TodoAccessSubject,
  caller: Pick<TodoAccessCaller, "uid">,
  next: "team" | "private",
): boolean {
  if (todo.visibility === "private" && next !== "private") {
    return isTodoParty(todo, caller.uid);
  }
  return true;
}
