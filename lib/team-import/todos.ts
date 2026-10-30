import { Timestamp } from "firebase-admin/firestore";
import { endOfQuarter, toDateString } from "../dates";
import {
  cell,
  importedLink,
  importDocId,
  normalizeDescription,
  parseDateOnly,
  type CsvTable,
} from "../csv-import";
import { LONG_TEXT_MAX, TITLE_MAX } from "../text-limits";
import type { KindStats } from "../team-import-types";
import {
  archivedAtFor,
  archiveKey,
  createdAtFrom,
  isArchived,
  isRecurring,
  isOtherTeam,
  isStaleCompletion,
  otherTeamNote,
  rejectOverLength,
  rowTeamOf,
} from "./normalize";
import type { OwnerResolver, PreviewCollector, Writer } from "./owners";
import { fillImportedOwner, withUnmatchedOwnerNote, type Ownerless } from "./owners";

export async function importTodos(
  table: CsvTable,
  ctx: {
    teamId: string;
    writer: Writer;
    owners: OwnerResolver;
    existingIds: Set<string>;
    includeArchived: boolean;
    /** Rows come from an archived export — see TeamImportInputs.archive. */
    archive?: boolean;
    completedSince: string | null;
    unmatchedOwner: "skip" | "no-owner";
    preview: PreviewCollector;
    /** Imported docs still without an owner — see loadOwnerless. */
    ownerless?: Ownerless;
    existingRows: "keep" | "update";
    /** Department filter — see TeamImportOptions.rockTeam. */
    rockTeam?: string;
  },
): Promise<KindStats> {
  let imported = 0;
  let skipped = 0;
  let archived = 0;
  let stale = 0;
  let noOwner = 0;
  let unchanged = 0;
  let ownersFilled = 0;
  let tooLong = 0;
  // "Title (Monthly)" → rows imported. Grouped: one live export can list a
  // repeating to-do more than once.
  const recurring = new Map<string, number>();
  const details: string[] = [];
  const warnings: string[] = [];
  const teamValues = new Set<string>();
  let otherTeam = 0;

  for (const row of table.rows) {
    ctx.preview.begin(row);
    const title = cell(row, table.headers, "Title", "Name", "To-Do", "Todo", "Task");
    if (!title) {
      skipped++;
      continue;
    }

    const rowTeam = rowTeamOf(row, table.headers);
    if (rowTeam) teamValues.add(rowTeam);
    if (isOtherTeam(rowTeam, ctx.rockTeam)) {
      skipped++;
      otherTeam++;
      ctx.preview.add({ kind: "todos", action: "skip", title, owner: "—", detail: [], note: otherTeamNote(rowTeam), otherTeam: rowTeam });
      continue;
    }

    if (
      rejectOverLength(ctx.preview, "todos", title, [
        ["Title", title, TITLE_MAX],
        ["Description", normalizeDescription(cell(row, table.headers, "Description", "Notes")), LONG_TEXT_MAX],
        ["Owner name", cell(row, table.headers, "Owner", "Owner Name", "Accountable", "Assignee"), TITLE_MAX],
      ])
    ) {
      skipped++;
      tooLong++;
      continue;
    }

    if (!ctx.archive && !ctx.includeArchived && isArchived(row, table.headers)) {
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

    const { uid: ownerId, unmatchedName } = await ctx.owners.resolveOwner(
      cell(row, table.headers, "Owner", "Owner Name", "Accountable", "Assignee"),
    );
    // Blank (ninety "Unassigned") or unmatched: No Owner unless asked to skip.
    if (ownerId === null && ctx.unmatchedOwner !== "no-owner") {
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

    const todoId = importDocId("todo", ctx.teamId, ctx.archive ? `${title}|${archiveKey(row, table.headers)}` : title);
    const isNew = !ctx.existingIds.has(todoId);

    if (
      !isNew &&
      ctx.existingRows === "keep" &&
      (await fillImportedOwner(ctx, { kind: "todos", collection: "todos", docId: todoId, ownerId: ownerId, title }))
    ) {
      ownersFilled++;
      continue;
    }
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
      // The owner note can push an in-limit description over the cap; check
      // what is actually stored, or the first edit of this row would fail.
      if (
        rejectOverLength(ctx.preview, "todos", title, [
          ["Description (with the imported owner note)", description, LONG_TEXT_MAX],
        ])
      ) {
        skipped++;
        tooLong++;
        continue;
      }
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
      source_link: importedLink(cell(row, table.headers, "Link", "URL")),
      import_source: "csv",
      ...(isNew
        ? { archived_at: archivedAtFor(row, table.headers, !!ctx.archive) }
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

    // The app has no recurring to-dos, so a repeating one lands once — worth
    // a warning for live rows only. Rows that weren't imported don't count,
    // and an archived export lists each past occurrence as its own row
    // (still marked Monthly): those are history, not schedules to recreate.
    const repeat = cell(row, table.headers, "Repeat", "Recurrence", "Repeats");
    if (!ctx.archive && repeat && isRecurring(repeat)) {
      const key = `${title} (${repeat})`;
      recurring.set(key, (recurring.get(key) ?? 0) + 1);
    }
  }

  if (otherTeam) details.push(`${otherTeam} for other departments, not imported`);
  if (tooLong) details.push(`${tooLong} over the length limit, not imported`);
  if (!ctx.rockTeam && teamValues.size > 1) {
    warnings.push(
      `To-dos span ${teamValues.size} departments in the file (${[...teamValues].join(", ")}). All landed on this app team — set a Department filter to import only one.`,
    );
  }
  if (archived) details.push(`${archived} archived held back`);
  if (stale) details.push(`${stale} completed before ${ctx.completedSince}`);
  if (noOwner) details.push(`${noOwner} imported as No Owner`);
  if (unchanged) details.push(`${unchanged} already here, left as they are`);
  if (ownersFilled) details.push(`${ownersFilled} already here without an owner — owner filled in`);
  if (recurring.size > 0) {
    const list = [...recurring].map(([key, n]) => (n > 1 ? `${key} ×${n}` : key));
    warnings.push(
      `${recurring.size} to-do(s) repeat on a schedule in ninety — the app has no recurring to-dos, so each was imported once and needs re-creating when due: ${list.slice(0, 5).join("; ")}${list.length > 5 ? "…" : ""}`,
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
