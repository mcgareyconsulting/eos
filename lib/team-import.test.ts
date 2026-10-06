import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseDelimited, toTable } from "./csv-import";
import { FakeFirestore } from "./test-support/fake-firestore";
import { LONG_TEXT_MAX, TITLE_MAX } from "./text-limits";
import {
  runTeamImport,
  normalizeHeadlineKind,
  pickRockWorkbookSheets,
  rocksWorkbookFromBytes,
  withUnmatchedOwnerNote,
  PreviewCollector,
} from "./team-import";

// Pins the Type/sheet-name → headline kind mapping so a client export keeps
// landing on the right kind as the app's headline kinds evolve.

describe("normalizeHeadlineKind", () => {
  test("maps cascading variants", () => {
    assert.equal(normalizeHeadlineKind("Cascading"), "cascading");
    assert.equal(normalizeHeadlineKind("cascaded"), "cascading");
  });

  test("maps customer variants", () => {
    assert.equal(normalizeHeadlineKind("Customer"), "customer");
    assert.equal(normalizeHeadlineKind("Client"), "customer");
    assert.equal(normalizeHeadlineKind("Win"), "customer");
  });

  test("maps employee variants", () => {
    assert.equal(normalizeHeadlineKind("Employee"), "employee");
    assert.equal(normalizeHeadlineKind("HR"), "employee");
    assert.equal(normalizeHeadlineKind("Staff"), "employee");
  });

  test("maps general/FYI variants, case- and whitespace-insensitive", () => {
    assert.equal(normalizeHeadlineKind("general"), "general");
    assert.equal(normalizeHeadlineKind("General"), "general");
    assert.equal(normalizeHeadlineKind("FYI"), "general");
    assert.equal(normalizeHeadlineKind("fyi"), "general");
    assert.equal(normalizeHeadlineKind("General / FYI"), "general");
    assert.equal(normalizeHeadlineKind("general/fyi"), "general");
    assert.equal(normalizeHeadlineKind("  General / FYI  "), "general");
  });

  test("falls back to employee for unrecognized values", () => {
    assert.equal(normalizeHeadlineKind(""), "employee");
    assert.equal(normalizeHeadlineKind("Something else"), "employee");
  });

  test("also reads the sheet name (multi-sheet xlsx with a blank Type column)", () => {
    assert.equal(normalizeHeadlineKind("", "General / FYI"), "general");
    assert.equal(normalizeHeadlineKind("", "Cascading Messages"), "cascading");
  });
});

// Ninety exports rocks + milestones as one two-sheet workbook. The Import
// page used to read only the rocks sheet, silently dropping the milestones.

const sheet = (name: string, rows: string[][]) => ({ name, rows });

const ROCK_ROWS = [
  ["Title", "Owner"],
  ["Launch consumer mobile app v2.0", "Sarah Chen"],
];
const MILESTONE_ROWS = [
  ["Rock Name", "Title", "Owner"],
  ["Launch consumer mobile app v2.0", "Ship beta", "Sarah Chen"],
];

describe("pickRockWorkbookSheets", () => {
  test("finds both sheets in a ninety rocks workbook", () => {
    const got = pickRockWorkbookSheets([
      sheet("Rocks", ROCK_ROWS),
      sheet("Milestones", MILESTONE_ROWS),
    ]);
    assert.equal(got.rocks.name, "Rocks");
    assert.equal(got.milestones?.name, "Milestones");
  });

  test("matches regardless of sheet order or casing", () => {
    const got = pickRockWorkbookSheets([
      sheet("rock milestones", MILESTONE_ROWS),
      sheet("ROCKS", ROCK_ROWS),
    ]);
    assert.equal(got.rocks.name, "ROCKS");
    assert.equal(got.milestones?.name, "rock milestones");
  });

  test("no milestones sheet leaves it undefined", () => {
    const got = pickRockWorkbookSheets([sheet("Rocks", ROCK_ROWS)]);
    assert.equal(got.rocks.name, "Rocks");
    assert.equal(got.milestones, undefined);
  });

  // A single "Rocks & Milestones" sheet is one rocks table, not two tables —
  // it must never be handed to the milestone importer as well.
  test("never returns the same sheet as both", () => {
    const got = pickRockWorkbookSheets([sheet("Rocks & Milestones", ROCK_ROWS)]);
    assert.equal(got.rocks.name, "Rocks & Milestones");
    assert.equal(got.milestones, undefined);
  });

  test("falls back to the first sheet when nothing matches rocks", () => {
    const got = pickRockWorkbookSheets([
      sheet("Sheet1", ROCK_ROWS),
      sheet("Milestones", MILESTONE_ROWS),
    ]);
    assert.equal(got.rocks.name, "Sheet1");
    assert.equal(got.milestones?.name, "Milestones");
  });
});

