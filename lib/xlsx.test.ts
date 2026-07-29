import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  columnIndex,
  excelSerialToDateString,
  parseSharedStrings,
  parseSheetXml,
  pickSheet,
} from "./xlsx";

// The ZIP/sheet plumbing is exercised end-to-end against real ninety exports;
// what's pinned here are the conversions that silently corrupt data when wrong.

describe("excelSerialToDateString", () => {
  test("converts serials from the 1899-12-30 epoch", () => {
    assert.equal(excelSerialToDateString(46220), "2026-07-17");
    assert.equal(excelSerialToDateString(45658), "2025-01-01");
    assert.equal(excelSerialToDateString(1), "1900-01-01");
  });

  test("drops the time-of-day fraction", () => {
    assert.equal(excelSerialToDateString(46220.75), "2026-07-17");
  });

  test("handles the 1900 leap-year bug boundary the way Excel writes it", () => {
    // Serial 59 = 1900-02-28; 61 = 1900-03-01 (60 is Excel's phantom Feb 29).
    assert.equal(excelSerialToDateString(59), "1900-02-28");
    assert.equal(excelSerialToDateString(61), "1900-03-01");
  });
});

describe("columnIndex", () => {
  test("maps cell refs to zero-based columns", () => {
    assert.equal(columnIndex("A1"), 0);
    assert.equal(columnIndex("C7"), 2);
    assert.equal(columnIndex("Z1"), 25);
    assert.equal(columnIndex("AA1"), 26);
    assert.equal(columnIndex("AB12"), 27);
  });
});

describe("parseSharedStrings", () => {
  test("reads plain strings and decodes entities", () => {
    const xml =
      '<sst><si><t>Owner</t></si><si><t>Enterprise Systems &amp; Data</t></si></sst>';
    assert.deepEqual(parseSharedStrings(xml), ["Owner", "Enterprise Systems & Data"]);
  });

  test("joins rich-text runs into one value", () => {
    const xml = "<sst><si><r><t>Cross train </t></r><r><t>Austin</t></r></si></sst>";
    assert.deepEqual(parseSharedStrings(xml), ["Cross train Austin"]);
  });

  test("keeps empty strings so indexes stay aligned", () => {
    const xml = "<sst><si><t/></si><si><t>Second</t></si></sst>";
    assert.deepEqual(parseSharedStrings(xml), ["", "Second"]);
  });

  test("decodes OOXML _xHHHH_ escapes (newline, etc.)", () => {
    const xml =
      "<sst><si><t>Analytical_x000A__x000A_Because of your strengths</t></si></sst>";
    assert.deepEqual(parseSharedStrings(xml), [
      "Analytical\n\nBecause of your strengths",
    ]);
  });
});

describe("parseSheetXml", () => {
  const shared = ["Owner", "Steph Benes", "Link text"];
  const dateStyles = [false, false, true]; // style index 2 formats as a date

  test("keeps an empty self-closing cell in its own column", () => {
    // Regression: `<c r="C1"/>` is self-closing, and a matcher that tries the
    // open-tag form first runs past it to the next cell's </c> — which shifted
    // every later value one column left (Link landing under Completed On).
    const rows = parseSheetXml(
      '<sheetData><row r="1">' +
        '<c r="A1" t="s"><v>1</v></c>' +
        '<c r="B1" s="0"/>' +
        '<c r="C1" t="s"><v>2</v></c>' +
        "</row></sheetData>",
      shared,
      dateStyles,
    );
    assert.deepEqual(rows, [["Steph Benes", "", "Link text"]]);
  });

  test("converts date-styled numbers and leaves plain numbers alone", () => {
    const rows = parseSheetXml(
      '<sheetData><row r="1"><c r="A1" s="2"><v>46220</v></c>' +
        '<c r="B1" s="0"><v>46220</v></c></row></sheetData>',
      shared,
      dateStyles,
    );
    assert.deepEqual(rows, [["2026-07-17", "46220"]]);
  });

  test("pads gaps so sparse rows stay aligned with their headers", () => {
    const rows = parseSheetXml(
      '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c>' +
        '<c r="D1" t="s"><v>1</v></c></row></sheetData>',
      shared,
      dateStyles,
    );
    assert.deepEqual(rows, [["Owner", "", "", "Steph Benes"]]);
  });

  // Namespace prefixes are legal OOXML and exporters disagree: ninety writes
  // its rocks workbook unprefixed and its to-dos workbook with `x:`. A parser
  // that only matches the bare form reads the prefixed file as *empty* rather
  // than failing loudly, so both forms are pinned.
  test("reads namespace-prefixed elements identically", () => {
    const rows = parseSheetXml(
      '<x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c>' +
        '<x:c r="B1" t="s"><x:v>1</x:v></x:c></x:row></x:sheetData>',
      shared,
      dateStyles,
    );
    assert.deepEqual(rows, [["Owner", "Steph Benes"]]);
  });

  test("reads prefixed inline strings and self-closing cells", () => {
    const rows = parseSheetXml(
      '<x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Hello</x:t></x:is></x:c>' +
        '<x:c r="B1"/><x:c r="C1" t="s"><x:v>1</x:v></x:c></x:row></x:sheetData>',
      shared,
      dateStyles,
    );
    assert.deepEqual(rows, [["Hello", "", "Steph Benes"]]);
  });
});

describe("parseSharedStrings", () => {
  test("handles namespace-prefixed string tables", () => {
    assert.deepEqual(
      parseSharedStrings('<x:sst><x:si><x:t>Owner</x:t></x:si><x:si><x:t>Title</x:t></x:si></x:sst>'),
      ["Owner", "Title"],
    );
  });
});

describe("pickSheet", () => {
  const sheets = [
    { name: "Rocks", rows: [["a"]] },
    { name: "Milestones", rows: [["b"]] },
  ];

  test("prefers the sheet matching the data being imported", () => {
    assert.equal(pickSheet(sheets, undefined, /milestone/i).name, "Milestones");
    assert.equal(pickSheet(sheets, undefined, /rock/i).name, "Rocks");
  });

  test("falls back to the first sheet when nothing matches", () => {
    assert.equal(pickSheet(sheets, undefined, /scorecard/i).name, "Rocks");
  });

  test("an explicit name wins, case-insensitively", () => {
    assert.equal(pickSheet(sheets, "milestones", /rock/i).name, "Milestones");
  });

  test("names the available sheets when the explicit one is wrong", () => {
    assert.throws(() => pickSheet(sheets, "Rockz", /rock/i), /Rocks, Milestones/);
  });
});
