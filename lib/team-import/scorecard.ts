import { FieldValue } from "firebase-admin/firestore";
import {
  groupDocId,
  groupNameKey,
  normalizeGroupName,
} from "../scorecard-groups";
import {
  cell,
  importDocId,
  inferUnit,
  normalizeDescription,
  parseGoal,
  parseNumericValue,
  parseWeekHeader,
  type CsvTable,
} from "../csv-import";
import type { KindStats } from "../team-import-types";
import type { OwnerResolver, PreviewCollector, Writer } from "./owners";
import { withUnmatchedOwnerNote } from "./owners";

export async function importScorecard(
  table: CsvTable,
  ctx: {
    teamId: string;
    writer: Writer;
    owners: OwnerResolver;
    asOf: Date;
    includeArchived: boolean;
    existingIds: Set<string>;
    unmatchedOwner: "skip" | "no-owner";
    preview: PreviewCollector;
  },
): Promise<KindStats> {
  const weekColumns = table.headers
    .map((h) => ({ header: h, week: parseWeekHeader(h, ctx.asOf) }))
    .filter((c): c is { header: string; week: string } => c.week !== null);

  const details: string[] = [];
  const warnings: string[] = [];
  if (weekColumns.length === 0) {
    warnings.push(
      'No week columns recognized. Expected headers like "Jul 27 - Aug 2" or "7/27/2026".',
    );
  }

  let metrics = 0;
  let entries = 0;
  let skipped = 0;
  let noOwner = 0;
  // First-seen order becomes sort_order, so a file whose rows run
  // Weekly-then-Compliance produces exactly that order with nobody setting it
  // by hand. Everything imports weekly, so every group created here is weekly.
  const groupOrder = new Map<string, { name: string; order: number }>();

  for (const [i, row] of table.rows.entries()) {
    const name = cell(row, table.headers, "Title", "Name", "Metric", "Measurable");
    if (!name) {
      skipped++;
      continue;
    }

    const status = cell(row, table.headers, "Status");
    if (!ctx.includeArchived && /archiv|inactive|paused|deleted/i.test(status)) {
      skipped++;
      continue;
    }

    const goalRaw = cell(row, table.headers, "Goal", "Target");
    const parsed = parseGoal(goalRaw);
    const sampleValues = weekColumns.map((c) => row[c.header] ?? "");
    const unit = inferUnit(parsed.unit, sampleValues);

    // Same No Owner contract as rocks / todos / issues / headlines: a name that matches nobody must not silently drop the
    // measurable — it imports unowned with the original name kept in the
    // description. This matters more here than elsewhere, because a dropped
    // scorecard row takes its whole history of week values with it.
    const { uid: ownerId, unmatchedName } = await ctx.owners.resolveOwner(
      cell(row, table.headers, "Owner", "Owner Name", "Accountable"),
    );
    const allowNullOwner =
      unmatchedName !== null && ctx.unmatchedOwner === "no-owner";
    if (ownerId === null && !allowNullOwner) {
      skipped++;
      ctx.preview.add({
        kind: "scorecard",
        action: "skip",
        title: name,
        owner: unmatchedName ?? "—",
        detail: [],
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

    const metricId = importDocId("metric", ctx.teamId, name);
    const isNew = !ctx.existingIds.has(metricId);

    await ctx.writer.set(["scorecard_metrics", metricId], {
      team_id: ctx.teamId,
      name,
      unit,
      goal: parsed.goal,
      direction: parsed.direction,
      owner_id: ownerId,
      group: cell(row, table.headers, "Group Name", "Group", "Section") || null,
      // Every imported measurable lands weekly. The file's week columns are
      // weekly periods, so this is right for the data we can read — but a
      // monthly or quarterly measurable imports into the wrong interval tab
      // and has to be corrected on the Scorecard tab. Called out on the
      // Import page rather than guessed at.
      interval: "weekly",
      description,
      sort_order: i,
      import_source: "csv",
      ...(isNew ? { created_at: FieldValue.serverTimestamp() } : {}),
    });
    metrics++;

    let rowEntries = 0;
    for (const col of weekColumns) {
      const value = parseNumericValue(row[col.header] ?? "");
      if (value === null) continue;
      await ctx.writer.set(["scorecard_entries", `${metricId}__${col.week}`], {
        metric_id: metricId,
        week_start_date: col.week,
        value,
        note: null,
        import_source: "csv",
        created_at: FieldValue.serverTimestamp(),
      });
      entries++;
      rowEntries++;
    }

    // Scorecard is the only kind that writes two collections, so the preview
    // says how much history rides along with each measurable — otherwise the
    // write count reads as wrong against the row count.
    const group = cell(row, table.headers, "Group Name", "Group", "Section");
    const groupName = normalizeGroupName(group);
    if (groupName) {
      const key = groupNameKey(groupName);
      if (!groupOrder.has(key)) {
        groupOrder.set(key, { name: groupName, order: groupOrder.size });
      }
    }
    ctx.preview.add({
      kind: "scorecard",
      action: isNew ? "create" : "update",
      title: name,
      owner: ownerId ? ctx.owners.nameFor(ownerId) : "No Owner",
      detail: [
        group ? `Group: ${group}` : "No group",
        unit,
        `${rowEntries} ${rowEntries === 1 ? "period" : "periods"}`,
      ],
      note:
        ownerId === null && unmatchedName
          ? `"${unmatchedName}" is not on the team — imported with No Owner`
          : rowEntries === 0
            ? "Measurable only — no values in the week columns"
            : undefined,
    });
  }

  // Create a group doc per distinct Group Name so the label carries a period
  // and a position, not just a string on each metric.
  //
  // Only for groups that don't exist yet. Writer.set merges, so re-importing
  // the same file would otherwise reset `sort_order` and `interval` — silently
  // undoing a hand-reordered list or a group someone moved to monthly. An
  // existing group keeps whatever the team set.
  let newGroups = 0;
  for (const { name, order } of groupOrder.values()) {
    const id = groupDocId(ctx.teamId, name);
    if (ctx.existingIds.has(id)) continue;
    await ctx.writer.set(["scorecard_groups", id], {
      team_id: ctx.teamId,
      name,
      interval: "weekly",
      sort_order: order,
      import_source: "csv",
    });
    newGroups++;
  }

  if (weekColumns.length) {
    details.push(
      `${entries} weekly entries across ${weekColumns.length} week columns`,
    );
  }
  if (groupOrder.size) {
    const names = [...groupOrder.values()].map((g) => g.name).join(", ");
    details.push(
      `${groupOrder.size} ${groupOrder.size === 1 ? "group" : "groups"}: ${names}` +
        (newGroups === groupOrder.size
          ? ""
          : ` (${groupOrder.size - newGroups} already set up — order kept)`),
    );
  }
  if (noOwner) details.push(`${noOwner} imported with No Owner`);
  // Everything imports weekly; say so rather than let it be discovered later.
  if (metrics) details.push("all created as weekly measurables");

  return {
    kind: "scorecard",
    label: "scorecard",
    imported: metrics,
    skipped,
    details,
    warnings,
  };
}