describe("rocksWorkbookFromBytes", () => {
  test("a CSV is rocks only — one table, no milestone sheet", () => {
    const csv = "Title,Owner\nLaunch consumer mobile app v2.0,Sarah Chen\n";
    const got = rocksWorkbookFromBytes(Buffer.from(csv, "utf8"), "rocks.csv");
    assert.equal(got.rocks.rows.length, 1);
    assert.equal(got.milestones, undefined);
    assert.deepEqual(got.sheets, []);
  });
});

// A departed employee's rows must still import — with No Owner
// and the old name kept where a human will see it, not skipped silently.

describe("withUnmatchedOwnerNote", () => {
  test("appends to an existing description", () => {
    assert.equal(
      withUnmatchedOwnerNote("Vendor rollout", "Pat Lee"),
      "Vendor rollout\n\nImported owner: Pat Lee",
    );
  });

  test("becomes the description when there was none", () => {
    assert.equal(withUnmatchedOwnerNote(null, "Pat Lee"), "Imported owner: Pat Lee");
    assert.equal(withUnmatchedOwnerNote("", "Pat Lee"), "Imported owner: Pat Lee");
    assert.equal(withUnmatchedOwnerNote(undefined, "Pat Lee"), "Imported owner: Pat Lee");
  });

  test("trims the name and the surrounding description", () => {
    assert.equal(
      withUnmatchedOwnerNote("  Vendor rollout  ", "  Pat Lee  "),
      "Vendor rollout\n\nImported owner: Pat Lee",
    );
  });

  // Rocks re-import by title, so the note must not stack up on every upload.
  test("is idempotent across re-imports", () => {
    const once = withUnmatchedOwnerNote("Vendor rollout", "Pat Lee");
    assert.equal(withUnmatchedOwnerNote(once, "Pat Lee"), once);
    assert.equal(withUnmatchedOwnerNote(withUnmatchedOwnerNote(once, "Pat Lee"), "Pat Lee"), once);
  });

  test("a different unmatched name still appends", () => {
    const once = withUnmatchedOwnerNote("Vendor rollout", "Pat Lee");
    const twice = withUnmatchedOwnerNote(once, "Sam Diaz");
    assert.ok(twice.includes("Imported owner: Pat Lee"));
    assert.ok(twice.includes("Imported owner: Sam Diaz"));
  });
});

// The dry run has to show what will land, row by row — but a
// 5k-row export must not become a payload the browser swallows whole.

describe("PreviewCollector", () => {
  const row = (title: string) =>
    ({
      kind: "rocks" as const,
      action: "create" as const,
      title,
      owner: "Sarah Chen",
      detail: [],
    });

  test("keeps rows up to the cap, counts the overflow", () => {
    const c = new PreviewCollector(3);
    for (const t of ["a", "b", "c", "d", "e"]) c.add(row(t));
    assert.equal(c.rows.length, 3);
    assert.equal(c.truncated, 2);
    assert.deepEqual(c.rows.map((r) => r.title), ["a", "b", "c"]);
  });

  test("nothing truncated under the cap", () => {
    const c = new PreviewCollector(10);
    c.add(row("a"));
    c.add(row("b"));
    assert.equal(c.rows.length, 2);
    assert.equal(c.truncated, 0);
  });

  test("preserves insertion order", () => {
    const c = new PreviewCollector();
    for (const t of ["z", "m", "a"]) c.add(row(t));
    assert.deepEqual(c.rows.map((r) => r.title), ["z", "m", "a"]);
  });
});

