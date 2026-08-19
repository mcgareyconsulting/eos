import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
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

// N6: ninety exports rocks + milestones as one two-sheet workbook. The Import
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

// N6 finding 4: a departed employee's rows must still import — with No Owner
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

// N6 finding 2: the dry run has to show what will land, row by row — but a
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
