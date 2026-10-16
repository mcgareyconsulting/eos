import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { APP_TIME_ZONE } from "@/lib/time-zone";
import {
  EXPORT_TIME_ZONE,
  cellText,
  excelSerial,
  formatMountainDate,
  formatMountainDateTime,
  normalizeCell,
  toDate,
} from "./normalize";

const names = new Map([["u1", "Ada Lovelace"]]);
const nameOf = (id: string) => names.get(id);

describe("normalizeCell", () => {
  test("exports read time on the bank's clock", () => {
    assert.equal(EXPORT_TIME_ZONE, APP_TIME_ZONE);
    assert.equal(EXPORT_TIME_ZONE, "America/Denver");
  });

  test("datetime is a native date cell in Mountain time; the text names MDT / MST", () => {
    // 2026-07-01 17:30Z = 11:30 MDT; 2026-01-15 17:30Z = 10:30 MST.
    assert.deepEqual(normalizeCell("datetime", new Date("2026-07-01T17:30:00Z"), nameOf), {
      kind: "datetime",
      serial: excelSerial(2026, 7, 1, 11, 30),
      text: "2026-07-01 11:30 MDT",
    });
    assert.deepEqual(normalizeCell("datetime", Date.parse("2026-01-15T17:30:00Z"), nameOf), {
      kind: "datetime",
      serial: excelSerial(2026, 1, 15, 10, 30),
      text: "2026-01-15 10:30 MST",
    });
    assert.equal(normalizeCell("datetime", null, nameOf), "");
  });

  test("date: a stored day passes through as a date cell; an instant is its Mountain day", () => {
    assert.deepEqual(normalizeCell("date", "2026-10-16", nameOf), {
      kind: "date",
      serial: 46311,
      text: "2026-10-16",
    });
    // 05:00Z on the 17th is still the 16th in Denver.
    const ts = { toMillis: () => Date.parse("2026-10-17T05:00:00Z") };
    assert.equal(cellText(normalizeCell("date", ts, nameOf)), "2026-10-16");
    assert.equal(normalizeCell("date", null, nameOf), "");
  });

  test("dates a spreadsheet can't hold stay text", () => {
    // Not a real day: kept as typed, not rolled into March.
    assert.equal(normalizeCell("date", "2026-02-30", nameOf), "2026-02-30");
    // Before 1900-03-01 Excel's serials are off by one (its 1900 leap-year bug).
    assert.equal(normalizeCell("date", "1899-12-31", nameOf), "1899-12-31");
  });

  test("Excel serials", () => {
    // Known Excel values.
    assert.equal(excelSerial(2025, 1, 1), 45658);
    assert.equal(excelSerial(2026, 1, 1), 46023);
    assert.equal(excelSerial(2026, 1, 1, 12, 0), 46023.5);
  });

  test("Timestamp-likes are read through toDate()", () => {
    const ts = { toDate: () => new Date("2026-07-01T17:30:00Z") };
    assert.equal(toDate(ts)?.toISOString(), "2026-07-01T17:30:00.000Z");
    assert.equal(toDate("not a date"), null);
  });

  test("user ids become display names", () => {
    assert.equal(normalizeCell("user", "u1", nameOf), "Ada Lovelace");
    assert.equal(normalizeCell("user", null, nameOf), "Unassigned");
    assert.equal(normalizeCell("user", "ghost", nameOf), "—");
  });

  test("rich text flattens to plain", () => {
    assert.equal(
      normalizeCell("richtext", "**Bold** and [link](https://x.example)", nameOf),
      "Bold and link (https://x.example)",
    );
    assert.equal(normalizeCell("richtext", "- one\n- two", nameOf), "• one\n• two");
  });

  test("booleans, numbers and text", () => {
    assert.equal(normalizeCell("boolean", true, nameOf), "Yes");
    assert.equal(normalizeCell("boolean", undefined, nameOf), "No");
    assert.equal(normalizeCell("number", 4.5, nameOf), 4.5);
    assert.equal(normalizeCell("number", "4.5", nameOf), "");
    assert.equal(normalizeCell("text", "  padded  ", nameOf), "padded");
    assert.equal(normalizeCell("text", null, nameOf), "");
  });

  test("format helpers", () => {
    const d = new Date("2026-12-31T23:59:00Z");
    assert.equal(formatMountainDate(d), "2026-12-31");
    assert.equal(formatMountainDateTime(d), "2026-12-31 16:59 MST");
    assert.equal(cellText(42), "42");
    assert.equal(cellText("x"), "x");
  });
});
