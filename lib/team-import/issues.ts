import { FieldValue, Timestamp } from "firebase-admin/firestore";
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
  isOtherTeam,
  isStaleCompletion,
  otherTeamNote,
  normalizeIssuePriority,
  normalizeIssueStatus,
  normalizeIssueType,
  rejectOverLength,
  rowTeamOf,
} from "./normalize";
import type { OwnerResolver, PreviewCollector, Writer } from "./owners";
import { fillImportedOwner, withUnmatchedOwnerNote, withWhoNote, type Ownerless } from "./owners";

export async function importIssues(
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
    sheetName?: string;
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
  let noOwner = 0;
  let unchanged = 0;
  let ownersFilled = 0;
  let tooLong = 0;
  let archived = 0;
  let stale = 0;
  let shortCount = 0;
  let longCount = 0;
  const details: string[] = [];
  const warnings: string[] = [];
  const teamValues = new Set<string>();
  let otherTeam = 0;
  let withWho = 0;

  for (const row of table.rows) {
    ctx.preview.begin(row);
    const title = cell(row, table.headers, "Title", "Name", "Issue");
    if (!title) {
      skipped++;
      continue;
    }

    const rowTeam = rowTeamOf(row, table.headers);
    if (rowTeam) teamValues.add(rowTeam);
    if (isOtherTeam(rowTeam, ctx.rockTeam)) {
      skipped++;
      otherTeam++;
      ctx.preview.add({ kind: "issues", action: "skip", title, owner: "—", detail: [], note: otherTeamNote(rowTeam) });
      continue;
    }

    if (
      rejectOverLength(ctx.preview, "issues", title, [
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
    // Blank (ninety "Unassigned") or unmatched: No Owner unless asked to skip.
    if (ownerId === null && ctx.unmatchedOwner !== "no-owner") {
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

    const issueId = importDocId(
      "issue",
      ctx.teamId,
      ctx.archive ? `${type}|${title}|${archiveKey(row, table.headers)}` : `${type}|${title}`,
    );
    const isNew = !ctx.existingIds.has(issueId);

    if (
      !isNew &&
      ctx.existingRows === "keep" &&
      (await fillImportedOwner(ctx, { kind: "issues", collection: "issues", docId: issueId, ownerId: ownerId, title }))
    ) {
      ownersFilled++;
      continue;
    }
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
    // ninety's Who column: blank in every export seen so far, and its meaning
    // (assignee? raised-by?) is unconfirmed. Keep a value as text rather than
    // guess at assigned_by, which carries follow/notification semantics.
    const who = cell(row, table.headers, "Who");
    if (who) {
      description = withWhoNote(description, who);
      withWho++;
      if (
        rejectOverLength(ctx.preview, "issues", title, [
          ["Description (with the Who note)", description, LONG_TEXT_MAX],
        ])
      ) {
        skipped++;
        tooLong++;
        continue;
      }
    }
    if (ownerId === null && unmatchedName) {
      description = withUnmatchedOwnerNote(description, unmatchedName);
      // The owner note can push an in-limit description over the cap; check
      // what is actually stored, or the first edit of this row would fail.
      if (
        rejectOverLength(ctx.preview, "issues", title, [
          ["Description (with the imported owner note)", description, LONG_TEXT_MAX],
        ])
      ) {
        skipped++;
        tooLong++;
        continue;
      }
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
      source_link: importedLink(cell(row, table.headers, "Link", "URL")),
      import_source: "csv",
      ...(isNew
        ? { archived_at: archivedAtFor(row, table.headers, !!ctx.archive) }
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
  if (withWho) {
    warnings.push(
      `${withWho} issue(s) have a Who value — kept as a "Who:" line in the description. Tell us what this column means for your team and we can map it.`,
    );
  }
  if (otherTeam) details.push(`${otherTeam} for other departments, not imported`);
  if (tooLong) details.push(`${tooLong} over the length limit, not imported`);
  if (!ctx.rockTeam && teamValues.size > 1) {
    warnings.push(
      `Issues span ${teamValues.size} departments in the file (${[...teamValues].join(", ")}). All landed on this app team — set a Department filter to import only one.`,
    );
  }
  if (archived) details.push(`${archived} archived held back`);
  if (stale) details.push(`${stale} completed before ${ctx.completedSince}`);
  if (noOwner) details.push(`${noOwner} imported as No Owner`);
  if (unchanged) details.push(`${unchanged} already here, left as they are`);
  if (ownersFilled) details.push(`${ownersFilled} already here without an owner — owner filled in`);

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
