import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readXlsx } from "@/lib/xlsx";
import {
  XLSX_MAX_CELL_CHARS,
  columnLetter,
  crc32,
  safeSheetName,
  sheetXml,
  writeXlsx,
  xmlEscape,
} from "./xlsx-writer";

describe("writeXlsx", () => {
  test("round-trips through the in-house reader: provenance, header, rows", () => {
    const buf = writeXlsx({
      sheetName: "To-Dos",
      preamble: [
        { label: "Export", value: "To-Dos" },
        { label: "Exported by", value: "Ada" },
      ],
      headers: ["Title", "Count"],
      rows: [
        ["First <one> & \"two\"", 3],
        ["Multi\nline", 4.5],
      ],
    });
    const [sheet] = readXlsx(buf);
    assert.equal(sheet.name, "To-Dos");
    // The reader drops the blank spacer row.
    assert.deepEqual(sheet.rows, [
      ["Export", "To-Dos"],
      ["Exported by", "Ada"],
      ["Title", "Count"],
      ['First <one> & "two"', "3"],
      ["Multi\nline", "4.5"],
    ]);
  });

  test("formula-looking strings are neutralized in every cell, header and provenance too", () => {
    const evil = '=HYPERLINK("https://evil.example","x")';
    const buf = writeXlsx({
      sheetName: "S",
      preamble: [{ label: "@label", value: "+value" }],
      headers: ["-header"],
      rows: [[evil], ["\t=cmd"], ["safe"]],
    });
    const [sheet] = readXlsx(buf);
    assert.deepEqual(sheet.rows, [
      ["'@label", "'+value"],
      ["'-header"],
      [`'${evil}`],
      ["'\t=cmd"],
      ["safe"],
    ]);
    // Never written as a formula element.
    assert.doesNotMatch(sheetXml({ sheetName: "S", headers: ["a"], rows: [[evil]] }), /<f>/);
  });

  test("numbers are numeric cells, strings are inline strings", () => {
    const xml = sheetXml({ sheetName: "S", headers: ["n"], rows: [[42], ["42"]] });
    assert.match(xml, /<c r="A2" s="2"><v>42<\/v><\/c>/);
    assert.match(xml, /<c r="A3" t="inlineStr"/);
  });

  test("header row is frozen below the provenance block", () => {
    const xml = sheetXml({
      sheetName: "S",
      preamble: [{ label: "a", value: "b" }],
      headers: ["h"],
      rows: [],
    });
    // 1 provenance row, 1 spacer, header on row 3.
    assert.match(xml, /<pane ySplit="3" topLeftCell="A4"/);
  });

  test("oversize cells are capped at Excel's limit", () => {
    const [sheet] = readXlsx(
      writeXlsx({ sheetName: "S", headers: ["h"], rows: [["x".repeat(XLSX_MAX_CELL_CHARS + 10)]] }),
    );
    assert.equal(sheet.rows[1][0].length, XLSX_MAX_CELL_CHARS);
  });

  test("helpers", () => {
    assert.equal(columnLetter(0), "A");
    assert.equal(columnLetter(25), "Z");
    assert.equal(columnLetter(26), "AA");
    assert.equal(columnLetter(701), "ZZ");
    assert.equal(safeSheetName("a/b:c*d?[e]"), "a b c d e");
    assert.equal(safeSheetName("x".repeat(40)).length, 31);
    assert.equal(safeSheetName("  "), "Export");
    assert.equal(xmlEscape("a\u0001b<"), "ab&lt;");
    // Known CRC-32 of "123456789".
    assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  });
});
