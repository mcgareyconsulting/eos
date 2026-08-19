import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHeadlineKind,
  pickRockWorkbookSheets,
  rocksWorkbookFromBytes,
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
