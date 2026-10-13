// Meeting-recap to-do filter (permissions P0, P8a). The recap lists standalone
// to-dos created during the meeting. It is the team's L10 view, so a *private*
// to-do never appears — for anyone, admins included (spec §3.2,
// lib/todo-lists.ts l10ShowsTodo). The recap page reads with the Admin SDK, so
// it must drop private rows itself.

import { l10ShowsTodo } from "./todo-lists";

export type RecapTodoSubject = {
  visibility?: unknown;
  owner_id?: unknown;
  created_by?: unknown;
  source_rock_id?: unknown;
};

export function isRecapTodoVisible(todo: RecapTodoSubject): boolean {
  if (todo.source_rock_id) return false;
  return l10ShowsTodo({ visibility: todo.visibility });
}
