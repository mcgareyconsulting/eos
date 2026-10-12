// Meeting-recap to-do filter (permissions P0, P8a). The recap lists standalone
// to-dos created during the meeting; a *private* to-do is for its creator and
// its assignee only (spec §3.2, lib/todo-lists.ts), and the recap page reads
// with the Admin SDK, so it must drop other people's private rows itself.

import { listShowsTodo } from "./todo-lists";

export type RecapTodoSubject = {
  visibility?: unknown;
  owner_id?: unknown;
  created_by?: unknown;
  source_rock_id?: unknown;
};

function id(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function isRecapTodoVisible(
  todo: RecapTodoSubject,
  viewerUid: string,
): boolean {
  if (todo.source_rock_id) return false;
  return listShowsTodo(
    {
      visibility: todo.visibility,
      owner_id: id(todo.owner_id),
      created_by: id(todo.created_by),
    },
    viewerUid,
  );
}
