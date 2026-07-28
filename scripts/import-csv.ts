// CSV importer — seeds real client data (scorecard, rocks, milestones) into a
// team, from ninety.io-style exports or any spreadsheet with the same columns.
//
// Usage:
//   pnpm import:csv --team "Leadership Team" \
//     --scorecard ~/Downloads/scorecard.csv \
//     --rocks ~/Downloads/rocks.csv \
//     --milestones ~/Downloads/milestones.csv \
//     --dry-run
//
// Options:
//   --team <name|id>     Target team. Matched by doc id first, then by name.  [required]
//   --create-team        Create the team when the name doesn't exist yet.
//   --leader <email|uid> Add this account to the team as leader (your login).
//   --leader-name <name> Make the member behind this CSV Owner name the leader —
//                        for a leader who hasn't signed in yet, so has no account.
//   --member <email|uid> Add this account as a member. Repeatable.
//   --scorecard <file>   Scorecard export (wide: one column per week).
//   --rocks <file>       Rocks export.
//   --milestones <file>  Milestones export (linked to rocks by "Rock Name").
//   --todos <file>       Standalone to-dos (not tied to a rock).
//   --as-of <YYYY-MM-DD> Anchor for undated week headers ("Jul 27 - Aug 2").
//                        Defaults to today; set it when importing a stale export.
//   --dry-run            Parse, resolve, and report. Writes nothing.
//   --owner-alias "CSV Name=email|uid"
//                        Pin one CSV owner name to a specific account. Repeatable.
//   --owner-fallback <email|uid|name>
//                        Assign unmatched owners to this existing member instead
//                        of creating a placeholder for them.
//   --no-create-owners   Never create placeholder members; skip rows whose owner
//                        can't be resolved (unless --owner-fallback is set).
//   --include-archived   Import rows the export marks archived — scorecard rows
//                        whose Status says archived/inactive, and to-dos or
//                        milestones carrying an "Archived Date".
//   --completed-since <YYYY-MM-DD>
//                        Back-import cutoff: drop to-dos/milestones completed
//                        before this date. Open rows always import, however old.
//   --rock-team <value>  Import only rocks/milestones whose "Team" column matches.
//
// Standing up a fresh team from an export, with you on it:
//   pnpm import:csv --team "Enterprise Systems & Data" --create-team \
//     --leader you@example.com --rocks rocks.csv --milestones milestones.csv
//
// Re-runnable: every imported doc gets a deterministic id derived from the team
// and the row's natural key (metric name / rock title / rock+milestone title),
// so importing a corrected file updates rows in place instead of duplicating
// them. Rows the app already had (created in-app, auto-id) are left alone.

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { DocumentData, Firestore, WriteBatch } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "../lib/firebase/admin";
import { currentQuarter, endOfQuarter, toDateString } from "../lib/dates";
import {
  cell,
  importDocId,
  inferUnit,
  normalizeKey,
  normalizePersonKey,
  normalizeQuarter,
  normalizeRockStatus,
  normalizeRockType,
  parseDateOnly,
  parseDelimited,
  parseGoal,
  parseNumericValue,
  parseWeekHeader,
  slugify,
  toTable,
  type CsvTable,
} from "../lib/csv-import";
import { pickSheet, readXlsx } from "../lib/xlsx";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

type Args = {
  project?: string;
  database?: string;
  team: string;
  createTeam: boolean;
  leader?: string;
  leaderName?: string;
  members: string[];
  scorecard?: string;
  rocks?: string;
  milestones?: string;
  todos?: string;
  scorecardSheet?: string;
  rocksSheet?: string;
  milestonesSheet?: string;
  todosSheet?: string;
  asOf: Date;
  dryRun: boolean;
  ownerAliases: string[];
  ownerFallback?: string;
  createOwners: boolean;
  includeArchived: boolean;
  completedSince: string | null;
  rockTeam?: string;
};

