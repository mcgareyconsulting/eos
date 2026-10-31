import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readXlsx } from "../../lib/xlsx";
import { writeXlsx } from "./xlsx-writer";

describe("writeXlsx", () => {
  test("round-trips several tabs through the app's own reader", () => {
    const buf = writeXlsx([
      { name: "Summary", rows: [["Metric", "Count"], ["Truly unassigned", 4]] },
      { name: "Measurables", rows: [["Name", "Owner"], ["Loans <closed> & funded", "Katy Bell"], ["Blank owner", null]] },
    ]);
    const sheets = readXlsx(buf);
    assert.deepEqual(sheets.map((s) => s.name), ["Summary", "Measurables"]);
    assert.deepEqual(sheets[0].rows[1], ["Truly unassigned", "4"]);
    assert.equal(sheets[1].rows[1][0], "Loans <closed> & funded");
  });

  test("tab names are made legal and unique", () => {
    const buf = writeXlsx([
      { name: "People/Flags: a very long tab name that Excel would refuse", rows: [["a"]] },
      { name: "People/Flags: a very long tab name that Excel would refuse", rows: [["b"]] },
    ]);
    const names = readXlsx(buf).map((s) => s.name);
    assert.ok(names.every((n) => n.length <= 31 && !/[[\]:*?/\\]/.test(n)));
    assert.notEqual(names[0], names[1]);
  });
});
