import { Timestamp } from "firebase-admin/firestore";
import { endOfQuarter, toDateString } from "../dates";
import {
  cell,
  importDocId,
  normalizeDescription,
  parseDateOnly,
  type CsvTable,
} from "../csv-import";
import type { KindStats } from "../team-import-types";
import { archivedAtFrom, createdAtFrom, isArchived, isRecurring, isStaleCompletion } from "./normalize";
import type { OwnerResolver, PreviewCollector, Writer } from "./owners";
import { withUnmatchedOwnerNote } from "./owners";

export async function importTodos(
  table: CsvTable,
  ctx: {
    teamId: string;
    writer: Writer;
    owners: OwnerResolver;
    existingIds: Set<string>;
    includeArchived: boolean;
    completedSince: string | null;
    unmatchedOwner: "skip" | "no-owner";
    preview: PreviewCollector;
    existingRows: "keep" | "update";
  },
): Promise<KindStats> {
  let imported = 0;
  let skipped = 0;
  let archived = 0;
  let stale = 0;
  let noOwner = 0;
  let unchanged = 0;
  const recurring: string[] = [];
  const details: string[] = [];
  const warnings: string[] = [];

  for (const row of table.rows) {
    const title = cell(row, table.headers, "Title", "Name", "To-Do", "Todo", "Task");
    if (!title) {
      skipped++;
      continue;
    }

    if (!ctx.includeArchived && isArchived(row, table.headers)) {
      archived++;
      ctx.preview.add({
        kind: "todos",
        action: "skip",
        title,
        owner: "—",
        detail: [],
        note: "Archived in the file — tick Include archived rows to import it",
      });
      continue;
    }

    const repeat = cell(row, table.headers, "Repeat", "Recurrence", "Repeats");
    if (repeat && isRecurring(repeat)) {
      recurring.push(`${title} (${repeat})`);
    }

    const { uid: ownerId, unmatchedName } = await ctx.owners.resolveOwner(
      cell(row, table.headers, "Owner", "Owner Name", "Accountable", "Assignee"),
    );
    if (ownerId === null && !(unmatchedName && ctx.unmatchedOwner === "no-owner")) {
      skipped++;
      ctx.preview.add({
        kind: "todos",
        action: "skip",
        title,
        owner: unmatchedName ?? "—",
        detail: [],
        note: unmatchedName
          ? `No team member matches "${unmatchedName}"`
          : "No Owner in the file",
      });
      continue;
    }

    const completedOn = parseDateOnly(cell(row, table.headers, "Completed On", "Completed"));
    if (isStaleCompletion(completedOn, ctx.completedSince)) {
      stale++;
      ctx.preview.add({
        kind: "todos",
        action: "skip",
        title,
        owner: ctx.owners.nameFor(ownerId),
        detail: [],
        note: `Completed ${completedOn} — before the back-import cutoff`,
      });
      continue;
    }

    const dueDate = parseDateOnly(cell(row, table.headers, "Due Date", "Due"));
    const visibility = /^priv/i.test(cell(row, table.headers, "Visibility", "Private"))
      ? "private"
      : "team";

    const todoId = importDocId("todo", ctx.teamId, title);
    const isNew = !ctx.existingIds.has(todoId);

    if (!isNew && ctx.existingRows === "keep") {
      unchanged++;
      ctx.preview.add({
        kind: "todos",
        action: "skip",
        title,
        owner: ctx.owners.nameFor(ownerId),
        detail: [],
        note: "Already on the team — left as it is",
      });
      continue;
    }

    let description =
      normalizeDescription(cell(row, table.headers, "Description", "Notes")) || null;
    if (ownerId === null && unmatchedName) {
      description = withUnmatchedOwnerNote(description, unmatchedName);
      noOwner++;
    }

    await ctx.writer.set(["todos", todoId], {
      team_id: ctx.teamId,
      title,
      description,
      owner_id: ownerId,
      due_date: dueDate ?? toDateString(endOfQuarter()),
      completed_at: completedOn ? Timestamp.fromDate(new Date(`${completedOn}T00:00:00`)) : null,
      visibility,
      source_issue_id: null,
      source_meeting_id: null,
      source_rock_id: null,
      source_link: cell(row, table.headers, "Link", "URL") || null,
      import_source: "csv",
      ...(isNew
        ? { archived_at: archivedAtFrom(row, table.headers) }
        : {}),
      ...(isNew ? { created_at: createdAtFrom(row, table.headers) } : {}),
    });
    ctx.preview.add({
      kind: "todos",
      action: isNew ? "create" : "update",
      title,
      owner: ownerId ? ctx.owners.nameFor(ownerId) : "No Owner",
      detail: [
        `due ${dueDate ?? toDateString(endOfQuarter())}`,
        completedOn ? "done" : "open",
        visibility,
      ],
      note:
        ownerId === null && unmatchedName
          ? `"${unmatchedName}" is not on the team — kept in the description`
          : undefined,
    });
    imported++;
  }

  if (archived) details.push(`${archived} archived held back`);
  if (stale) details.push(`${stale} completed before ${ctx.completedSince}`);
  if (noOwner) details.push(`${noOwner} imported as No Owner`);
  if (unchanged) details.push(`${unchanged} already here, left as they are`);
  if (recurring.length > 0) {
    warnings.push(
      `${recurring.length} to-do(s) repeat on a schedule, imported as one-offs: ${recurring.slice(0, 5).join("; ")}${recurring.length > 5 ? "…" : ""}`,
    );
  }

  return {
    kind: "todos",
    label: "to-dos",
    imported,
    skipped,
    unchanged,
    details,
    warnings,
  };
}