function parseArgs(argv: string[]): Args {
  // Values accumulate per key so repeatable flags (--owner-alias) work.
  const flags = new Map<string, (string | true)[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    // `next !== undefined`, not `next` — `--database ""` (meaning "the default
    // database") passes an empty string, which is a value, not an absent one.
    const value: string | true =
      next !== undefined && !next.startsWith("--") ? next : true;
    if (typeof value === "string") i++;
    flags.set(key, [...(flags.get(key) ?? []), value]);
  }

  const str = (k: string): string | undefined => {
    const v = flags.get(k)?.at(-1);
    return typeof v === "string" ? v : undefined;
  };
  const list = (k: string): string[] =>
    (flags.get(k) ?? []).filter((v): v is string => typeof v === "string");

  const team = str("team");
  if (!team) {
    console.error(
      "Missing --team. Run `pnpm team:info` to list teams, then:\n" +
        '  pnpm import:csv --team "Leadership Team" --scorecard scorecard.csv --dry-run',
    );
    process.exit(1);
  }

  const asOfRaw = str("as-of");
  const asOf = asOfRaw ? new Date(`${asOfRaw}T00:00:00`) : new Date();
  if (Number.isNaN(asOf.getTime())) {
    console.error(`--as-of must be YYYY-MM-DD (got "${asOfRaw}")`);
    process.exit(1);
  }

  // Compared as a plain YYYY-MM-DD string against parseDateOnly output, so it
  // has to be exactly that shape — a Date parse would accept "Jan 2024" and
  // then compare wrong.
  const completedSince = str("completed-since") ?? null;
  if (completedSince && !/^\d{4}-\d{2}-\d{2}$/.test(completedSince)) {
    console.error(`--completed-since must be YYYY-MM-DD (got "${completedSince}")`);
    process.exit(1);
  }

  if (!str("scorecard") && !str("rocks") && !str("milestones") && !str("todos")) {
    console.error(
      "Nothing to import — pass at least one of --scorecard / --rocks / --milestones / --todos.",
    );
    process.exit(1);
  }

  return {
    project: str("project"),
    database: str("database"),
    team,
    createTeam: flags.has("create-team"),
    leader: str("leader"),
    leaderName: str("leader-name"),
    members: list("member"),
    scorecard: str("scorecard"),
    rocks: str("rocks"),
    milestones: str("milestones"),
    todos: str("todos"),
    scorecardSheet: str("scorecard-sheet"),
    rocksSheet: str("rocks-sheet"),
    milestonesSheet: str("milestones-sheet"),
    todosSheet: str("todos-sheet"),
    asOf,
    dryRun: flags.has("dry-run"),
    ownerAliases: list("owner-alias"),
    ownerFallback: str("owner-fallback"),
    createOwners: !flags.has("no-create-owners"),
    includeArchived: flags.has("include-archived"),
    completedSince,
    rockTeam: str("rock-team"),
  };
}

// Accepts .csv, .tsv, or .xlsx. Ninety exports Rocks and Milestones as one
// two-sheet workbook, so an .xlsx picks its sheet by name (`--*-sheet`), else
// the first sheet whose name looks right, else the first sheet.
function readTable(path: string, prefer: RegExp, sheetName?: string): CsvTable {
  let rows: string[][];
  let label = path;

  if (/\.xlsx$/i.test(path)) {
    const sheets = readXlsx(readFileSync(path));
    const sheet = pickSheet(sheets, sheetName, prefer);
    rows = sheet.rows;
    label = `${path} [${sheet.name}]`;
    console.log(
      `  reading "${sheet.name}" of ${sheets.length} sheet(s): ${sheets.map((s) => s.name).join(", ")}`,
    );
  } else {
    rows = parseDelimited(readFileSync(path, "utf8"));
  }

  const table = toTable(rows);
  if (table.rows.length === 0) console.warn(`⚠ ${label} has no data rows.`);
  return table;
}

// ---------------------------------------------------------------------------
// Batched writes (Firestore caps a batch at 500 ops)
// ---------------------------------------------------------------------------

class Writer {
  private batch: WriteBatch;
  private pending = 0;
  written = 0;

  constructor(
    private db: Firestore,
    private dryRun: boolean,
  ) {
    this.batch = db.batch();
  }

  async set(path: [string, string], data: DocumentData) {
    this.written++;
    if (this.dryRun) return;
    this.batch.set(this.db.collection(path[0]).doc(path[1]), data, { merge: true });
    if (++this.pending >= 400) await this.flush();
  }

  async flush() {
    if (this.dryRun || this.pending === 0) return;
    await this.batch.commit();
    this.batch = this.db.batch();
    this.pending = 0;
  }
}

// ---------------------------------------------------------------------------
// Owner resolution
// ---------------------------------------------------------------------------

type Member = { user_id: string; names: string[] };

