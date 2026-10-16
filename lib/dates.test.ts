import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { daysFromNow, daysUntil, dueDateShort } from "./dates";

// Late in the day on purpose: the count is in whole local days, not hours.
const NOW = new Date(2026, 9, 16, 23, 59);

describe("daysUntil", () => {
  test("counts whole local days regardless of time of day", () => {
    assert.equal(daysUntil("2026-10-16", NOW), 0);
    assert.equal(daysUntil("2026-10-15", NOW), -1);
    assert.equal(daysUntil("2026-10-23", NOW), 7);
    assert.equal(daysUntil("2026-10-30", NOW), 14);
  });
});

describe("dueDateShort", () => {
  test('reads "Today" for an open item due today', () => {
    assert.equal(dueDateShort(daysFromNow(0, NOW), false, NOW), "Today");
  });

  test("keeps the date otherwise", () => {
    assert.equal(dueDateShort("2026-10-17", false, NOW), "Oct 17");
    assert.equal(dueDateShort("2026-10-15", false, NOW), "Oct 15");
  });

  test("done items keep their date, undated reads a dash", () => {
    assert.equal(dueDateShort("2026-10-16", true, NOW), "Oct 16");
    assert.equal(dueDateShort(null, false, NOW), "—");
  });
});
