// Shared team data importer — used by `pnpm import:csv` and the in-app
// Import page. Parses CSV/TSV/XLSX (ninety-style columns) and upserts
// scorecard / rocks / milestones / todos / issues / headlines into Firestore.
//
// IO-light: callers supply a Firestore handle and file buffers/tables.
// Re-import is idempotent via deterministic `imp-*` doc ids.

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { DocumentData, Firestore, WriteBatch } from "firebase-admin/firestore";
import { currentQuarter, endOfQuarter, toDateString } from "./dates";
import {
  cell,
  importDocId,
  inferUnit,
  normalizeKey,
  normalizePersonKey,
  normalizeQuarter,
  normalizeDescription,
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
} from "./csv-import";
import { pickSheet, readXlsx, type XlsxSheet } from "./xlsx";
import type { ImportKind, ImportReport, KindStats } from "./team-import-types";

export type { ImportKind, ImportReport, KindStats } from "./team-import-types";

export type TeamImportOptions = {
  dryRun?: boolean;
  /** Create placeholder members for unmatched Owner names (default true for CLI). */
  createOwners?: boolean;
  /** Park unmatched owners on this existing member uid. */
  fallbackOwnerId?: string | null;
  /** CSV Name → member uid. */
  ownerAliases?: Map<string, string>;
  includeArchived?: boolean;
  /** Drop completed todos/milestones/issues before this YYYY-MM-DD. */
  completedSince?: string | null;
  /**
   * Filter rocks/milestones/headlines by the export's Team/Department column
   * (e.g. "Enterprise Systems & Data"). UI label: Department.
   */
  rockTeam?: string;
  asOf?: Date;
};

export type TeamImportInputs = {
  scorecard?: { table: CsvTable };
  rocks?: { table: CsvTable };
  milestones?: { table: CsvTable };
  todos?: { table: CsvTable };
  /** Issues may be multi-sheet. */
  issues?: { tables: (CsvTable & { sheetName?: string })[] };
  headlines?: { tables: (CsvTable & { sheetName?: string })[] };
};

// ---------------------------------------------------------------------------
// File → table(s)
// ---------------------------------------------------------------------------

export function tableFromBytes(
  bytes: Uint8Array | Buffer,
  filename: string,
  prefer: RegExp,
  sheetName?: string,
): CsvTable {
  const name = filename.toLowerCase();
  let rows: string[][];

  if (name.endsWith(".xlsx")) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const sheets = readXlsx(buf);
    const sheet = pickSheet(sheets, sheetName, prefer);
    rows = sheet.rows;
  } else {
    const text = Buffer.isBuffer(bytes)
      ? bytes.toString("utf8")
      : new TextDecoder("utf-8").decode(bytes);
    rows = parseDelimited(text);
  }

  return toTable(rows);
}

export function issueTablesFromBytes(
  bytes: Uint8Array | Buffer,
  filename: string,
  sheetName?: string,
): (CsvTable & { sheetName?: string })[] {
  const name = filename.toLowerCase();
  if (!name.endsWith(".xlsx")) {
    return [tableFromBytes(bytes, filename, /issue|short|long/i, sheetName)];
  }

  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const sheets = readXlsx(buf);
  if (sheetName) {
    const sheet = pickSheet(sheets, sheetName, /issue|short|long/i);
    return [Object.assign(toTable(sheet.rows), { sheetName: sheet.name })];
  }

  const prefer = /issue|short.?term|long.?term/i;
  const picked = sheets.filter((s) => prefer.test(s.name));
  const use = picked.length > 0 ? picked : sheets;
  return use.map((sheet) =>
    Object.assign(toTable(sheet.rows), { sheetName: sheet.name }),
  );
}