// Builds a lookup from every handle a member might appear under in an export:
// display name, "First Last", email, and the email's local part.
async function loadMembers(db: Firestore, teamId: string): Promise<Member[]> {
  const membersSnap = await db
    .collection("team_members")
    .where("team_id", "==", teamId)
    .get();
  const ids = membersSnap.docs.map((d) => d.data().user_id as string);
  if (ids.length === 0) return [];

  const userDocs = await db.getAll(...ids.map((id) => db.collection("users").doc(id)));
  return ids.map((id, i) => {
    const data = userDocs[i]?.data() ?? {};
    const first = (data.first_name as string) ?? "";
    const last = (data.last_name as string) ?? "";
    const email = (data.email as string) ?? "";
    const names = [
      data.display_name as string,
      `${first} ${last}`.trim(),
      email,
      email.includes("@") ? email.split("@")[0].replace(/[._]/g, " ") : "",
      id,
    ].filter((n): n is string => !!n && n.trim() !== "");
    return { user_id: id, names };
  });
}

class OwnerResolver {
  private index = new Map<string, string>();
  private cache = new Map<string, string | null>();
  created: { user_id: string; name: string }[] = [];
  unresolved = new Set<string>();

  constructor(
    private teamId: string,
    members: Member[],
    private opts: {
      createOwners: boolean;
      fallbackId: string | null;
      aliases?: Map<string, string>;
      writer: Writer;
    },
  ) {
    for (const m of members) {
      for (const n of m.names) {
        const key = normalizePersonKey(n);
        if (key && !this.index.has(key)) this.index.set(key, m.user_id);
      }
    }
  }

  // Read-only lookup of an already-known name (a member, an alias target, or a
  // placeholder created earlier this run). Never creates anything.
  lookup(name: string): string | null {
    const key = normalizePersonKey(name);
    return this.opts.aliases?.get(key) ?? this.index.get(key) ?? null;
  }

  // Returns a uid, or null when the row should be skipped. Placeholder members
  // get an `import-` prefixed id (mirroring the seed script's `demo-` prefix)
  // so they're obvious in team-info output and easy to clean up later.
  async resolve(rawName: string): Promise<string | null> {
    const raw = (rawName ?? "").trim();
    if (!raw) return this.opts.fallbackId;

    const key = normalizePersonKey(raw);
    if (this.cache.has(key)) return this.cache.get(key)!;

    let uid = this.opts.aliases?.get(key) ?? this.index.get(key) ?? null;

    // Last-name-only or first-name-only cells ("Sarah") match when unambiguous.
    if (!uid && !key.includes(" ")) {
      const partial = [...this.index.entries()].filter(([k]) =>
        k.split(" ").includes(key),
      );
      if (partial.length === 1) uid = partial[0][1];
    }

    if (!uid && this.opts.createOwners) {
      uid = `import-${slugify(raw, 32)}`;
      const [first, ...rest] = raw.split(/\s+/);
      await this.opts.writer.set(
        ["users", uid],
        {
          display_name: raw,
          first_name: first ?? raw,
          last_name: rest.join(" ") || null,
          email: null,
          created_via: "csv-import",
        },
      );
      await this.opts.writer.set(
        ["team_members", `${this.teamId}__${uid}`],
        {
          team_id: this.teamId,
          user_id: uid,
          role: "member",
          created_at: FieldValue.serverTimestamp(),
        },
      );
      this.index.set(key, uid);
      this.created.push({ user_id: uid, name: raw });
    }

    if (!uid) {
      uid = this.opts.fallbackId;
      if (!uid) this.unresolved.add(raw);
    }

    this.cache.set(key, uid);
    return uid;
  }
}

// ---------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------

