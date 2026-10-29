import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { FakeFirestore } from "./test-support/fake-firestore";
import {
  assembleBulkInputs,
  classifyTable,
  expandUploads,
  readBulkTables,
  rowKey,
  finishImportRun,
  isArchiveTable,
  runTeamImport,
  sha256,
  startImportRun,
  teamFilterFor,
  toGridTables,
} from "./team-import";
import { readZip } from "./xlsx";
import { importDocId } from "./csv-import";

// A team's ninety export, column for column (client sample, 2026-10-29).
const EXPORT_HEADERS = {
  scorecard:
    "Group Name|Status|Title|Description|Owner|Goal|Average|Oct 26 - Nov 1|Oct 19 - Oct 25|Oct 12 - Oct 18|Oct 5 - Oct 11|Sep 28 - Oct 4|Sep 21 - Sep 27|Sep 14 - Sep 20|Sep 7 - Sep 13|Aug 31 - Sep 6|Aug 24 - Aug 30|Aug 17 - Aug 23|Aug 10 - Aug 16|Aug 3 - Aug 9",
  rocks:
    "Owner|Title|Description|Due Date|Status|Level|Team|Attachment Names|Completed On|Link|Created Date|Quarter",
  milestones: "Owner|Title|Description|Rock Name|Due Date|Completed On|Link",
  todos:
    "Owner|Title|Description|Due Date|Repeat|Team|Attachment Names|Completed On|Link|Created Date|Archived Date",
  issues:
    "Owner|Title|Description|Type|Priority|Team|Who|Attachment Names|Completed On|Link|Created Date|Archived Date",
  headlines:
    "Type|From|Owner|Title|Description|Team|Attachment Names|Completed On|Link|Created Date|Archived Date",
} as const;

const AS_OF = new Date("2026-10-29T12:00:00");

// --- tiny zip / xlsx writers (the reader skips CRCs, so they're left 0) ---

