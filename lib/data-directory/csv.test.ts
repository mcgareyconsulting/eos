import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseDelimited } from "@/lib/csv-import";
import { CSV_BOM, toCsv } from "./csv";

describe("toCsv", () => {
  test("writes a header line and one line per row", () => {
    const csv = toCsv(["A", "B"], [{ A: "1", B: "2" }, { A: "3", B: "4" }]);
    assert.equal(csv, "A,B\r\n1,2\r\n3,4");
  });

  test("headers drive column order, and a missing key writes an empty cell", () => {
    const csv = toCsv(["A", "B", "C"], [{ C: "3", A: "1" }]);
    assert.equal(csv, "A,B,C\r\n1,,3");
  });

  test("quotes delimiters, quotes, newlines and edge whitespace", () => {
    const csv = toCsv(
      ["V"],
      [{ V: "a,b" }, { V: 'say "hi"' }, { V: "line\nbreak" }, { V: " pad " }],
    );
    assert.equal(
      csv,
      ['V', '"a,b"', '"say ""hi"""', '"line\nbreak"', '" pad "'].join("\r\n"),
    );
  });
});

describe("round trip", () => {
  // The whole point of the export: what this writes must come back out of the
  // importer's own parser as the same cells.
  test("survives parseDelimited unchanged", () => {
    const headers = ["Owner", "Title", "Description"];
    const rows = [
      { Owner: "Jane Doe", Title: "Ship, then measure", Description: 'He said "no"' },
      { Owner: "", Title: "Line\nbreak", Description: "  padded  " },
    ];
    const parsed = parseDelimited(toCsv(headers, rows));
    assert.deepEqual(parsed[0], headers);
    assert.deepEqual(parsed[1], ["Jane Doe", "Ship, then measure", 'He said "no"']);
    assert.deepEqual(parsed[2], ["", "Line\nbreak", "  padded  "]);
  });

  test("the Excel BOM is stripped by the importer's parser", () => {
    const parsed = parseDelimited(CSV_BOM + toCsv(["A"], [{ A: "1" }]));
    assert.deepEqual(parsed, [["A"], ["1"]]);
  });
});