async function importScorecard(
  table: CsvTable,
  ctx: {
    teamId: string;
    writer: Writer;
    owners: OwnerResolver;
    asOf: Date;
    includeArchived: boolean;
    existingIds: Set<string>;
  },
) {
  const weekColumns = table.headers
    .map((h) => ({ header: h, week: parseWeekHeader(h, ctx.asOf) }))
    .filter((c): c is { header: string; week: string } => c.week !== null);

  if (weekColumns.length === 0) {
    console.warn(
      "⚠ scorecard: no week columns recognized. Expected headers like " +
        '"Jul 27 - Aug 2" or "7/27/2026" — metrics will import with no history.',
    );
  }

  let metrics = 0;
  let entries = 0;
  let skipped = 0;

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

    const ownerId = await ctx.owners.resolve(
      cell(row, table.headers, "Owner", "Owner Name", "Accountable"),
    );
    if (ownerId === null) {
      skipped++;
      continue;
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
      // Not rendered today; kept so the note survives if the UI grows a field.
      description: cell(row, table.headers, "Description") || null,
      sort_order: i,
      import_source: "csv",
      ...(isNew ? { created_at: FieldValue.serverTimestamp() } : {}),
    });
    metrics++;

    for (const col of weekColumns) {
      const value = parseNumericValue(row[col.header] ?? "");
      if (value === null) continue; // blank week — leave the cell empty
      await ctx.writer.set(["scorecard_entries", `${metricId}__${col.week}`], {
        metric_id: metricId,
        week_start_date: col.week,
        value,
        note: null,
        import_source: "csv",
        created_at: FieldValue.serverTimestamp(),
      });
      entries++;
    }
  }

  const weekRange = weekColumns.length
    ? ` (${weekColumns[weekColumns.length - 1].week} → ${weekColumns[0].week})`
    : "";
  console.log(
    `  scorecard: ${metrics} metrics, ${entries} weekly entries across ${weekColumns.length} week columns${weekRange}` +
      (skipped ? `, ${skipped} rows skipped` : ""),
  );
}

// ---------------------------------------------------------------------------
// Rocks
// ---------------------------------------------------------------------------

async function importRocks(
  table: CsvTable,
  ctx: {
    teamId: string;
    writer: Writer;
    owners: OwnerResolver;
    existingIds: Set<string>;
    rockTeam?: string;
  },
): Promise<Map<string, string>> {
  const rockIdByTitle = new Map<string, string>();
  const teamValues = new Set<string>();
  let imported = 0;
  let skipped = 0;
  let attachments = 0;

  for (const row of table.rows) {
    const title = cell(row, table.headers, "Title", "Name", "Rock", "Rock Name");
    if (!title) {
      skipped++;
      continue;
    }

    const rowTeam = cell(row, table.headers, "Team");
    if (rowTeam) teamValues.add(rowTeam);
    if (ctx.rockTeam && normalizeKey(rowTeam) !== normalizeKey(ctx.rockTeam)) {
      skipped++;
      continue;
    }

    const completedOn = parseDateOnly(cell(row, table.headers, "Completed On", "Completed", "Completed Date"));
    const dueDate = parseDateOnly(cell(row, table.headers, "Due Date", "Due"));
    const createdDate = parseDateOnly(cell(row, table.headers, "Created Date", "Created"));
    const status = normalizeRockStatus(cell(row, table.headers, "Status"), completedOn);

    const ownerId = await ctx.owners.resolve(
      cell(row, table.headers, "Owner", "Owner Name", "Accountable"),
    );
    if (ownerId === null) {
      skipped++;
      continue;
    }

    if (cell(row, table.headers, "Attachment Names", "Attachments")) attachments++;

    const rockId = importDocId("rock", ctx.teamId, title);
    const isNew = !ctx.existingIds.has(rockId);

    await ctx.writer.set(["rocks", rockId], {
      team_id: ctx.teamId,
      title,
      description: cell(row, table.headers, "Description") || null,
      status,
      rock_type: normalizeRockType(cell(row, table.headers, "Level", "Type", "Rock Type")),
      quarter:
        normalizeQuarter(cell(row, table.headers, "Quarter"), dueDate) ?? currentQuarter(),
      owner_id: ownerId,
      due_date: dueDate ?? toDateString(endOfQuarter()),
      completed_at: completedOn ? Timestamp.fromDate(new Date(`${completedOn}T00:00:00`)) : null,
      // No attachments feature yet — the source link is kept so the reference
      // isn't lost when the client's ninety account goes away.
      source_link: cell(row, table.headers, "Link", "URL") || null,
      import_source: "csv",
      ...(isNew
        ? {
            created_at: createdDate
              ? Timestamp.fromDate(new Date(`${createdDate}T00:00:00`))
              : FieldValue.serverTimestamp(),
          }
        : {}),
    });

    rockIdByTitle.set(normalizeKey(title), rockId);
    imported++;
  }

  console.log(
    `  rocks: ${imported} imported${skipped ? `, ${skipped} skipped` : ""}` +
      (attachments ? `  (${attachments} rows had attachments — not imported, no attachments feature yet)` : ""),
  );
  if (!ctx.rockTeam && teamValues.size > 1) {
    console.warn(
      `  ⚠ rocks span ${teamValues.size} teams in the file (${[...teamValues].join(", ")}). ` +
        `All landed on the target team — re-run with --rock-team "<value>" to split them.`,
    );
  }

  return rockIdByTitle;
}

