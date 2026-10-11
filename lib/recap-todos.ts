// Meeting-recap to-do filter (permissions P0). The recap lists standalone
// to-dos created during the meeting; a *private* to-do is readable only by its
// owner (firestore.rules), and the recap page reads with the Admin SDK, so it
// must drop other people's private rows itself.

export type RecapTodoSubject = {
  visibility?: unknown;
  owner_id?: unknown;
  source_rock_id?: unknown;
};

export function isRecapTodoVisible(
  todo: RecapTodoSubject,
  viewerUid: string,
): boolean {
  if (todo.source_rock_id) return false;
  if (todo.visibility !== "private") return true;
  return typeof todo.owner_id === "string" && todo.owner_id === viewerUid;
}
