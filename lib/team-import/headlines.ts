import {
  cell,
  importDocId,
  normalizeDescription,
  normalizeKey,
  type CsvTable,
} from "../csv-import";
import type { KindStats } from "../team-import-types";
import { archivedAtFrom, createdAtFrom, isArchived, normalizeHeadlineKind } from "./normalize";
import type { OwnerResolver, PreviewCollector, Writer } from "./owners";

export async function importHeadlines(
  table: CsvTable & { sheetName?: string },
  ctx: {
    teamId: string;
    writer: Writer;
    owners: OwnerResolver;
    existingIds: Set<string>;
    includeArchived: boolean;
    rockTeam?: string;
    preview: PreviewCollector;
    existingRows: "keep" | "update";
  },
): Promise<KindStats> {
  let imported = 0;
  let unchanged = 0;
  let skipped = 0;
  let archived = 0;
  let broadcast = 0;
  const sheetName = table.sheetName;
  const details: string[] = [];
  const warnings: string[] = [];

  for (const row of table.rows) {
    const title = cell(row, table.headers, "Title", "Name", "Headline");
    if (!title) {
      skipped++;
      continue;
    }
    if (!ctx.includeArchived && isArchived(row, table.headers)) {
      archived++;
      ctx.preview.add({
        kind: "headlines",
        action: "skip",
        title,
        owner: "—",
        detail: [],
        note: "Archived in the file — tick Include archived rows to import it",
      });
      continue;
    }

    const rowTeam = cell(
      row,
      table.headers,
      "Team",
      "Department",
      "Dept",
      "Department Name",
    );
    if (
      ctx.rockTeam &&
      rowTeam &&
      normalizeKey(rowTeam) !== normalizeKey(ctx.rockTeam)
    ) {
      skipped++;
      continue;
    }

    const kind = normalizeHeadlineKind(
      cell(row, table.headers, "Type", "Kind", "Category"),
      sheetName,
    );

    const ownerRaw = cell(
      row,
      table.headers,
      "Owner",
      "Owner Name",
      "Accountable",
      "From Name",
    );
    const createdBy = ownerRaw ? ctx.owners.lookup(ownerRaw) : null;
    const fromLabel = cell(row, table.headers, "From", "Source", "Team From");
    const cleanFrom =
      fromLabel && fromLabel !== "-" && fromLabel.trim() ? fromLabel.trim() : null;

    const isBroadcast = kind === "cascading" && !createdBy;

    const bodyRaw = normalizeDescription(
      cell(row, table.headers, "Description", "Notes", "Body", "Detail"),
    );
    let body = bodyRaw || null;
    if (cleanFrom && isBroadcast) {
      body = body ? `From: ${cleanFrom}\n\n${body}` : `From: ${cleanFrom}`;
    }

    const headlineId = importDocId("headline", ctx.teamId, `${kind}|${title}`);
    const isNew = !ctx.existingIds.has(headlineId);

    if (!isNew && ctx.existingRows === "keep") {
      unchanged++;
      ctx.preview.add({
        kind: "headlines",
        action: "skip",
        title,
        owner: createdBy ? ctx.owners.nameFor(createdBy) : ownerRaw || "—",
        detail: [],
        note: "Already on the team — left as it is",
      });
      continue;
    }

    await ctx.writer.set(["headlines", headlineId], {
      team_id: ctx.teamId,
      title,
      body,
      kind,
      created_by: createdBy,
      target_team_ids: [] as string[],
      from_label: cleanFrom,
      source_owner_name: createdBy ? null : ownerRaw || null,
      broadcast: isBroadcast,
      source_link: cell(row, table.headers, "Link", "URL") || null,
      import_source: "csv",
      ...(isNew
        ? { archived_at: archivedAtFrom(row, table.headers) }
        : {}),
      ...(isNew ? { created_at: createdAtFrom(row, table.headers) } : {}),
    });
    ctx.preview.add({
      kind: "headlines",
      action: isNew ? "create" : "update",
      title,
      // Headlines resolve with lookup() and keep an unmatched name in
      // source_owner_name rather than skipping the row.
      owner: createdBy ? ctx.owners.nameFor(createdBy) : ownerRaw || "—",
      detail: [kind, ...(isBroadcast ? ["broadcast"] : [])],
      note:
        !createdBy && ownerRaw
          ? `"${ownerRaw}" is not on the team — kept as the From label`
          : undefined,
    });
    imported++;
    if (isBroadcast) broadcast++;
  }

  if (broadcast) details.push(`${broadcast} broadcast / read-only`);
  if (archived) details.push(`${archived} archived held back`);

  return {
    kind: "headlines",
    label: sheetName ? `headlines [${sheetName}]` : "headlines",
    imported,
    skipped,
    unchanged,
    details,
    warnings,
  };
}
