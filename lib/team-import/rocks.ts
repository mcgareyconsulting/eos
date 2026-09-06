import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { currentQuarter, endOfQuarter, toDateString } from "../dates";
import {
  cell,
  importDocId,
  normalizeDescription,
  normalizeKey,
  normalizeQuarter,
  normalizeRockStatus,
  normalizeRockType,
  parseDateOnly,
  type CsvTable,
} from "../csv-import";
import type { KindStats } from "../team-import-types";
import { archivedAtFrom, isArchived, rockTypeLabel } from "./normalize";
import type { OwnerResolver, PreviewCollector, Writer } from "./owners";
import { withUnmatchedOwnerNote } from "./owners";

export async function importRocks(
  table: CsvTable,
  ctx: {
    teamId: string;
    writer: Writer;
    owners: OwnerResolver;
    existingIds: Set<string>;
    rockTeam?: string;
    existingRows: "keep" | "update";
    unmatchedOwner: "skip" | "no-owner";
    includeArchived: boolean;
    preview: PreviewCollector;
  },
): Promise<{ stats: KindStats; rockIdByTitle: Map<string, string> }> {
  const rockIdByTitle = new Map<string, string>();
  const teamValues = new Set<string>();
  let imported = 0;
  let skipped = 0;
  let unchanged = 0;
  let noOwner = 0;
  let archived = 0;
  let attachments = 0;
  const warnings: string[] = [];
  const details: string[] = [];

  for (const row of table.rows) {
    const title = cell(row, table.headers, "Title", "Name", "Rock", "Rock Name");
    if (!title) {
      skipped++;
      continue;
    }

    // Ninety "Team" column = department name in this org (ESD, Leadership, …).
    const rowTeam = cell(
      row,
      table.headers,
      "Team",
      "Department",
      "Dept",
      "Department Name",
    );
    if (rowTeam) teamValues.add(rowTeam);
    if (ctx.rockTeam && normalizeKey(rowTeam) !== normalizeKey(ctx.rockTeam)) {
      skipped++;
      continue;
    }

    // Rocks had no archived filter at all, while the Import page told users
    // archived rows are skipped by default — true for every other kind but
    // not this one.
    if (!ctx.includeArchived && isArchived(row, table.headers)) {
      archived++;
      ctx.preview.add({
        kind: "rocks",
        action: "skip",
        title,
        owner: "—",
        detail: [],
        note: "Archived in the file — tick Include archived rows to import it",
      });
      continue;
    }

    const completedOn = parseDateOnly(
      cell(row, table.headers, "Completed On", "Completed", "Completed Date"),
    );
    const dueDate = parseDateOnly(cell(row, table.headers, "Due Date", "Due"));
    const createdDate = parseDateOnly(cell(row, table.headers, "Created Date", "Created"));
    const status = normalizeRockStatus(cell(row, table.headers, "Status"), completedOn);
    const rockType = normalizeRockType(
      cell(row, table.headers, "Level", "Type", "Rock Type"),
    );

    // Department-level rocks belong to the department list even when the
    // accountable person is from another roster or unresolved — import them
    // with a null owner (shared department) rather than skipping.
    // Department-typed rocks still import when the owner can't be resolved
    // (they land in the Department section as shared ownership).
    const { uid: ownerId, unmatchedName } = await ctx.owners.resolveOwner(
      cell(row, table.headers, "Owner", "Owner Name", "Accountable"),
    );
    // A department rock always tolerates a null owner (shared ownership); any
    // rock does when the Owner name simply matched nobody and the caller asked
    // for No Owner rather than a dropped row.
    const allowNullOwner =
      rockType === "department" ||
      (unmatchedName !== null && ctx.unmatchedOwner === "no-owner");
    if (ownerId === null && !allowNullOwner) {
      skipped++;
      ctx.preview.add({
        kind: "rocks",
        action: "skip",
        title,
        owner: unmatchedName ?? "—",
        detail: [rockTypeLabel(rockType)],
        note: unmatchedName
          ? `No team member matches "${unmatchedName}"`
          : "No Owner in the file",
      });
      continue;
    }

    let description =
      normalizeDescription(cell(row, table.headers, "Description")) || null;
    if (ownerId === null && unmatchedName) {
      description = withUnmatchedOwnerNote(description, unmatchedName);
      noOwner++;
    }

    if (cell(row, table.headers, "Attachment Names", "Attachments")) attachments++;

    const rockId = importDocId("rock", ctx.teamId, title);
    const isNew = !ctx.existingIds.has(rockId);

    // Leave the stored rock alone, but still map it so this file's
    // milestones can attach to it.
    if (!isNew && ctx.existingRows === "keep") {
      rockIdByTitle.set(normalizeKey(title), rockId);
      unchanged++;
      ctx.preview.add({
        kind: "rocks",
        action: "skip",
        title,
        owner: ctx.owners.nameFor(ownerId),
        detail: [rockTypeLabel(rockType)],
        note: "Already on the team — left as it is",
      });
      continue;
    }

    // Done without a Completed On still needs a clock for the Monday archive
    // sweep — use import time. Non-done rocks keep completed_at null.
    const completedAt =
      status === "done"
        ? completedOn
          ? Timestamp.fromDate(new Date(`${completedOn}T00:00:00`))
          : FieldValue.serverTimestamp()
        : null;

    await ctx.writer.set(["rocks", rockId], {
      team_id: ctx.teamId,
      title,
      description,
      status,
      rock_type: rockType,
      quarter:
        normalizeQuarter(cell(row, table.headers, "Quarter"), dueDate) ?? currentQuarter(),
      owner_id: ownerId,
      due_date: dueDate ?? toDateString(endOfQuarter()),
      completed_at: completedAt,
      source_link: cell(row, table.headers, "Link", "URL") || null,
      import_source: "csv",
      ...(isNew
        ? {
            archived_at: archivedAtFrom(row, table.headers),
            created_at: createdDate
              ? Timestamp.fromDate(new Date(`${createdDate}T00:00:00`))
              : FieldValue.serverTimestamp(),
          }
        : {}),
    });

    ctx.preview.add({
      kind: "rocks",
      action: isNew ? "create" : "update",
      title,
      owner: ownerId ? ctx.owners.nameFor(ownerId) : "No Owner",
      detail: [
        rockTypeLabel(rockType),
        normalizeQuarter(cell(row, table.headers, "Quarter"), dueDate) ??
          currentQuarter(),
        `due ${dueDate ?? toDateString(endOfQuarter())}`,
        status,
      ],
      note:
        ownerId === null && unmatchedName
          ? `"${unmatchedName}" is not on the team — kept in the description`
          : undefined,
    });
    rockIdByTitle.set(normalizeKey(title), rockId);
    imported++;
  }

  if (attachments) {
    details.push(`${attachments} rows had attachments (not imported)`);
  }
  if (unchanged) {
    details.push(`${unchanged} existing rock(s) left untouched`);
  }
  if (noOwner) {
    details.push(`${noOwner} imported as No Owner`);
  }
  if (archived) {
    details.push(`${archived} archived held back`);
  }
  if (!ctx.rockTeam && teamValues.size > 1) {
    warnings.push(
      `Rocks span ${teamValues.size} departments in the file (${[...teamValues].join(", ")}). All landed on this app team — set a Department filter to import only one.`,
    );
  }

  return {
    stats: {
      kind: "rocks",
      label: "rocks",
      imported,
      skipped,
      unchanged,
      details,
      warnings,
    },
    rockIdByTitle,
  };
}