function makeZip(entries: { name: string; data: Buffer | string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8");
    const body = deflateRawSync(raw);
    const name = Buffer.from(e.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function makeXlsx(sheets: { name: string; rows: string[][] }[]): Buffer {
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheetXml = (rows: string[][]) =>
    `<worksheet><sheetData>${rows
      .map(
        (r, ri) =>
          `<row r="${ri + 1}">${r
            .map((v, ci) => `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`)
            .join("")}</row>`,
      )
      .join("")}</sheetData></worksheet>`;
  return makeZip([
    {
      name: "xl/workbook.xml",
      data: `<workbook><sheets>${sheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows) })),
  ]);
}

const hdr = (k: keyof typeof EXPORT_HEADERS) => EXPORT_HEADERS[k].split("|");

/** A row for `kind` with the named cells filled, the rest blank. */
function rowOf(kind: keyof typeof EXPORT_HEADERS, cells: Record<string, string>): string[] {
  return hdr(kind).map((h) => cells[h] ?? "");
}

// ---------------------------------------------------------------------------

describe("classifyTable", () => {
  for (const [kind, headers] of Object.entries(EXPORT_HEADERS)) {
    test(`ninety ${kind} export columns → ${kind}`, () => {
      // Sheet/file names are deliberately unhelpful: headers alone decide.
      const got = classifyTable(headers.split("|"), "Sheet1", "export (3).xlsx", AS_OF);
      assert.equal(got.kind, kind, got.reason);
    });
  }

  test("a rocks export with Rock Name as its title column is still rocks", () => {
    const got = classifyTable(["Rock Name", "Owner", "Level", "Quarter"], null, "x.csv", AS_OF);
    assert.equal(got.kind, "rocks");
  });

  test("falls back to the sheet name, then the file name", () => {
    assert.equal(classifyTable(["Owner", "Title"], "Long Term Issues", "x.xlsx", AS_OF).kind, "issues");
    assert.equal(classifyTable(["Owner", "Title"], null, "Team To-Dos.csv", AS_OF).kind, "todos");
  });

  test("unknown columns and names → null, with a reason to show", () => {
    const got = classifyTable(["Foo", "Bar"], "Sheet1", "data.csv", AS_OF);
    assert.equal(got.kind, null);
    assert.match(got.reason, /pick a type/);
  });
});

describe("readZip / expandUploads", () => {
  test("keeps spreadsheets, drops macOS junk and folders, flags other files", () => {
    const zip = makeZip([
      { name: "export/Rocks.xlsx", data: "x" },
      { name: "export/To-Dos.csv", data: "Title\na" },
      { name: "export/", data: "" },
      { name: "__MACOSX/export/._Rocks.xlsx", data: "junk" },
      { name: "export/.DS_Store", data: "junk" },
      { name: "export/readme.pdf", data: "pdf" },
    ]);
    assert.equal(readZip(zip).length, 6 - 1, "directory entry left out");
    const { files, notices } = expandUploads([{ name: "ninety.zip", bytes: zip }]);
    assert.deepEqual(files.map((f) => f.name), ["export/Rocks.xlsx", "export/To-Dos.csv"]);
    assert.equal(notices.length, 1);
    assert.match(notices[0].file, /readme\.pdf/);
  });

  test("loose files pass through; a corrupt zip is a notice, not a crash", () => {
    const { files, notices } = expandUploads([
      { name: "a.csv", bytes: Buffer.from("Title\nx") },
      { name: "bad.zip", bytes: Buffer.from("not a zip") },
    ]);
    assert.deepEqual(files.map((f) => f.name), ["a.csv"]);
    assert.match(notices[0].message, /\.zip/);
  });
});

describe("bulk import end to end", () => {
  function exportZip() {
    const rocks = makeXlsx([
      {
        name: "Rocks",
        rows: [
          hdr("rocks"),
          rowOf("rocks", { Owner: "Sarah Chen", Title: "Launch CRM", Level: "Individual", Team: "Ops", Quarter: "Q4 2026" }),
          rowOf("rocks", { Owner: "Sarah Chen", Title: "Hire analyst", Level: "Individual", Team: "Ops", Quarter: "Q4 2026" }),
        ],
      },
      {
        name: "Milestones",
        rows: [
          hdr("milestones"),
          rowOf("milestones", { Owner: "Sarah Chen", Title: "Pick vendor", "Rock Name": "Launch CRM", "Due Date": "2026-11-15" }),
        ],
      },
    ]);
    const issues = makeXlsx([
      {
        name: "Short Term Issues",
        rows: [hdr("issues"), rowOf("issues", { Owner: "Sarah Chen", Title: "Printer down", Team: "Ops" })],
      },
      {
        name: "Long Term Issues",
        rows: [
          hdr("issues"),
          rowOf("issues", { Owner: "Sarah Chen", Title: "Core migration", Team: "Ops", Who: "Pat Lee" }),
          rowOf("issues", { Owner: "Sarah Chen", Title: "Lending backlog", Team: "Lending" }),
        ],
      },
    ]);
    const todos = [
      hdr("todos").join(","),
      rowOf("todos", { Owner: "Sarah Chen", Title: "Send deck", Team: "Ops", "Due Date": "next Tuesday" }).join(","),
      rowOf("todos", { Owner: "Sarah Chen", Title: "Other team's task", Team: "Lending" }).join(","),
    ].join("\n");
    return makeZip([
      { name: "Rocks.xlsx", data: rocks },
      { name: "Issues.xlsx", data: issues },
      { name: "To-Dos.csv", data: todos },
      { name: "__MACOSX/._Rocks.xlsx", data: "junk" },
    ]);
  }

  function load() {
    const { files } = expandUploads([{ name: "ninety.zip", bytes: exportZip() }]);
    return readBulkTables(files, AS_OF).tables;
  }

  async function run(exclude = new Set<string>()) {
    const tables = load();
    const { inputs, refs } = assembleBulkInputs(tables, new Map(), exclude);
    const db = new FakeFirestore();
    const report = await runTeamImport(
      db.asFirestore(),
      "t1",
      inputs,
      { rockTeam: "Ops", previewLimit: 10_000, rowRefs: refs, asOf: AS_OF },
      [{ user_id: "u1", names: ["Sarah Chen"] }],
    );
    return { tables, report, db };
  }

  test("every tab is read and classified on its own", () => {
    const tables = load();
    assert.deepEqual(
      tables.map((t) => [t.id, t.detected]),
      [
        ["Rocks.xlsx › Rocks", "rocks"],
        ["Rocks.xlsx › Milestones", "milestones"],
        ["Issues.xlsx › Short Term Issues", "issues"],
        ["Issues.xlsx › Long Term Issues", "issues"],
        ["To-Dos.csv", "todos"],
      ],
    );
  });

  test("one run lands every kind; milestones link to rocks from the same drop", async () => {
    const { db } = await run();
    assert.equal(db.docsIn("rocks").length, 2);
    // Milestones are to-dos hung off a rock.
    const todos = db.docsIn("todos");
    const launch = db.docsIn("rocks").find((d) => d.data.title === "Launch CRM");
    assert.deepEqual(
      todos.filter((d) => d.data.source_rock_id).map((d) => [d.data.title, d.data.source_rock_id]),
      [["Pick vendor", launch?.id]],
    );
    assert.equal(db.docsIn("issues").length, 2, "Lending issue filtered out");
    assert.equal(todos.filter((d) => !d.data.source_rock_id).length, 1, "Lending to-do filtered out");
  });

  test("issue tabs keep their sheet name as the term", async () => {
    const { db } = await run();
    const types = db.docsIn("issues").map((d) => [d.data.title, d.data.type]).sort();
    assert.deepEqual(types, [
      ["Core migration", "long"],
      ["Printer down", "short"],
    ]);
  });

  test("Team filter now applies to to-dos and issues, with the reason in the preview", async () => {
    const { report } = await run();
    const skipped = report.rows.filter((r) => /Lending/.test(r.note ?? ""));
    assert.deepEqual(skipped.map((r) => r.kind).sort(), ["issues", "todos"]);
  });

  test("a non-blank Who is kept as a description line and warned about", async () => {
    const { db, report } = await run();
    const core = db.docsIn("issues").find((d) => d.data.title === "Core migration");
    assert.match(String(core?.data.description), /Who: Pat Lee/);
    assert.ok(report.kinds.some((k) => k.warnings.some((w) => /Who value/.test(w))));
  });

  test("every preview row points back at its file row", async () => {
    const { report } = await run();
    const ref = report.rows.find((r) => r.title === "Core migration")?.ref;
    assert.deepEqual(ref, { table: "Issues.xlsx › Long Term Issues", row: 0 });
  });

  test("unticked rows are not imported, and a milestone whose rock was unticked says so", async () => {
    const { report, db } = await run(new Set([rowKey("Rocks.xlsx › Rocks", 0)]));
    assert.deepEqual(db.docsIn("rocks").map((d) => d.data.title), ["Hire analyst"]);
    assert.equal(db.docsIn("todos").filter((d) => d.data.source_rock_id).length, 0);
    assert.match(report.rows.find((r) => r.kind === "milestones")?.note ?? "", /No rock named/);
  });

  test("an override re-types a tab; null leaves it out", () => {
    const tables = load();
    const { inputs } = assembleBulkInputs(tables, new Map([["To-Dos.csv", null]]));
    assert.equal(inputs.todos, undefined);
  });

  test("grid marks ignored columns and unreadable dates", () => {
    const tables = load();
    const grid = toGridTables(tables, new Map(), AS_OF);
    const todos = grid.find((g) => g.id === "To-Dos.csv")!;
    const col = (h: string) => todos.headers.indexOf(h);
    assert.equal(todos.used[col("Attachment Names")], false);
    assert.equal(todos.used[col("Team")], true);
    assert.deepEqual(todos.badCells, [[0, col("Due Date")]]);
  });
});

describe("Link column", () => {
  test("ninety.io links are dropped, external links kept", async () => {
    const { isNinetyLink, importedLink } = await import("./csv-import");
    assert.equal(isNinetyLink("https://app.ninety.io/rocks/123"), true);
    assert.equal(isNinetyLink("app.ninety.io/todos/9"), true);
    assert.equal(isNinetyLink("https://ninety.io"), true);
    assert.equal(isNinetyLink("https://notninety.io/x"), false);
    assert.equal(isNinetyLink("https://hpb.sharepoint.com/sites/ops/doc"), false);
    assert.equal(importedLink(" https://app.ninety.io/rocks/1 "), null);
    assert.equal(importedLink("https://vendor.example.com/case/4"), "https://vendor.example.com/case/4");
    assert.equal(importedLink(""), null);
  });

  test("the importer stores only the external link; the grid hides the column", async () => {
    const csv = [
      hdr("todos").join(","),
      rowOf("todos", { Owner: "Sarah Chen", Title: "A", Link: "https://app.ninety.io/todos/1" }).join(","),
      rowOf("todos", { Owner: "Sarah Chen", Title: "B", Link: "https://vendor.example.com/x" }).join(","),
    ].join("\n");
    const { tables } = readBulkTables([{ name: "To-Dos.csv", bytes: Buffer.from(csv) }], AS_OF);
    const { inputs } = assembleBulkInputs(tables, new Map());
    const db = new FakeFirestore();
    await runTeamImport(db.asFirestore(), "t1", inputs, { asOf: AS_OF }, [{ user_id: "u1", names: ["Sarah Chen"] }]);
    const links = Object.fromEntries(db.docsIn("todos").map((d) => [d.data.title, d.data.source_link]));
    assert.deepEqual(links, { A: null, B: "https://vendor.example.com/x" });

    const grid = toGridTables(tables, new Map(), AS_OF)[0];
    assert.equal(grid.headers.includes("Link"), false);
    assert.equal(grid.rows[0].length, grid.headers.length);
  });
});

describe("teamFilterFor (one Team picker drives the Department filter)", () => {
  const todos = (...teams: string[]) =>
    readBulkTables(
      [
        {
          name: "To-Dos.csv",
          bytes: Buffer.from(
            [hdr("todos").join(","), ...teams.map((t, i) => rowOf("todos", { Title: `t${i}`, Team: t }).join(","))].join("\n"),
          ),
        },
      ],
      AS_OF,
    ).tables;

  test("multi-department export naming this team → filter to it", () => {
    assert.deepEqual(teamFilterFor(todos("Ops", "Lending", "ops"), new Map(), "OPS"), { rockTeam: "OPS" });
  });

  test("single other name or blank → this team's own export, no filter", () => {
    assert.deepEqual(teamFilterFor(todos("Operations Team", "Operations Team"), new Map(), "Ops"), {});
    assert.deepEqual(teamFilterFor(todos("", ""), new Map(), "Ops"), {});
  });

  test("several departments, none this team → filter, and say what the file holds", () => {
    const got = teamFilterFor(todos("Lending", "Retail"), new Map(), "Ops");
    assert.equal(got.rockTeam, "Ops");
    assert.match(got.notice?.message ?? "", /Lending, Retail — none is Ops/);
  });

  test("a tab left out doesn't count", () => {
    const tables = todos("Lending", "Retail");
    assert.deepEqual(teamFilterFor(tables, new Map([["To-Dos.csv", null]]), "Ops"), {});
  });
});

describe("import_runs record", () => {
  const start = (db: FakeFirestore, bytes = Buffer.from("zip bytes")) =>
    startImportRun(db.asFirestore(), {
      teamId: "t1",
      actorUid: "u1",
      files: [{ name: "ninety.zip", bytes }],
      tables: [{ id: "To-Dos.csv", kind: "todos", rows: 2, excluded: 1 }],
      options: {
        includeArchived: false,
        createOwners: false,
        unmatchedOwner: "no-owner",
        fallbackOwnerId: null,
        teamFilter: "Ops",
        ownerAliases: { "j doe": "u1" },
      },
    });

  test("starts as running, with the file's hash, before anything is imported", async () => {
    const db = new FakeFirestore();
    const ref = await start(db);
    const doc = db.docsIn("import_runs")[0];
    assert.equal(doc.id, ref.id);
    assert.equal(doc.data.status, "running");
    assert.equal(doc.data.actor_uid, "u1");
    assert.equal(doc.data.updated_by, "u1", "stamped, so the audit trigger names the actor");
    assert.deepEqual(doc.data.files, [{ name: "ninety.zip", size: 9, sha256: sha256(Buffer.from("zip bytes")) }]);
    assert.match(sha256(Buffer.from("zip bytes")), /^[0-9a-f]{64}$/);
  });

  test("every doc the run writes carries import_run_id; the run closes with its counts", async () => {
    const db = new FakeFirestore();
    const ref = await start(db);
    const csv = [hdr("todos").join(","), rowOf("todos", { Owner: "Sarah Chen", Title: "A" }).join(",")].join("\n");
    const { tables } = readBulkTables([{ name: "To-Dos.csv", bytes: Buffer.from(csv) }], AS_OF);
    const { inputs } = assembleBulkInputs(tables, new Map());
    const report = await runTeamImport(
      db.asFirestore(),
      "t1",
      inputs,
      { actorUid: "u1", importRunId: ref.id, asOf: AS_OF },
      [{ user_id: "u1", names: ["Sarah Chen"] }],
    );
    await finishImportRun(ref, "u1", { report });

    assert.deepEqual(db.docsIn("todos").map((d) => d.data.import_run_id), [ref.id]);
    const run = db.docsIn("import_runs")[0].data;
    assert.equal(run.status, "completed");
    assert.deepEqual(run.result, {
      writes: 1,
      kinds: [{ kind: "todos", label: "to-dos", imported: 1, skipped: 0, unchanged: 0 }],
      placeholders_created: [],
      unresolved_owners: [],
    });
  });

  test("a failed run is recorded as failed with the error", async () => {
    const db = new FakeFirestore();
    const ref = await start(db);
    await finishImportRun(ref, "u1", { error: "batch commit failed" });
    const run = db.docsIn("import_runs")[0].data;
    assert.equal(run.status, "failed");
    assert.equal(run.error, "batch commit failed");
  });

  test("a dry run stamps nothing", async () => {
    const db = new FakeFirestore();
    const csv = [hdr("todos").join(","), rowOf("todos", { Owner: "Sarah Chen", Title: "A" }).join(",")].join("\n");
    const { tables } = readBulkTables([{ name: "To-Dos.csv", bytes: Buffer.from(csv) }], AS_OF);
    await runTeamImport(db.asFirestore(), "t1", assembleBulkInputs(tables, new Map()).inputs, { dryRun: true }, []);
    assert.equal(db.docsIn("todos").length, 0);
    assert.equal(db.docsIn("import_runs").length, 0);
  });
});

// ninety exports archived items as separate files with the live columns
// (+ Archived Date; milestones have none). Client sample, 2026-10-29.
describe("archived exports", () => {
  const ARCHIVED_ROCKS = `${EXPORT_HEADERS.rocks}|Archived Date`.split("|");
  const arow = (cells: Record<string, string>) => ARCHIVED_ROCKS.map((h) => cells[h] ?? "");
  const csv = (rows: string[][]) => rows.map((r) => r.join(",")).join("\n");

  test("spotted by file or sheet name, or by every row having an Archived Date", () => {
    const t = (rows: string[][]) => ({ headers: rows[0], rows: rows.slice(1).map((r) => Object.fromEntries(rows[0].map((h, i) => [h, r[i]]))) });
    const plain = t([["Title", "Archived Date"], ["a", "2026-01-02"], ["b", ""]]);
    assert.equal(isArchiveTable(plain, null, "To-Dos.csv"), false, "only some rows archived = a live export");
    assert.equal(isArchiveTable(plain, null, "Archived To-Dos.csv"), true);
    assert.equal(isArchiveTable(plain, "Archived Milestones", "x.xlsx"), true);
    assert.equal(isArchiveTable(t([["Title", "Archived Date"], ["a", "2026-01-02"]]), null, "x.csv"), true);
  });

  function zip() {
    const live = makeXlsx([
      { name: "Rocks", rows: [hdr("rocks"), rowOf("rocks", { Owner: "Sarah Chen", Title: "Hire analyst", Level: "Individual", Quarter: "Q4 2026" })] },
      { name: "Milestones", rows: [hdr("milestones"), rowOf("milestones", { Owner: "Sarah Chen", Title: "Post job", "Rock Name": "Hire analyst" })] },
    ]);
    const archived = makeXlsx([
      {
        name: "Rocks",
        rows: [
          ARCHIVED_ROCKS,
          // The same rock carried over two earlier quarters.
          arow({ Owner: "Sarah Chen", Title: "Hire analyst", Level: "Individual", Quarter: "Q2 2026", "Due Date": "2026-06-30", "Created Date": "2026-04-01", "Archived Date": "2026-07-02" }),
          arow({ Owner: "Sarah Chen", Title: "Hire analyst", Level: "Individual", Quarter: "Q3 2026", "Due Date": "2026-09-30", "Created Date": "2026-07-01", "Archived Date": "2026-10-01" }),
        ],
      },
      {
        name: "Milestones",
        rows: [hdr("milestones"), rowOf("milestones", { Owner: "Sarah Chen", Title: "Screen resumes", "Rock Name": "Hire analyst", "Completed On": "2026-05-15" })],
      },
    ]);
    const todoHdr = `${EXPORT_HEADERS.todos}`.split("|");
    const todo = (cells: Record<string, string>) => todoHdr.map((h) => cells[h] ?? "");
    return makeZip([
      { name: "Rocks.xlsx", data: live },
      { name: "Archived Rocks.xlsx", data: archived },
      { name: "To-Dos.csv", data: csv([todoHdr, todo({ Owner: "Sarah Chen", Title: "Send weekly report" })]) },
      {
        name: "Archived To-Dos.csv",
        data: csv([
          todoHdr,
          todo({ Owner: "Sarah Chen", Title: "Send weekly report", "Created Date": "2026-09-01", "Archived Date": "2026-09-08" }),
          todo({ Owner: "Sarah Chen", Title: "Send weekly report", "Created Date": "2026-09-08", "Archived Date": "2026-09-15" }),
        ]),
      },
    ]);
  }

  async function run() {
    const { files } = expandUploads([{ name: "ninety.zip", bytes: zip() }]);
    const { tables } = readBulkTables(files, AS_OF);
    const { inputs } = assembleBulkInputs(tables, new Map());
    const db = new FakeFirestore();
    // includeArchived stays off: archived *files* don't need the checkbox.
    const report = await runTeamImport(db.asFirestore(), "t1", inputs, { asOf: AS_OF }, [
      { user_id: "u1", names: ["Sarah Chen"] },
    ]);
    return { tables, report, db };
  }

  test("tabs are flagged archived by file name — milestones included", async () => {
    const { tables } = await run();
    assert.deepEqual(
      tables.map((t) => [t.id, t.archived]),
      [
        ["Rocks.xlsx › Rocks", false],
        ["Rocks.xlsx › Milestones", false],
        ["Archived Rocks.xlsx › Rocks", true],
        ["Archived Rocks.xlsx › Milestones", true],
        ["To-Dos.csv", false],
        ["Archived To-Dos.csv", true],
      ],
    );
  });

  test("repeated titles stay separate records; live and archived never share one", async () => {
    const { db, report } = await run();
    const rocks = db.docsIn("rocks");
    assert.equal(rocks.length, 3, "live + two archived quarters");
    assert.equal(rocks.filter((d) => d.data.archived_at).length, 2);
    const todos = db.docsIn("todos").filter((d) => !d.data.source_rock_id);
    assert.equal(todos.length, 3, "live + two archived weeks");
    assert.equal(todos.filter((d) => d.data.archived_at).length, 2);
    assert.equal(report.collisions, 0);
    assert.ok(report.kinds.some((k) => k.label === "rocks (archived)"));
  });

  test("archived milestones land archived, on an archived rock — not the live one", async () => {
    const { db } = await run();
    const liveRock = db.docsIn("rocks").find((d) => !d.data.archived_at)!;
    const archivedRockIds = new Set(db.docsIn("rocks").filter((d) => d.data.archived_at).map((d) => d.id));
    const ms = Object.fromEntries(
      db.docsIn("todos").filter((d) => d.data.source_rock_id).map((d) => [d.data.title, d.data]),
    );
    assert.equal(ms["Post job"].source_rock_id, liveRock.id);
    assert.equal(ms["Post job"].archived_at, null);
    assert.ok(archivedRockIds.has(String(ms["Screen resumes"].source_rock_id)));
    assert.ok(ms["Screen resumes"].archived_at, "dated from Completed On — the export has no Archived Date");
  });

  test("re-importing the same archive adds nothing", async () => {
    const { db } = await run();
    const { files } = expandUploads([{ name: "ninety.zip", bytes: zip() }]);
    const { tables } = readBulkTables(files, AS_OF);
    const again = await runTeamImport(db.asFirestore(), "t1", assembleBulkInputs(tables, new Map()).inputs, { asOf: AS_OF }, [
      { user_id: "u1", names: ["Sarah Chen"] },
    ]);
    assert.equal(again.writes, 0);
  });

  test("rows that would still share a record are counted", async () => {
    const todoHdr = `${EXPORT_HEADERS.todos}`.split("|");
    const same = todoHdr.map((h) => ({ Owner: "Sarah Chen", Title: "Dup", "Archived Date": "2026-09-08" } as Record<string, string>)[h] ?? "");
    const { tables } = readBulkTables([{ name: "Archived To-Dos.csv", bytes: Buffer.from(csv([todoHdr, same, same])) }], AS_OF);
    const report = await runTeamImport(new FakeFirestore().asFirestore(), "t1", assembleBulkInputs(tables, new Map()).inputs, { dryRun: true, asOf: AS_OF }, [
      { user_id: "u1", names: ["Sarah Chen"] },
    ]);
    assert.equal(report.collisions, 1);
  });

  test("an archived scorecard is left out until its columns are mapped", () => {
    const sc = [hdr("scorecard"), rowOf("scorecard", { Title: "Loans", Goal: "5", "Oct 26 - Nov 1": "4" })];
    const { tables } = readBulkTables([{ name: "Archived Scorecard.csv", bytes: Buffer.from(csv(sc)) }], AS_OF);
    assert.deepEqual(assembleBulkInputs(tables, new Map()).inputs, {});
    assert.equal(toGridTables(tables, new Map(), AS_OF)[0].kind, null);
  });
});

describe("repeating to-dos warning", () => {
  const todoHdr = EXPORT_HEADERS.todos.split("|");
  const todo = (cells: Record<string, string>) => todoHdr.map((h) => cells[h] ?? "").join(",");
  async function warnings(file: string, rows: Record<string, string>[], seed?: (db: FakeFirestore) => void) {
    const { tables } = readBulkTables([{ name: file, bytes: Buffer.from([todoHdr.join(","), ...rows.map(todo)].join("\n")) }], AS_OF);
    const db = new FakeFirestore();
    seed?.(db);
    const report = await runTeamImport(db.asFirestore(), "t1", assembleBulkInputs(tables, new Map()).inputs, { dryRun: true, asOf: AS_OF }, [
      { user_id: "u1", names: ["Sarah Chen"] },
    ]);
    return report.kinds.flatMap((k) => k.warnings).filter((w) => /repeat/.test(w));
  }
  const monthly = { Owner: "Sarah Chen", Title: "OptimaFi Data Upload", Repeat: "Monthly" };

  test("a live repeating to-do is named once", async () => {
    const w = await warnings("To-Dos.csv", [monthly, { Owner: "Sarah Chen", Title: "One-off", Repeat: "Does not repeat" }]);
    assert.equal(w.length, 1);
    assert.match(w[0], /^1 to-do\(s\) repeat.*: OptimaFi Data Upload \(Monthly\)$/);
  });

  test("archived occurrences don't warn — they're history, one row per month", async () => {
    const rows = ["2026-07-01", "2026-08-01", "2026-09-01"].map((d) => ({ ...monthly, "Created Date": d, "Archived Date": d }));
    assert.deepEqual(await warnings("Archived To-Dos.csv", rows), []);
  });

  test("rows that aren't imported don't count", async () => {
    const w = await warnings("To-Dos.csv", [monthly], (db) =>
      // Already on the team from an earlier import: kept as is, not re-imported.
      db.seed("todos", importDocId("todo", "t1", "OptimaFi Data Upload"), { team_id: "t1", title: "OptimaFi Data Upload" }),
    );
    assert.deepEqual(w, []);
  });
});
