import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { csvBytes, csvField, CSV_MIME, writeCsv } from "./csv";

describe("CSV writer", () => {
  test("UTF-8 with a BOM, CRLF line endings, header line first", () => {
    const csv = writeCsv({ headers: ["Owner", "To-do"], rows: [["José Núñez", "Call"]] });
    assert.equal(csv, "﻿Owner,To-do\r\nJosé Núñez,Call\r\n");
    const bytes = csvBytes({ headers: ["A"], rows: [] });
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    // Accents survive as UTF-8.
    assert.equal(Buffer.from(csvBytes({ headers: ["é"], rows: [] })).toString("utf8"), "﻿é\r\n");
    assert.equal(CSV_MIME, "text/csv; charset=utf-8");
  });

  test("RFC 4180 quoting: comma, quote, CR, LF; quotes doubled", () => {
    assert.equal(csvField("plain"), "plain");
    assert.equal(csvField("a,b"), '"a,b"');
    assert.equal(csvField('say "hi"'), '"say ""hi"""');
    assert.equal(csvField("line one\nline two"), '"line one\nline two"');
    assert.equal(csvField("a\r\nb"), '"a\r\nb"');
    assert.equal(csvField(""), "");
  });

  test("formula injection is neutralized on every text cell, headers included", () => {
    const csv = writeCsv({
      headers: ["=Header"],
      rows: [
        ['=HYPERLINK("https://evil.example","x")'],
        ["+1"],
        ["-2+3"],
        ["@SUM(A1)"],
        ["\t=cmd"],
        ["\r=cmd"],
        ["  =1+1"],
        ["Fine first line\n=EVIL()"],
      ],
    });
    const lines = csv.slice(1);
    assert.equal(
      lines,
      [
        "'=Header",
        `"'=HYPERLINK(""https://evil.example"",""x"")"`,
        "'+1",
        "'-2+3",
        "'@SUM(A1)",
        "'\t=cmd",
        `"'\r=cmd"`,
        "'  =1+1",
        `"'Fine first line\n=EVIL()"`,
        "",
      ].join("\r\n"),
    );
  });

  test("number cells stay numbers; only finite ones are written", () => {
    assert.equal(csvField(42), "42");
    assert.equal(csvField(-3.5), "-3.5");
    assert.equal(csvField(Number.NaN), "");
    assert.equal(csvField(Number.POSITIVE_INFINITY), "");
  });

  test("dates and times are plain text cells", () => {
    assert.equal(
      writeCsv({ headers: ["Due", "Completed"], rows: [["2026-10-20", "2026-10-16 13:05"]] }),
      "﻿Due,Completed\r\n2026-10-20,2026-10-16 13:05\r\n",
    );
  });
});
