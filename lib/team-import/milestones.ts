import { Timestamp } from "firebase-admin/firestore";
import { endOfQuarter, toDateString } from "../dates";
import {
  cell,
  importDocId,
  normalizeDescription,
  normalizeKey,
  parseDateOnly,
  type CsvTable,
} from "../csv-import";
import type { KindStats } from "../team-import-types";
import { archivedAtFrom, createdAtFrom, isArchived, isStaleCompletion } from "./normalize";
import type { OwnerResolver, PreviewCollector, Writer } from "./owners";
import { withUnmatchedOwnerNote } from "./owners";

export async function importMilestones(
  table: CsvTable,
  ctx: {
    teamId: string;
    writer: Writer;
    owners: OwnerResolver;
    existingIds: Set<string>;
    rockIdByTitle: Map<string, string>;
    rockTeam?: string;
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
  const missingRocks = new Set<string>();
  const details: string[] = [];
  const warnings: string[] = [];

  for (const row of table.rows) {
    const title = cell(row, table.headers, "Title", "Name", "Milestone");
    const rockName = cell(row, table.headers, "Rock Name", "Rock", "Parent Rock");
    if (!title) {
      skipped++;
      continue;
    }

    if (!ctx.includeArchived && isArchived(row, table.headers)) {
      archived++;
      ctx.preview.add({
        kind: "milestones",
        action: "skip",
        title,
        owner: "—",
        detail: [`rock: ${rockName || "—"}`],
        note: "Archived in the file — tick Include archived rows to import it",
      });
      continue;
    }

    const rockId = ctx.rockIdByTitle.get(normalizeKey(rockName));
    if (!rockId) {
      missingRocks.add(rockName || "(blank)");
      skipped++;
      ctx.preview.add({
        kind: "milestones",
        action: "skip",
        title,
        owner: "—",
        detail: [`rock: ${rockName || "—"}`],
        note: rockName
          ? `No rock named "${rockName}" on this team`
          : "No Rock Name column value — nothing to attach it to",
      });
      continue;
    }

    const { uid: ownerId, unmatchedName } = await ctx.owners.resolveOwner(
      cell(row, table.headers, "Owner", "Owner Name", "Accountable"),
    );
    if (ownerId === null && !(unmatchedName && ctx.unmatchedOwner === "no-owner")) {
      skipped++;
      ctx.preview.add({
        kind: "milestones",
        action: "skip",
        title,
        owner: unmatchedName ?? "—",
        detail: [`rock: ${rockName || "—"}`],
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
        kind: "milestones",
        action: "skip",
        title,
        owner: ctx.owners.nameFor(ownerId),
        detail: [`rock: ${rockName || "—"}`],
        note: `Completed ${completedOn} — before the back-import cutoff`,
      });
      continue;
    }

    let description =
      normalizeDescription(cell(row, table.headers, "Description")) || null;
    if (ownerId === null && unmatchedName) {
      description = withUnmatchedOwnerNote(description, unmatchedName);
      noOwner++;
    }

    const dueDate = parseDateOnly(cell(row, table.headers, "Due Date", "Due"));
    const todoId = importDocId("milestone", ctx.teamId, `${rockName}|${title}`);
    const isNew = !ctx.existingIds.has(todoId);

    if (!isNew && ctx.existingRows === "keep") {
      unchanged++;
      ctx.preview.add({
        kind: "milestones",
        action: "skip",
        title,
        owner: ctx.owners.nameFor(ownerId),
        detail: [`rock: ${rockName || "—"}`],
        note: "Already on the team — left as it is",
      });
      continue;
    }

    await ctx.writer.set(["todos", todoId], {
      team_id: ctx.teamId,
      title,
      description,
      owner_id: ownerId,
      due_date: dueDate ?? toDateString(endOfQuarter()),
      completed_at: completedOn ? Timestamp.fromDate(new Date(`${completedOn}T00:00:00`)) : null,
      visibility: "team",
      source_issue_id: null,
      source_meeting_id: null,
      source_rock_id: rockId,
      source_link: cell(row, table.headers, "Link", "URL") || null,
      import_source: "csv",
      ...(isNew
        ? { archived_at: archivedAtFrom(row, table.headers) }
        : {}),
      ...(isNew ? { created_at: createdAtFrom(row, table.headers) } : {}),
    });
    ctx.preview.add({
      kind: "milestones",
      action: isNew ? "create" : "update",
      title,
      owner: ownerId ? ctx.owners.nameFor(ownerId) : "No Owner",
      detail: [
        `rock: ${rockName || "—"}`,
        `due ${dueDate ?? toDateString(endOfQuarter())}`,
        completedOn ? "done" : "open",
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
  if (missingRocks.size > 0) {
    warnings.push(
      `${missingRocks.size} milestone(s) reference a rock that isn't on the team: ${[...missingRocks].slice(0, 8).join(", ")}${missingRocks.size > 8 ? "…" : ""}`,
    );
  }

  return {
    kind: "milestones",
    label: "milestones",
    imported,
    skipped,
    unchanged,
    details,
    warnings,
  };
}