// C-10 follow-up: the create/update actions cap text (lib/text-limits.ts); the
// importers must too, or an over-length imported title only fails on first edit.
describe("import length caps", () => {
  const tbl = (csv: string) => toTable(parseDelimited(csv));
  const long = (n: number) => "x".repeat(n);
  const run = (inputs: Parameters<typeof runTeamImport>[2], db = new FakeFirestore()) =>
    runTeamImport(
      db.asFirestore(),
      "t1",
      inputs,
      { createOwners: false, unmatchedOwner: "no-owner", fallbackOwnerId: "u1" },
      [],
    ).then((report) => ({ report, db }));

  function assertRejected(
    report: Awaited<ReturnType<typeof run>>["report"],
    db: FakeFirestore,
    collection: string,
    reason: RegExp,
  ) {
    const stats = report.kinds[0];
    assert.equal(stats.imported, 1, "the in-limit row still imports");
    assert.equal(stats.skipped, 1);
    assert.equal(db.docsIn(collection).length, 1);
    const skip = report.rows.find((r) => r.action === "skip");
    assert.ok(skip, "over-length row reported in the preview");
    assert.match(skip.note ?? "", reason);
    assert.ok(skip.title.length <= 81, "echoed title is clipped");
    assert.ok(stats.details.some((d) => /length limit/.test(d)));
  }

  test("todos: over-length title and description are rejected per row", async () => {
    for (const [col, val, re] of [
      ["Title", long(TITLE_MAX + 1), /Title too long/],
      ["Description", long(LONG_TEXT_MAX + 1), /Description too long/],
    ] as const) {
      const csv =
        col === "Title"
          ? `Title,Owner\n${val},\nok,\n`
          : `Title,Description,Owner\nbad,${val},\nok,fine,\n`;
      const { report, db } = await run({ todos: { table: tbl(csv) } });
      assertRejected(report, db, "todos", re);
    }
  });

  test("todos: values exactly at the cap import", async () => {
    const { report, db } = await run({
      todos: { table: tbl(`Title,Description,Owner\n${long(TITLE_MAX)},${long(LONG_TEXT_MAX)},\n`) },
    });
    assert.equal(report.kinds[0].imported, 1);
    assert.equal(db.docsIn("todos").length, 1);
  });

  test("todos: an over-length Owner name is rejected (it would become a description note)", async () => {
    const { report, db } = await run({
      todos: { table: tbl(`Title,Owner\nbad,${long(TITLE_MAX + 1)}\nok,\n`) },
    });
    assertRejected(report, db, "todos", /Owner name too long/);
  });

  test("issues: over-length title is rejected per row", async () => {
    const { report, db } = await run({
      issues: { tables: [tbl(`Title,Owner\n${long(TITLE_MAX + 1)},\nok,\n`)] },
    });
    assertRejected(report, db, "issues", /Title too long/);
  });

  test("issues: over-length description is rejected per row", async () => {
    const { report, db } = await run({
      issues: {
        tables: [tbl(`Title,Description,Owner\nbad,${long(LONG_TEXT_MAX + 1)},\nok,,\n`)],
      },
    });
    assertRejected(report, db, "issues", /Description too long/);
  });

  test("headlines: over-length title and body are rejected per row", async () => {
    const t = await run({
      headlines: { tables: [tbl(`Title,Owner\n${long(TITLE_MAX + 1)},\nok,\n`)] },
    });
    assertRejected(t.report, t.db, "headlines", /Title too long/);
    const b = await run({
      headlines: {
        tables: [tbl(`Title,Description,Owner\nbad,${long(LONG_TEXT_MAX + 1)},\nok,,\n`)],
      },
    });
    assertRejected(b.report, b.db, "headlines", /Details too long/);
  });

  test("rocks: over-length title, quarter and description are rejected per row", async () => {
    const cases: [string, RegExp][] = [
      [`Title,Owner\n${long(TITLE_MAX + 1)},\nok,\n`, /Title too long/],
      [`Title,Quarter,Owner\nbad,Q3 ${long(TITLE_MAX + 1)},\nok,2026-Q3,\n`, /Quarter too long/],
      [
        `Title,Description,Owner\nbad,${long(LONG_TEXT_MAX + 1)},\nok,,\n`,
        /Description too long/,
      ],
    ];
    for (const [csv, re] of cases) {
      const { report, db } = await run({
        rocks: { table: tbl(csv.replace("Owner", "Level,Owner").replace(/,\n/g, ",department,\n")) },
      });
      assertRejected(report, db, "rocks", re);
    }
  });

  test("milestones: over-length title is rejected, the parent rock is unaffected", async () => {
    const { report, db } = await run({
      rocks: { table: tbl("Title,Level,Owner\nR1,department,\n") },
      milestones: {
        table: tbl(
          `Rock Name,Title,Owner\nR1,${long(TITLE_MAX + 1)},\nR1,ok,\n`,
        ),
      },
    });
    const stats = report.kinds.find((k) => k.kind === "milestones")!;
    assert.equal(stats.imported, 1);
    assert.equal(stats.skipped, 1);
    assert.equal(db.docsIn("rocks").length, 1);
    assert.equal(db.docsIn("todos").length, 1);
    assert.match(
      report.rows.find((r) => r.kind === "milestones" && r.action === "skip")?.note ?? "",
      /Title too long/,
    );
  });

  test("scorecard: over-length name and group are rejected, with no entries or group written", async () => {
    const { report, db } = await run({
      scorecard: {
        table: tbl(
          `Name,Group,Owner,Jul 27 - Aug 2\n${long(TITLE_MAX + 1)},G,,5\nok,${long(TITLE_MAX + 1)},,5\nfine,Good,,7\n`,
        ),
      },
    });
    const stats = report.kinds[0];
    assert.equal(stats.imported, 1);
    assert.equal(stats.skipped, 2);
    assert.equal(db.docsIn("scorecard_metrics").length, 1);
    assert.equal(db.docsIn("scorecard_entries").length, 1);
    assert.equal(db.docsIn("scorecard_groups").length, 1);
  });
});