// ---------------------------------------------------------------------------
// Shared row helpers for the to-do-shaped exports (milestones + to-dos)
// ---------------------------------------------------------------------------

// ninety.io exports carry archived rows inline, marked only by a non-empty
// "Archived Date" — there's no Status column to key off the way the scorecard
// has. An archived to-do has no completion date either, so importing it lands
// it in the *open* list forever and buries the live items under dead ones.
function isArchived(row: Record<string, string>, headers: string[]): boolean {
  const archivedOn = cell(row, headers, "Archived Date", "Archived On", "Archived");
  if (archivedOn) return true;
  return /archiv|deleted/i.test(cell(row, headers, "Status"));
}

// History cutoff for a back-import. Only *completed* rows are subject to it —
// an old open to-do is still live work and always comes in. Both the To-Dos
// page and the live L10 segment render the Done list unbounded and oldest
// first, so importing years of closed rows pushes the real work off screen.
function isStaleCompletion(completedOn: string | null, since: string | null): boolean {
  return !!since && !!completedOn && completedOn < since;
}

// Use the export's own creation date when it has one, so age and "created"
// ordering survive the import. Falls back to the server clock for new docs.
function createdAtFrom(row: Record<string, string>, headers: string[]) {
  const created = parseDateOnly(cell(row, headers, "Created Date", "Created On", "Created"));
  return created
    ? Timestamp.fromDate(new Date(`${created}T00:00:00`))
    : FieldValue.serverTimestamp();
}

// ---------------------------------------------------------------------------
// Milestones (todos with source_rock_id)
// ---------------------------------------------------------------------------

async function importMilestones(
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
  },
) {
  let imported = 0;
  let skipped = 0;
  let archived = 0;
  let stale = 0;
  const missingRocks = new Set<string>();

  for (const row of table.rows) {
    const title = cell(row, table.headers, "Title", "Name", "Milestone");
    const rockName = cell(row, table.headers, "Rock Name", "Rock", "Parent Rock");
    if (!title) {
      skipped++;
      continue;
    }

    if (!ctx.includeArchived && isArchived(row, table.headers)) {
      archived++;
      continue;
    }

    const rockId = ctx.rockIdByTitle.get(normalizeKey(rockName));
    if (!rockId) {
      missingRocks.add(rockName || "(blank)");
      skipped++;
      continue;
    }

    const ownerId = await ctx.owners.resolve(
      cell(row, table.headers, "Owner", "Owner Name", "Accountable"),
    );
    if (ownerId === null) {
      skipped++;
      continue;
    }

    const completedOn = parseDateOnly(cell(row, table.headers, "Completed On", "Completed"));
    if (isStaleCompletion(completedOn, ctx.completedSince)) {
      stale++;
      continue;
    }

    const dueDate = parseDateOnly(cell(row, table.headers, "Due Date", "Due"));
    const todoId = importDocId("milestone", ctx.teamId, `${rockName}|${title}`);
    const isNew = !ctx.existingIds.has(todoId);

    await ctx.writer.set(["todos", todoId], {
      team_id: ctx.teamId,
      title,
      description: cell(row, table.headers, "Description") || null,
      owner_id: ownerId,
      due_date: dueDate ?? toDateString(endOfQuarter()),
      completed_at: completedOn ? Timestamp.fromDate(new Date(`${completedOn}T00:00:00`)) : null,
      visibility: "team",
      source_issue_id: null,
      source_meeting_id: null,
      source_rock_id: rockId,
      source_link: cell(row, table.headers, "Link", "URL") || null,
      import_source: "csv",
      ...(isNew ? { created_at: createdAtFrom(row, table.headers) } : {}),
    });
    imported++;
  }

  console.log(
    `  milestones: ${imported} imported${skipped ? `, ${skipped} skipped` : ""}` +
      `${archived ? `, ${archived} archived (use --include-archived to import)` : ""}` +
      `${stale ? `, ${stale} completed before ${ctx.completedSince}` : ""}`,
  );
  if (missingRocks.size > 0) {
    console.warn(
      `  ⚠ ${missingRocks.size} milestone(s) reference a rock that isn't in the target team:\n` +
        [...missingRocks].map((r) => `      • ${r}`).join("\n") +
        "\n      Import the rocks file in the same run (or first) so they can be linked.",
    );
  }
}

// ---------------------------------------------------------------------------
// To-dos (standalone — same collection as milestones, but no source_rock_id)
// ---------------------------------------------------------------------------

