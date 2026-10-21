// Activity rows a rock save writes onto its milestones' traces — the pure
// half. A milestone is a to-do (`entity_type: "todo"`), so it gets the rows a
// to-do's own create and edit actions write (todos/actions.ts addTodo,
// updateTodoMeta): `created` with the owner and due date, `updated` with the
// title / owner / due summary, and `description` when the notes changed.
// Nothing new is stored — the same ActivityKind values, on the same trace.

import type { ActivityKind } from "./activity";
import { summarizeTodoChanges, todoEditEvents } from "./notifications";

export type MilestoneTraceFields = {
  title: string;
  owner_id: string | null;
  due_date: string | null;
  description: string | null;
};

export type MilestoneTraceRow = {
  kind: Extract<ActivityKind, "created" | "updated" | "description">;
  detail: string | null;
};

/**
 * The rows for one milestone in a rock save. `before` is the stored doc
 * (null = the save creates it). `actorId` reads as "you" in a created row's
 * owner, as addTodo writes it.
 */
export function milestoneTraceRows(
  before: MilestoneTraceFields | null,
  after: MilestoneTraceFields,
  actorId: string,
  nameOf: (uid: string) => string | null | undefined,
  formatDue: (iso: string) => string,
): MilestoneTraceRow[] {
  if (!before) {
    const owner = after.owner_id;
    const detail = [
      owner ? `Owner ${owner === actorId ? "you" : nameOf(owner)?.trim() || "—"}` : null,
      after.due_date ? `Due ${formatDue(after.due_date)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return [{ kind: "created", detail: detail || null }];
  }
  const rows: MilestoneTraceRow[] = [];
  const summary = summarizeTodoChanges(before, after, nameOf, formatDue);
  if (summary) rows.push({ kind: "updated", detail: summary });
  if ((before.description ?? null) !== (after.description ?? null)) {
    rows.push({ kind: "description", detail: null });
  }
  return rows;
}

/**
 * What a rock save tells a milestone's followers, as a to-do edit would
 * (todoEditEvents): the most significant change, or null. A reassignment is
 * left out — the save already tells the old and new owner directly
 * (notifyMilestoneOwners), and the event would tell them twice.
 */
export function milestoneEditEvent(
  before: MilestoneTraceFields | null,
  after: MilestoneTraceFields,
): "title_changed" | "due_date_changed" | "description_changed" | null {
  if (!before) return null; // created: the owner hears "assigned"
  const [event] = todoEditEvents(
    { ...before, owner_id: after.owner_id },
    after,
  ).filter((e) => e !== "reassigned");
  return (event as "title_changed" | "due_date_changed" | "description_changed") ?? null;
}
