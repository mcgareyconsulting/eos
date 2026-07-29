import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  cell,
  detectDelimiter,
  importDocId,
  inferUnit,
  normalizeDescription,
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
  toTable,
} from "./csv-import";

// The importer's whole job is turning someone else's export into our schema, so
// the mappings are pinned here rather than discovered at import time against a
// client's real file.

describe("parseDelimited", () => {
  test("parses quoted fields with commas and newlines", () => {
    const rows = parseDelimited('a,b\n"x,1","line1\nline2"\n');
    assert.deepEqual(rows, [
      ["a", "b"],
      ["x,1", "line1\nline2"],
    ]);
  });

  test("unescapes doubled quotes and strips the BOM", () => {
    const rows = parseDelimited('﻿name\n"He said ""go"""');
    assert.deepEqual(rows, [["name"], ['He said "go"']]);
  });

  test("drops blank rows and handles CRLF", () => {
    assert.deepEqual(parseDelimited("a,b\r\n1,2\r\n\r\n"), [
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("auto-detects tab-separated input (pasted from a spreadsheet)", () => {
    assert.equal(detectDelimiter("Owner\tTitle\tDue Date"), "\t");
    assert.equal(detectDelimiter("Owner,Title,Due Date"), ",");
    assert.deepEqual(parseDelimited("Owner\tTitle\nSam\tShip it"), [
      ["Owner", "Title"],
      ["Sam", "Ship it"],
    ]);
  });
});

describe("toTable / cell", () => {
  const table = toTable(parseDelimited("Owner,Due Date,Notes\nSam,2026-07-27,"));

  test("maps rows onto trimmed headers", () => {
    assert.deepEqual(table.rows[0], { Owner: "Sam", "Due Date": "2026-07-27", Notes: "" });
  });

  test("looks up cells case-insensitively across accepted spellings", () => {
    assert.equal(cell(table.rows[0], table.headers, "Title", "Owner"), "Sam");
    assert.equal(cell(table.rows[0], table.headers, "due  date"), "2026-07-27");
    assert.equal(cell(table.rows[0], table.headers, "Notes"), "");
    assert.equal(cell(table.rows[0], table.headers, "Nope"), "");
  });
});

describe("parseDateOnly", () => {
  test("accepts the formats exports emit", () => {
    assert.equal(parseDateOnly("2026-07-27"), "2026-07-27");
    assert.equal(parseDateOnly("7/27/2026"), "2026-07-27");
    assert.equal(parseDateOnly("07/27/26"), "2026-07-27");
    assert.equal(parseDateOnly("Jul 27, 2026"), "2026-07-27");
    assert.equal(parseDateOnly("July 27th 2026"), "2026-07-27");
    assert.equal(parseDateOnly("27 July 2026"), "2026-07-27");
  });

  test("reads ISO timestamps in UTC so US timezones don't lose a day", () => {
    assert.equal(parseDateOnly("2026-07-27T00:00:00.000Z"), "2026-07-27");
  });

  test("returns null for blank and unparseable cells", () => {
    assert.equal(parseDateOnly(""), null);
    assert.equal(parseDateOnly("someday"), null);
    assert.equal(parseDateOnly("13/45/2026"), null);
  });
});

describe("parseWeekHeader", () => {
  const anchor = new Date(2026, 6, 27); // Mon Jul 27 2026

  test("resolves ninety-style week ranges to the Monday", () => {
    assert.equal(parseWeekHeader("Jul 27 - Aug 2", anchor), "2026-07-27");
    assert.equal(parseWeekHeader("Jul 20 - Jul 26", anchor), "2026-07-20");
    assert.equal(parseWeekHeader("May 4 - May 10", anchor), "2026-05-04");
  });

  test("buckets a non-Monday start to its Monday", () => {
    assert.equal(parseWeekHeader("Jul 26 - Aug 1", anchor), "2026-07-20");
  });

  test("picks the year closest to the anchor, rolling over at January", () => {
    const january = new Date(2027, 0, 4);
    assert.equal(parseWeekHeader("Dec 28 - Jan 3", january), "2026-12-28");
    assert.equal(parseWeekHeader("Jan 4 - Jan 10", january), "2027-01-04");
  });

  test("honors an explicit year over the anchor", () => {
    assert.equal(parseWeekHeader("Jul 27 - Aug 2, 2024", anchor), "2024-07-22");
    assert.equal(parseWeekHeader("2025-07-28", anchor), "2025-07-28");
  });

  test("accepts numeric headers", () => {
    assert.equal(parseWeekHeader("7/27 - 8/2", anchor), "2026-07-27");
    assert.equal(parseWeekHeader("7/27/2026", anchor), "2026-07-27");
  });

  test("returns null for the non-week columns, so they can be ignored", () => {
    for (const h of ["Group Name", "Status", "Title", "Description", "Owner", "Goal", "Average"]) {
      assert.equal(parseWeekHeader(h, anchor), null, h);
    }
  });
});

describe("parseNumericValue", () => {
  test("strips currency, percent, and thousands separators", () => {
    assert.equal(parseNumericValue("$1,234"), 1234);
    assert.equal(parseNumericValue("12.5%"), 12.5);
    assert.equal(parseNumericValue("  42 "), 42);
  });

  test("reads parenthesized numbers as negative", () => {
    assert.equal(parseNumericValue("(400)"), -400);
  });

  test("maps yes/no to 1/0 and h:mm to minutes", () => {
    assert.equal(parseNumericValue("Yes"), 1);
    assert.equal(parseNumericValue("no"), 0);
    assert.equal(parseNumericValue("1:30"), 90);
  });

  test("treats blanks and placeholders as no entry", () => {
    for (const v of ["", "—", "-", "N/A", "TBD"]) {
      assert.equal(parseNumericValue(v), null, v);
    }
  });
});

describe("parseGoal", () => {
  test("reads direction from symbols and words", () => {
    assert.deepEqual(parseGoal("≥ 40"), { goal: 40, direction: "gte", unit: "number" });
    assert.deepEqual(parseGoal(">= 40"), { goal: 40, direction: "gte", unit: "number" });
    assert.deepEqual(parseGoal("Greater Than or Equal To 40"), {
      goal: 40,
      direction: "gte",
      unit: "number",
    });
    assert.equal(parseGoal("≤ 5").direction, "lte");
    assert.equal(parseGoal("at most 5").direction, "lte");
    assert.equal(parseGoal("= 12").direction, "eq");
  });

  test("defaults an unqualified target to at-least", () => {
    assert.deepEqual(parseGoal("40"), { goal: 40, direction: "gte", unit: "number" });
  });

  test("derives the unit from the goal's formatting", () => {
    assert.equal(parseGoal("$1,000,000").unit, "currency");
    assert.equal(parseGoal("≥ 95%").unit, "percent");
    assert.equal(parseGoal("≤ 1:30").unit, "time");
  });

  test("survives a blank goal", () => {
    assert.deepEqual(parseGoal(""), { goal: null, direction: "gte", unit: "number" });
  });
});

describe("inferUnit", () => {
  test("falls back to the values when the goal column is bare", () => {
    assert.equal(inferUnit("number", ["$412,000", "$380,000"]), "currency");
    assert.equal(inferUnit("number", ["92%", ""]), "percent");
    assert.equal(inferUnit("number", ["Yes", "No"]), "yesno");
    assert.equal(inferUnit("number", ["14", "12"]), "number");
  });

  test("never overrides a unit the goal already established", () => {
    assert.equal(inferUnit("percent", ["$5"]), "percent");
  });
});

describe("normalizeRockStatus", () => {
  test("maps export vocabulary onto the app's statuses", () => {
    assert.equal(normalizeRockStatus("On Track", null), "on_track");
    assert.equal(normalizeRockStatus("Off-Track", null), "off_track");
    assert.equal(normalizeRockStatus("At Risk", null), "off_track");
    assert.equal(normalizeRockStatus("Complete", null), "done");
    assert.equal(normalizeRockStatus("Cancelled", null), "cancelled");
  });

  test("a completion date wins over a stale status column", () => {
    assert.equal(normalizeRockStatus("On Track", "2026-06-30"), "done");
    assert.equal(normalizeRockStatus("", "2026-06-30"), "done");
  });

  test("defaults to on_track when the column is unrecognized", () => {
    assert.equal(normalizeRockStatus("¯\\_(ツ)_/¯", null), "on_track");
  });
});

describe("normalizeRockType", () => {
  test("maps ninety's Level column", () => {
    assert.equal(normalizeRockType("Company"), "company");
    assert.equal(normalizeRockType("Departmental"), "department");
    assert.equal(normalizeRockType("Individual"), "individual");
    assert.equal(normalizeRockType(""), "individual");
  });
});

describe("normalizeQuarter", () => {
  test("normalizes the ways a quarter gets written", () => {
    assert.equal(normalizeQuarter("2026-Q3", null), "2026-Q3");
    assert.equal(normalizeQuarter("Q3 2026", null), "2026-Q3");
    assert.equal(normalizeQuarter("2026 Q3", null), "2026-Q3");
  });

  test("keeps a fiscal-year label verbatim rather than relabelling it", () => {
    // HPB's ninety export says "Q2 FY 2026" for a rock due 2026-07-17 — their
    // fiscal Q2 is not calendar Q2, so rewriting it would be a lie.
    assert.equal(normalizeQuarter("Q2 FY 2026", "2026-07-17"), "Q2 FY 2026");
    assert.equal(normalizeQuarter("FY26 Q3", null), "FY26 Q3");
  });

  test("derives the quarter from the due date when the column is blank", () => {
    assert.equal(normalizeQuarter("", "2026-08-15"), "2026-Q3");
    assert.equal(normalizeQuarter("", null), null);
  });
});

describe("normalizePersonKey", () => {
  test("matches the same person across spellings", () => {
    assert.equal(normalizePersonKey("Sarah Chen"), "sarah chen");
    assert.equal(normalizePersonKey("Chen, Sarah"), "sarah chen");
    assert.equal(normalizePersonKey("  SARAH   CHEN "), "sarah chen");
    assert.equal(normalizePersonKey("sarah.chen@bank.com"), "sarah.chen@bank.com");
  });
});

describe("importDocId", () => {
  test("is stable across runs so a re-import updates in place", () => {
    const a = importDocId("rock", "team1", "Hit Q3 deposit target");
    assert.equal(a, importDocId("rock", "team1", "Hit Q3 deposit target"));
    assert.equal(a, importDocId("rock", "team1", "  hit q3 deposit target  "));
  });

  test("separates kinds and teams", () => {
    assert.notEqual(
      importDocId("rock", "team1", "Same title"),
      importDocId("metric", "team1", "Same title"),
    );
    assert.notEqual(
      importDocId("rock", "team1", "Same title"),
      importDocId("rock", "team2", "Same title"),
    );
  });

  test("produces a legal Firestore doc id", () => {
    const id = importDocId("metric", "team1", "Deposits — net new $ / week (Ops)");
    assert.match(id, /^[a-z0-9-]+$/);
    assert.ok(id.length < 100);
  });
});

describe("normalizeKey", () => {
  test("links milestones to rocks despite punctuation drift", () => {
    assert.equal(normalizeKey("Launch Mobile App v2.0"), normalizeKey("launch mobile app v2 0"));
  });
});

describe("normalizeDescription", () => {
  test("inserts a blank line when a label is glued to a Because-paragraph", () => {
    const raw =
      "AnalyticalBecause of your strengths, you may earnestly apply yourself.";
    assert.equal(
      normalizeDescription(raw),
      "Analytical\n\nBecause of your strengths, you may earnestly apply yourself.",
    );
  });

  test("leaves already-multiline text alone", () => {
    const raw = "Analytical\n\nBecause of your strengths.";
    assert.equal(normalizeDescription(raw), raw);
  });

  test("normalizes CRLF", () => {
    assert.equal(normalizeDescription("Line one\r\nLine two"), "Line one\nLine two");
  });
});