async function importTodos(
  table: CsvTable,
  ctx: {
    teamId: string;
    writer: Writer;
    owners: OwnerResolver;
    existingIds: Set<string>;
    includeArchived: boolean;
    completedSince: string | null;
  },
) {
  let imported = 0;
  let skipped = 0;
  let archived = 0;
  let stale = 0;
  const recurring: string[] = [];

  for (const row of table.rows) {
    const title = cell(row, table.headers, "Title", "Name", "To-Do", "Todo", "Task");
    if (!title) {
      skipped++;
      continue;
    }

    if (!ctx.includeArchived && isArchived(row, table.headers)) {
      archived++;
      continue;
    }

    // No recurrence in the data model — a repeating to-do imports as a single
    // item on its next due date. Collected so the run reports what needs
    // re-creating by hand rather than dropping it silently.
    const repeat = cell(row, table.headers, "Repeat", "Recurrence", "Repeats");
    if (repeat && !/^(no|none|never|one[- ]?time)$/i.test(repeat)) {
      recurring.push(`${title} (${repeat})`);
    }

    const ownerId = await ctx.owners.resolve(
      cell(row, table.headers, "Owner", "Owner Name", "Accountable", "Assignee"),
    );
    if (ownerId === null) {
      skipped++;
      continue;
    }

    const completedOn = parseDateOnly(cell(row, table.headers, "Completed On", "Completed"));
    if (isStaleCompletion(completedOn, ctx.completedSince)) {
      stale++;
      continue;
    }

    const dueDate = parseDateOnly(cell(row, table.headers, "Due Date", "Due"));
    // Private to-dos are the owner's alone; anything else is visible to the
    // team, which is what makes it show up in the L10 To-Dos segment.
    const visibility = /^priv/i.test(cell(row, table.headers, "Visibility", "Private"))
      ? "private"
      : "team";

    const todoId = importDocId("todo", ctx.teamId, title);
    const isNew = !ctx.existingIds.has(todoId);

    await ctx.writer.set(["todos", todoId], {
      team_id: ctx.teamId,
      title,
      description: cell(row, table.headers, "Description", "Notes") || null,
      owner_id: ownerId,
      due_date: dueDate ?? toDateString(endOfQuarter()),
      completed_at: completedOn ? Timestamp.fromDate(new Date(`${completedOn}T00:00:00`)) : null,
      visibility,
      source_issue_id: null,
      source_meeting_id: null,
      source_rock_id: null,
      source_link: cell(row, table.headers, "Link", "URL") || null,
      import_source: "csv",
      ...(isNew ? { created_at: createdAtFrom(row, table.headers) } : {}),
    });
    imported++;
  }

  console.log(
    `  to-dos: ${imported} imported${skipped ? `, ${skipped} skipped` : ""}` +
      `${archived ? `, ${archived} archived (use --include-archived to import)` : ""}` +
      `${stale ? `, ${stale} completed before ${ctx.completedSince}` : ""}`,
  );
  if (recurring.length > 0) {
    console.warn(
      `  ⚠ ${recurring.length} to-do(s) repeat on a schedule, imported as one-offs:\n` +
        recurring.map((r) => `      • ${r}`).join("\n"),
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function resolveTeam(
  db: Firestore,
  teamArg: string,
  opts: { createTeam: boolean; dryRun: boolean },
): Promise<{ id: string; name: string; created: boolean }> {
  const byId = await db.collection("teams").doc(teamArg).get();
  if (byId.exists) {
    return { id: byId.id, name: (byId.data()?.name as string) ?? teamArg, created: false };
  }

  const byName = await db.collection("teams").where("name", "==", teamArg).get();
  if (byName.size === 1) {
    return {
      id: byName.docs[0].id,
      name: byName.docs[0].data().name as string,
      created: false,
    };
  }
  if (byName.size > 1) {
    console.error(
      `${byName.size} teams named "${teamArg}" — pass the team id instead:\n` +
        byName.docs.map((d) => `  ${d.id}`).join("\n"),
    );
    process.exit(1);
  }

  // Creating a team is opt-in: a typo'd --team should fail loudly, not quietly
  // stand up "Enterprse Systems & Data" next to the real one.
  if (opts.createTeam) {
    const ref = db.collection("teams").doc();
    if (!opts.dryRun) {
      await ref.set({
        name: teamArg,
        org_id: "default",
        parent_team_id: null,
        created_at: FieldValue.serverTimestamp(),
      });
    }
    return { id: ref.id, name: teamArg, created: true };
  }

  const all = await db.collection("teams").get();
  console.error(
    `No team matched "${teamArg}". Pass --create-team to create it, or use one of:\n` +
      all.docs.map((d) => `  • ${d.data().name} (${d.id})`).join("\n"),
  );
  process.exit(1);
}

// Attaches the operator's own account to the team as leader, resolving an email
// through Firebase Auth so the membership lands on the uid they actually sign in
// with. Mirrors `pnpm seed` — including the emulator carve-out, where there's no
// real Google sign-in to do first.
async function attachAccount(
  teamId: string,
  account: string,
  role: "leader" | "member",
  writer: Writer,
): Promise<Member> {
  const auth = getAdminAuth();
  const onAuthEmulator = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

  let uid = account;
  let user: import("firebase-admin/auth").UserRecord | null = null;
  try {
    user = account.includes("@")
      ? await auth.getUserByEmail(account)
      : await auth.getUser(account);
    uid = user.uid;
  } catch {
    if (account.includes("@") && onAuthEmulator) {
      user = await auth.createUser({ email: account, emailVerified: true });
      uid = user.uid;
      console.log(`Created emulator auth user for "${account}".`);
    } else if (account.includes("@")) {
      console.error(
        `No Firebase Auth user for "${account}" — sign in to the app once, then re-run.\n` +
          `  (Or pass the uid directly if you know it.)`,
      );
      process.exit(1);
    }
    // A raw uid we couldn't look up — proceed with it as given.
  }

  const displayName = user?.displayName ?? user?.email ?? account;
  await writer.set(["users", uid], {
    display_name: displayName,
    email: user?.email ?? (account.includes("@") ? account : null),
    picture: user?.photoURL ?? null,
  });
  await writer.set(["team_members", `${teamId}__${uid}`], {
    team_id: teamId,
    user_id: uid,
    role,
    created_at: FieldValue.serverTimestamp(),
  });

  console.log(`${role === "leader" ? "Leader" : "Member"}: ${user?.email ?? account} (uid ${uid})`);
  return {
    user_id: uid,
    names: [displayName, user?.email ?? "", account].filter((n) => n && n.trim() !== ""),
  };
}

// Ids of docs this importer previously created for the team, so a re-import
// preserves the original created_at instead of bumping it every run.
async function loadExistingIds(db: Firestore, teamId: string, collections: string[]) {
  const sets = await Promise.all(
    collections.map(async (c) => {
      const snap = await db.collection(c).where("team_id", "==", teamId).select().get();
      return snap.docs.map((d) => d.id);
    }),
  );
  return new Set(sets.flat());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // --project/--database override .env.local. Set before the admin SDK is
  // touched (getAdminDb reads them lazily) so pointing at the trial project
  // doesn't mean editing .env.local and remembering to put it back.
  if (args.project) process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = args.project;
  if (args.database !== undefined) process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID = args.database;

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const databaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID;
  console.log(
    `\nProject: ${projectId ?? "(from credentials)"}   Database: ${databaseId || "(default)"}` +
      (process.env.FIRESTORE_EMULATOR_HOST ? `   [EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST}]` : ""),
  );

  const db = getAdminDb();

  const team = await resolveTeam(db, args.team, {
    createTeam: args.createTeam,
    dryRun: args.dryRun,
  });
  console.log(
    `\nTarget: "${team.name}" (${team.id})${team.created ? " — NEW TEAM" : ""}` +
      (args.dryRun ? "   [DRY RUN — nothing will be written]" : ""),
  );

  const writer = new Writer(db, args.dryRun);

  const members = await loadMembers(db, team.id);
  // Injected into `members` rather than re-read: in a dry run the membership
  // isn't written, and owner matching still needs to see them.
  const attach = async (account: string, role: "leader" | "member") => {
    const m = await attachAccount(team.id, account, role, writer);
    if (!members.some((existing) => existing.user_id === m.user_id)) members.push(m);
  };
  if (args.leader) await attach(args.leader, "leader");
  for (const m of args.members) await attach(m, "member");
  console.log(`Members on this team: ${members.length}`);

  let fallbackId: string | null = null;
  if (args.ownerFallback) {
    const key = normalizePersonKey(args.ownerFallback);
    const match = members.find((m) => m.names.some((n) => normalizePersonKey(n) === key));
    if (!match) {
      console.error(`--owner-fallback "${args.ownerFallback}" is not a member of this team.`);
      process.exit(1);
    }
    fallbackId = match.user_id;
  }

  // --owner-alias "Dan McGarey=me@example.com": pins a CSV name onto a specific
  // member, for when the export spells someone differently than their account.
  const aliases = new Map<string, string>();
  for (const raw of args.ownerAliases) {
    const [csvName, target] = raw.split("=").map((s) => s.trim());
    if (!csvName || !target) {
      console.error(`--owner-alias must look like "CSV Name=email-or-uid" (got "${raw}")`);
      process.exit(1);
    }
    const targetKey = normalizePersonKey(target);
    const match = members.find(
      (m) => m.user_id === target || m.names.some((n) => normalizePersonKey(n) === targetKey),
    );
    if (!match) {
      console.error(`--owner-alias target "${target}" is not a member of this team.`);
      process.exit(1);
    }
    aliases.set(normalizePersonKey(csvName), match.user_id);
  }

  const owners = new OwnerResolver(team.id, members, {
    createOwners: args.createOwners,
    fallbackId,
    aliases,
    writer,
  });

  const existingIds = await loadExistingIds(db, team.id, [
    "scorecard_metrics",
    "rocks",
    "todos",
  ]);

  console.log("");
  if (args.scorecard) {
    await importScorecard(readTable(args.scorecard, /scorecard|measurable|metric/i, args.scorecardSheet), {
      teamId: team.id,
      writer,
      owners,
      asOf: args.asOf,
      includeArchived: args.includeArchived,
      existingIds,
    });
  }

  // Rocks before milestones: milestones link by rock title, and the map is
  // built from this run's rocks.
  let rockIdByTitle = new Map<string, string>();
  if (args.rocks) {
    rockIdByTitle = await importRocks(readTable(args.rocks, /rock/i, args.rocksSheet), {
      teamId: team.id,
      writer,
      owners,
      existingIds,
      rockTeam: args.rockTeam,
    });
  }

  if (args.milestones) {
    // Milestones can also attach to rocks already in the team (imported on an
    // earlier run, or created in-app), so fold those titles in as well.
    const existingRocks = await db.collection("rocks").where("team_id", "==", team.id).get();
    for (const d of existingRocks.docs) {
      const key = normalizeKey((d.data().title as string) ?? "");
      if (key && !rockIdByTitle.has(key)) rockIdByTitle.set(key, d.id);
    }

    await importMilestones(readTable(args.milestones, /milestone/i, args.milestonesSheet), {
      teamId: team.id,
      writer,
      owners,
      existingIds,
      rockIdByTitle,
      rockTeam: args.rockTeam,
      includeArchived: args.includeArchived,
      completedSince: args.completedSince,
    });
  }

  if (args.todos) {
    await importTodos(readTable(args.todos, /to-?dos?|task/i, args.todosSheet), {
      teamId: team.id,
      writer,
      owners,
      existingIds,
      includeArchived: args.includeArchived,
      completedSince: args.completedSince,
    });
  }

  // Promoting by name runs after the imports: the member behind that name may
  // only have been created moments ago, from an Owner cell.
  if (args.leaderName) {
    const uid = owners.lookup(args.leaderName);
    if (!uid) {
      console.warn(
        `⚠ --leader-name "${args.leaderName}" didn't match any owner in the files or member of the team — no leader set.`,
      );
    } else {
      await writer.set(["team_members", `${team.id}__${uid}`], {
        team_id: team.id,
        user_id: uid,
        role: "leader",
      });
      console.log(`\nLeader: ${args.leaderName} (uid ${uid})`);
    }
  }

  await writer.flush();

  console.log("");
  if (owners.created.length > 0) {
    console.log(
      `Created ${owners.created.length} placeholder member(s) — they show up as team members ` +
        `with no login until the real account signs in:\n` +
        owners.created.map((c) => `  • ${c.name}  (${c.user_id})`).join("\n"),
    );
  }
  if (owners.unresolved.size > 0) {
    console.warn(
      `⚠ Skipped rows for ${owners.unresolved.size} unresolved owner(s): ${[...owners.unresolved].join(", ")}\n` +
        `  Drop --no-create-owners, or pass --owner-fallback <member> to park them on someone.`,
    );
  }

  console.log(
    args.dryRun
      ? `Dry run complete — ${writer.written} write(s) planned. Re-run without --dry-run to apply.`
      : `Done — ${writer.written} document(s) written.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
