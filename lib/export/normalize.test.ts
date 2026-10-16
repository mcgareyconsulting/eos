import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  formatChicagoDate,
  formatChicagoDateTime,
  normalizeCell,
  toDate,
} from "./normalize";

const names = new Map([["u1", "Ada Lovelace"]]);
const nameOf = (id: string) => names.get(id);

describe("normalizeCell", () => {
  test("datetime is America/Chicago with its zone, CDT and CST", () => {
    // 2026-07-01 17:30Z = 12:30 CDT; 2026-01-15 17:30Z = 11:30 CST.
    assert.equal(
      normalizeCell("datetime", new Date("2026-07-01T17:30:00Z"), nameOf),
      "2026-07-01 12:30 CDT",
    );
    assert.equal(
      normalizeCell("datetime", Date.parse("2026-01-15T17:30:00Z"), nameOf),
      "2026-01-15 11:30 CST",
    );
  });

  test("date: a stored day passes through; an instant is its Chicago day", () => {
    assert.equal(normalizeCell("date", "2026-10-16", nameOf), "2026-10-16");
    // 03:00Z on the 17th is still the 16th in Chicago.
    const ts = { toMillis: () => Date.parse("2026-10-17T03:00:00Z") };
    assert.equal(normalizeCell("date", ts, nameOf), "2026-10-16");
    assert.equal(normalizeCell("date", null, nameOf), "");
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
    assert.equal(formatChicagoDate(d), "2026-12-31");
    assert.equal(formatChicagoDateTime(d), "2026-12-31 17:59 CST");
  });
});
