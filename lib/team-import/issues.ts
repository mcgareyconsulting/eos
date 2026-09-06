import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  cell,
  importDocId,
  normalizeDescription,
  parseDateOnly,
  type CsvTable,
} from "../csv-import";
import type { KindStats } from "../team-import-types";
import {
  archivedAtFrom,
  createdAtFrom,
  isArchived,
  isStaleCompletion,
  normalizeIssuePriority,
  normalizeIssueStatus,
  normalizeIssueType,
} from "./normalize";
import type { OwnerResolver, PreviewCollector, Writer } from "./owners";
import { withUnmatchedOwnerNote } from "./owners";

export async function importIssues(
  table: CsvTable,
  ctx: {
    teamId: string;
    writer: Writer;
    owners: OwnerResolver;
    existingIds: Set<string>;
    includeArchived: boolean;
    completedSince: string | null;
    sheetName?: string;
    unmatchedOwner: "skip" | "no-owner";
    preview: PreviewCollector;
    existingRows: "keep" | "update";
  },
): Promise<KindStats> {
  let imported = 0;
  let skipped = 0;
  let noOwner = 0;
  let unchanged = 0;
  let archived = 0;
  let stale = 0;
  let shortCount = 0;
  let longCount = 0;
  const details: string[] = [];
  const warnings: string[] = [];

  for (const row of table.rows) {
    const title = cell(row, table.headers, "Title", "Name", "Issue");
    if (!title) {
      skipped++;
      continue;
    }

    if (!ctx.includeArchived && isArchived(row, table.headers)) {
      archived++;
      ctx.preview.add({
        kind: "issues",
        action: "skip",
        title,
        owner: "—",
        detail: [],
        note: "Archived in the file — tick Include archived rows to import it",
      });
      continue;
    }

    const completedOn = parseDateOnly(
      cell(row, table.headers, "Completed On", "Completed", "Resolved On"),
    );
    if (isStaleCompletion(completedOn, ctx.completedSince)) {
      stale++;
      ctx.preview.add({
        kind: "issues",
        action: "skip",
        title,
        owner: "—",
        detail: [],
        note: `Completed ${completedOn} — before the back-import cutoff`,
      });
      continue;
    }

    const { uid: ownerId, unmatchedName } = await ctx.owners.resolveOwner(
      cell(row, table.headers, "Owner", "Owner Name", "Accountable", "Assignee"),
    );
    if (ownerId === null && !(unmatchedName && ctx.unmatchedOwner === "no-owner")) {
      skipped++;
      ctx.preview.add({
        kind: "issues",
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

    const type = normalizeIssueType(
      cell(row, table.headers, "Type", "Term", "Horizon"),
      ctx.sheetName,
    );
    const status = normalizeIssueStatus(cell(row, table.headers, "Status"), completedOn);
    const priority = normalizeIssuePriority(cell(row, table.headers, "Priority"));
    const resolved = status === "solved" || status === "dropped";

    const issueId = importDocId("issue", ctx.teamId, `${type}|${title}`);
    const isNew = !ctx.existingIds.has(issueId);

    if (!isNew && ctx.existingRows === "keep") {
      unchanged++;
      ctx.preview.add({
        kind: "issues",
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

    await ctx.writer.set(["issues", issueId], {
      team_id: ctx.teamId,
      title,
      description,
      owner_id: ownerId,
      ...(isNew ? { votes: 0 } : {}),
      type,
      priority,
      status,
      resolved_at: resolved
        ? completedOn
          ? Timestamp.fromDate(new Date(`${completedOn}T00:00:00`))
          : FieldValue.serverTimestamp()
        : null,
      resolution_todo_id: null,
      source_meeting_id: null,
      source_link: cell(row, table.headers, "Link", "URL") || null,
      import_source: "csv",
      ...(isNew
        ? { archived_at: archivedAtFrom(row, table.headers) }
        : {}),
      ...(isNew ? { created_at: createdAtFrom(row, table.headers) } : {}),
    });
    ctx.preview.add({
      kind: "issues",
      action: isNew ? "create" : "update",
      title,
      owner: ownerId ? ctx.owners.nameFor(ownerId) : "No Owner",
      detail: [
        type === "long" ? "long-term" : "short-term",
        status,
        ...(priority ? [priority] : []),
      ],
      note:
        ownerId === null && unmatchedName
          ? `"${unmatchedName}" is not on the team — kept in the description`
          : undefined,
    });
    imported++;
    if (type === "long") longCount++;
    else shortCount++;
  }

  details.push(`${shortCount} short-term, ${longCount} long-term`);
  if (archived) details.push(`${archived} archived held back`);
  if (stale) details.push(`${stale} completed before ${ctx.completedSince}`);
  if (noOwner) details.push(`${noOwner} imported as No Owner`);
  if (unchanged) details.push(`${unchanged} already here, left as they are`);

  return {
    kind: "issues",
    label: ctx.sheetName ? `issues [${ctx.sheetName}]` : "issues",
    imported,
    skipped,
    unchanged,
    details,
    warnings,
  };
}
