// Who may change a to-do (C-11, docs/SECURITY_AUDIT_2026-09-08.md).
//
// A team-visible to-do is editable by anyone on the team — that is the
// working convention for every EOS list. A *private* one is readable only by
// its owner (firestore.rules), and users read "Private" as "mine", so
// mutating it — ticking, editing, archiving, deleting — is limited to its
// owner and to the people who manage the team: a team leader or an org
// admin (requireTeamLeader's rule). The server actions enforce this because
// the Admin SDK bypasses firestore.rules; the rules mirror it for client
// writes.

export type TodoAccessSubject = {
  visibility?: unknown;
  owner_id?: unknown;
};

export type TodoAccessCaller = {
  uid: string;
  isAdmin: boolean;
  /** The caller's `team_members.role` on the to-do's team, if rostered. */
  membershipRole: string | null;
};

export function canMutateTodo(
  todo: TodoAccessSubject,
  caller: TodoAccessCaller,
): boolean {
  if (todo.visibility !== "private") return true;
  if (caller.isAdmin || caller.membershipRole === "leader") return true;
  return typeof todo.owner_id === "string" && todo.owner_id === caller.uid;
}
