import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readXlsx } from "@/lib/xlsx";
import {
  XLSX_MAX_CELL_CHARS,
  columnLetter,
  crc32,
  safeSheetName,
  sheetXml,
  stylesXmlForTesting,
  writeXlsx,
  xmlEscape,
} from "./xlsx-writer";
import { excelSerial, normalizeCell } from "./normalize";

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

  test("dates are native date cells: a serial under a date number format", () => {
    const due = normalizeCell("date", "2026-10-16", () => undefined);
    const done = normalizeCell("datetime", new Date("2026-07-01T17:30:00Z"), () => undefined);
    const xml = sheetXml({ sheetName: "S", headers: ["Due", "Done"], rows: [[due, done]] });
    // Numbers, not strings — so they sort and filter as dates.
    assert.match(xml, /<c r="A2" s="3"><v>46311<\/v><\/c>/);
    assert.match(xml, new RegExp(`<c r="B2" s="4"><v>${excelSerial(2026, 7, 1, 11, 30)}</v></c>`));
    assert.doesNotMatch(xml, /2026-10-16/);

    const buf = writeXlsx({ sheetName: "S", headers: ["Due", "Done"], rows: [[due, done]] });
    // The styles carry the formats the cells point at.
    const [sheet] = readXlsx(buf);
    // The reader sees date-formatted serials as dates (it reads the day only).
    assert.deepEqual(sheet.rows.at(-1), ["2026-10-16", "2026-07-01"]);
  });

  test("the styles define yyyy-mm-dd and yyyy-mm-dd hh:mm on styles 3 and 4", () => {
    const styles = stylesXmlForTesting();
    assert.match(styles, /<numFmt numFmtId="164" formatCode="yyyy-mm-dd"\/>/);
    assert.match(styles, /<numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"\/>/);
    const xfs = styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/)![0].match(/<xf\b[^>]*>/g)!;
    assert.match(xfs[3], /numFmtId="164"/);
    assert.match(xfs[4], /numFmtId="165"/);
  });

  test("a date cell with no usable serial falls back to neutralized text", () => {
    const xml = sheetXml({
      sheetName: "S",
      headers: ["d"],
      rows: [[{ kind: "date", serial: Number.NaN, text: "=1+1" }]],
    });
    assert.match(xml, /t="inlineStr"[^>]*><is><t xml:space="preserve">'=1\+1<\/t>/);
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