export function headlineTablesFromBytes(
  bytes: Uint8Array | Buffer,
  filename: string,
  sheetName?: string,
): (CsvTable & { sheetName?: string })[] {
  const name = filename.toLowerCase();
  if (!name.endsWith(".xlsx")) {
    return [tableFromBytes(bytes, filename, /headline|cascad/i, sheetName)];
  }

  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const sheets = readXlsx(buf);
  if (sheetName) {
    const sheet = pickSheet(sheets, sheetName, /headline|cascad/i);
    return [Object.assign(toTable(sheet.rows), { sheetName: sheet.name })];
  }

  const prefer = /headline|cascad/i;
  const picked = sheets.filter((s) => prefer.test(s.name));
  const use = picked.length > 0 ? picked : sheets;
  return use.map((sheet) =>
    Object.assign(toTable(sheet.rows), { sheetName: sheet.name }),
  );
}

/** List sheet names in an .xlsx (empty for CSV). */
export function listSheetNames(bytes: Uint8Array | Buffer, filename: string): string[] {
  if (!filename.toLowerCase().endsWith(".xlsx")) return [];
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return readXlsx(buf).map((s: XlsxSheet) => s.name);
}

// ---------------------------------------------------------------------------
// Batched writes
// ---------------------------------------------------------------------------

export class Writer {
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

export type Member = { user_id: string; names: string[] };

export async function loadMembers(db: Firestore, teamId: string): Promise<Member[]> {
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

export class OwnerResolver {
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

  lookup(name: string): string | null {
    const key = normalizePersonKey(name);
    return this.opts.aliases?.get(key) ?? this.index.get(key) ?? null;
  }

  async resolve(rawName: string): Promise<string | null> {
    const raw = (rawName ?? "").trim();
    if (!raw) return this.opts.fallbackId;

    const key = normalizePersonKey(raw);
    if (this.cache.has(key)) return this.cache.get(key)!;

    let uid = this.opts.aliases?.get(key) ?? this.index.get(key) ?? null;

    if (!uid && !key.includes(" ")) {
      const partial = [...this.index.entries()].filter(([k]) =>
        k.split(" ").includes(key),
      );
      if (partial.length === 1) uid = partial[0][1];
    }

    if (!uid && this.opts.createOwners) {
      uid = `import-${slugify(raw, 32)}`;
      const [first, ...rest] = raw.split(/\s+/);
      await this.opts.writer.set(["users", uid], {
        display_name: raw,
        first_name: first ?? raw,
        last_name: rest.join(" ") || null,
        email: null,
        created_via: "csv-import",
      });
      await this.opts.writer.set(["team_members", `${this.teamId}__${uid}`], {
        team_id: this.teamId,
        user_id: uid,
        role: "member",
        created_at: FieldValue.serverTimestamp(),
      });
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

export async function loadExistingIds(
  db: Firestore,
  teamId: string,
  collections: string[],
): Promise<Set<string>> {
  const sets = await Promise.all(
    collections.map(async (c) => {
      const snap = await db.collection(c).where("team_id", "==", teamId).select().get();
      return snap.docs.map((d) => d.id);
    }),
  );
  return new Set(sets.flat());
}

// ---------------------------------------------------------------------------
// Shared row helpers
// ---------------------------------------------------------------------------

function isArchived(row: Record<string, string>, headers: string[]): boolean {
  const archivedOn = cell(row, headers, "Archived Date", "Archived On", "Archived");
  if (archivedOn) return true;
  return /archiv|deleted/i.test(cell(row, headers, "Status"));
}

function isStaleCompletion(completedOn: string | null, since: string | null): boolean {
  return !!since && !!completedOn && completedOn < since;
}

function isRecurring(raw: string): boolean {
  const s = raw
    .toLowerCase()
    .replace(/[''`‘’]/g, "")
    .replace(/[\s_-]+/g, " ")
    .trim();
  if (!s) return false;
  return !/^(no|none|never|off|one time|no repeat|dont repeat|doesnt repeat|does not repeat|do not repeat)$/.test(
    s,
  );
}

function createdAtFrom(row: Record<string, string>, headers: string[]) {
  const created = parseDateOnly(cell(row, headers, "Created Date", "Created On", "Created"));
  return created
    ? Timestamp.fromDate(new Date(`${created}T00:00:00`))
    : FieldValue.serverTimestamp();
}

function normalizeIssueType(raw: string, sheetName?: string): "short" | "long" {
  const s = (raw || sheetName || "").trim().toLowerCase();
  if (/^long/.test(s) || s.includes("long-term") || s.includes("long term")) {
    return "long";
  }
  return "short";
}

function normalizeIssuePriority(
  raw: string,
): "urgent" | "high" | "medium" | "low" | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/urgent|critical|p0/.test(s)) return "urgent";
  if (/^high|p1/.test(s)) return "high";
  if (/^med|p2/.test(s)) return "medium";
  if (/^low|p3/.test(s)) return "low";
  return null;
}

function normalizeIssueStatus(
  raw: string,
  completedOn: string | null,
): "open" | "solving" | "solved" | "dropped" {
  const s = (raw ?? "").trim().toLowerCase().replace(/[-_]/g, " ");
  if (/solv(ed|e)|done|complete|closed|resolved/.test(s) && !/solving|in progress/.test(s)) {
    return "solved";
  }
  if (/drop|archiv|cancel|abandon|deleted/.test(s)) return "dropped";
  if (/solving|in progress|ids|discuss/.test(s)) return "solving";
  if (completedOn) return "solved";
  return "open";
}

function normalizeHeadlineKind(
  typeCell: string,
  sheetName?: string,
): "customer" | "employee" | "cascading" {
  const s = `${typeCell} ${sheetName ?? ""}`.toLowerCase();
  if (/cascad/.test(s)) return "cascading";
  if (/customer|client|win/.test(s)) return "customer";
  if (/employee|people|hr|staff/.test(s)) return "employee";
  return "employee";
}

// ---------------------------------------------------------------------------
// Kind importers
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
      interval: "weekly",
      description: normalizeDescription(cell(row, table.headers, "Description")) || null,
      sort_order: i,
      import_source: "csv",
      ...(isNew ? { created_at: FieldValue.serverTimestamp() } : {}),
    });
    metrics++;

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
    }
  }

  if (weekColumns.length) {
    details.push(
      `${entries} weekly entries across ${weekColumns.length} week columns`,
    );
  }

  return {
    kind: "scorecard",
    label: "scorecard",
    imported: metrics,
    skipped,
    details,
    warnings,
  };
}

async function importRocks(
  table: CsvTable,
  ctx: {
    teamId: string;
    writer: Writer;
    owners: OwnerResolver;
    existingIds: Set<string>;
    rockTeam?: string;
  },
): Promise<{ stats: KindStats; rockIdByTitle: Map<string, string> }> {
  const rockIdByTitle = new Map<string, string>();
  const teamValues = new Set<string>();
  let imported = 0;
  let skipped = 0;
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
    let ownerId = await ctx.owners.resolve(
      cell(row, table.headers, "Owner", "Owner Name", "Accountable"),
    );
    if (ownerId === null && rockType !== "department") {
      skipped++;
      continue;
    }

    if (cell(row, table.headers, "Attachment Names", "Attachments")) attachments++;

    const rockId = importDocId("rock", ctx.teamId, title);
    const isNew = !ctx.existingIds.has(rockId);

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
      description: normalizeDescription(cell(row, table.headers, "Description")) || null,
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
            archived_at: null,
            created_at: createdDate
              ? Timestamp.fromDate(new Date(`${createdDate}T00:00:00`))
              : FieldValue.serverTimestamp(),
          }
        : {}),
    });

    rockIdByTitle.set(normalizeKey(title), rockId);
    imported++;
  }

  if (attachments) {
    details.push(`${attachments} rows had attachments (not imported)`);
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
      details,
      warnings,
    },
    rockIdByTitle,
  };
}

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
): Promise<KindStats> {
  let imported = 0;
  let skipped = 0;
  let archived = 0;
  let stale = 0;
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
      description: normalizeDescription(cell(row, table.headers, "Description")) || null,
      owner_id: ownerId,
      due_date: dueDate ?? toDateString(endOfQuarter()),
      completed_at: completedOn ? Timestamp.fromDate(new Date(`${completedOn}T00:00:00`)) : null,
      visibility: "team",
      source_issue_id: null,
      source_meeting_id: null,
      source_rock_id: rockId,
      source_link: cell(row, table.headers, "Link", "URL") || null,
      import_source: "csv",
      ...(isNew ? { archived_at: null } : {}),
      ...(isNew ? { created_at: createdAtFrom(row, table.headers) } : {}),
    });
    imported++;
  }

  if (archived) details.push(`${archived} archived held back`);
  if (stale) details.push(`${stale} completed before ${ctx.completedSince}`);
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
    details,
    warnings,
  };
}

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
): Promise<KindStats> {
  let imported = 0;
  let skipped = 0;
  let archived = 0;
  let stale = 0;
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
      continue;
    }

    const repeat = cell(row, table.headers, "Repeat", "Recurrence", "Repeats");
    if (repeat && isRecurring(repeat)) {
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
    const visibility = /^priv/i.test(cell(row, table.headers, "Visibility", "Private"))
      ? "private"
      : "team";

    const todoId = importDocId("todo", ctx.teamId, title);
    const isNew = !ctx.existingIds.has(todoId);

    await ctx.writer.set(["todos", todoId], {
      team_id: ctx.teamId,
      title,
      description:
        normalizeDescription(cell(row, table.headers, "Description", "Notes")) || null,
      owner_id: ownerId,
      due_date: dueDate ?? toDateString(endOfQuarter()),
      completed_at: completedOn ? Timestamp.fromDate(new Date(`${completedOn}T00:00:00`)) : null,
      visibility,
      source_issue_id: null,
      source_meeting_id: null,
      source_rock_id: null,
      source_link: cell(row, table.headers, "Link", "URL") || null,
      import_source: "csv",
      ...(isNew ? { archived_at: null } : {}),
      ...(isNew ? { created_at: createdAtFrom(row, table.headers) } : {}),
    });
    imported++;
  }

  if (archived) details.push(`${archived} archived held back`);
  if (stale) details.push(`${stale} completed before ${ctx.completedSince}`);
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
    details,
    warnings,
  };
}

async function importIssues(
  table: CsvTable,
  ctx: {
    teamId: string;
    writer: Writer;
    owners: OwnerResolver;
    existingIds: Set<string>;
    includeArchived: boolean;
    completedSince: string | null;
    sheetName?: string;
  },
): Promise<KindStats> {
  let imported = 0;
  let skipped = 0;
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
      continue;
    }

    const completedOn = parseDateOnly(
      cell(row, table.headers, "Completed On", "Completed", "Resolved On"),
    );
    if (isStaleCompletion(completedOn, ctx.completedSince)) {
      stale++;
      continue;
    }

    const ownerId = await ctx.owners.resolve(
      cell(row, table.headers, "Owner", "Owner Name", "Accountable", "Assignee"),
    );
    if (ownerId === null) {
      skipped++;
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

    await ctx.writer.set(["issues", issueId], {
      team_id: ctx.teamId,
      title,
      description:
        normalizeDescription(cell(row, table.headers, "Description", "Notes")) || null,
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
      ...(isNew ? { archived_at: null } : {}),
      ...(isNew ? { created_at: createdAtFrom(row, table.headers) } : {}),
    });
    imported++;
    if (type === "long") longCount++;
    else shortCount++;
  }

  details.push(`${shortCount} short-term, ${longCount} long-term`);
  if (archived) details.push(`${archived} archived held back`);
  if (stale) details.push(`${stale} completed before ${ctx.completedSince}`);

  return {
    kind: "issues",
    label: ctx.sheetName ? `issues [${ctx.sheetName}]` : "issues",
    imported,
    skipped,
    details,
    warnings,
  };
}

async function importHeadlines(
  table: CsvTable & { sheetName?: string },
  ctx: {
    teamId: string;
    writer: Writer;
    owners: OwnerResolver;
    existingIds: Set<string>;
    includeArchived: boolean;
    rockTeam?: string;
  },
): Promise<KindStats> {
  let imported = 0;
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
      ...(isNew ? { archived_at: null } : {}),
      ...(isNew ? { created_at: createdAtFrom(row, table.headers) } : {}),
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
    details,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run a team import from pre-parsed tables. Callers (CLI / server action)
 * own reading files and resolving the team.
 */
export async function runTeamImport(
  db: Firestore,
  teamId: string,
  inputs: TeamImportInputs,
  options: TeamImportOptions = {},
  members?: Member[],
): Promise<ImportReport> {
  const dryRun = options.dryRun ?? false;
  const createOwners = options.createOwners ?? true;
  const includeArchived = options.includeArchived ?? false;
  const completedSince = options.completedSince ?? null;
  const asOf = options.asOf ?? new Date();
  const fallbackId = options.fallbackOwnerId ?? null;

  const writer = new Writer(db, dryRun);
  const teamMembers = members ?? (await loadMembers(db, teamId));
  const owners = new OwnerResolver(teamId, teamMembers, {
    createOwners,
    fallbackId,
    aliases: options.ownerAliases,
    writer,
  });

  const existingIds = await loadExistingIds(db, teamId, [
    "scorecard_metrics",
    "rocks",
    "todos",
    "issues",
    "headlines",
  ]);

  const kinds: KindStats[] = [];

  if (inputs.scorecard) {
    kinds.push(
      await importScorecard(inputs.scorecard.table, {
        teamId,
        writer,
        owners,
        asOf,
        includeArchived,
        existingIds,
      }),
    );
  }

  let rockIdByTitle = new Map<string, string>();
  if (inputs.rocks) {
    const { stats, rockIdByTitle: map } = await importRocks(inputs.rocks.table, {
      teamId,
      writer,
      owners,
      existingIds,
      rockTeam: options.rockTeam,
    });
    rockIdByTitle = map;
    kinds.push(stats);
  }

  if (inputs.milestones) {
    // Fold in existing team rocks so milestones can link without a rocks
    // file in the same run (or to rocks created in-app).
    const existingRocks = await db.collection("rocks").where("team_id", "==", teamId).get();
    for (const d of existingRocks.docs) {
      const key = normalizeKey((d.data().title as string) ?? "");
      if (key && !rockIdByTitle.has(key)) rockIdByTitle.set(key, d.id);
    }
    kinds.push(
      await importMilestones(inputs.milestones.table, {
        teamId,
        writer,
        owners,
        existingIds,
        rockIdByTitle,
        rockTeam: options.rockTeam,
        includeArchived,
        completedSince,
      }),
    );
  }

  if (inputs.todos) {
    kinds.push(
      await importTodos(inputs.todos.table, {
        teamId,
        writer,
        owners,
        existingIds,
        includeArchived,
        completedSince,
      }),
    );
  }

  if (inputs.issues) {
    for (const table of inputs.issues.tables) {
      kinds.push(
        await importIssues(table, {
          teamId,
          writer,
          owners,
          existingIds,
          includeArchived,
          completedSince,
          sheetName: table.sheetName,
        }),
      );
    }
  }

  if (inputs.headlines) {
    for (const table of inputs.headlines.tables) {
      kinds.push(
        await importHeadlines(table, {
          teamId,
          writer,
          owners,
          existingIds,
          includeArchived,
          rockTeam: options.rockTeam,
        }),
      );
    }
  }

  await writer.flush();

  return {
    dryRun,
    writes: writer.written,
    kinds,
    placeholdersCreated: owners.created,
    unresolvedOwners: [...owners.unresolved],
  };
}

export function preferRegexForKind(kind: "rocks" | "todos" | "issues" | "milestones" | "scorecard"): RegExp {
  switch (kind) {
    case "rocks":
      return /rock/i;
    case "todos":
      return /to-?dos?|task/i;
    case "issues":
      return /issue|short|long/i;
    case "milestones":
      return /milestone/i;
    case "scorecard":
      return /scorecard|measurable|metric/i;
  }
}
