import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  daysFromNow,
  daysUntil,
  dueDateShort,
  relativeDueLabel,
} from "./dates";

describe("viewer time zone", () => {
  // 2026-10-16 23:30 in Denver is 2026-10-17 05:30 UTC.
  const LATE_DENVER = new Date("2026-10-17T05:30:00Z");

  test("daysUntil counts from the zone's calendar day", () => {
    assert.equal(daysUntil("2026-10-16", LATE_DENVER, "America/Denver"), 0);
    assert.equal(daysUntil("2026-10-16", LATE_DENVER, "UTC"), -1);
    assert.equal(daysUntil("2026-10-17", LATE_DENVER, "UTC"), 0);
  });

  test("dueDateShort reads Today only on the viewer's today", () => {
    const at = (due: string, tz: string) =>
      dueDateShort(due, false, LATE_DENVER, tz);
    assert.equal(at("2026-10-16", "America/Denver"), "Today");
    assert.equal(at("2026-10-16", "UTC"), "Oct 16");
    assert.equal(at("2026-10-17", "UTC"), "Today");
    assert.equal(at("2026-10-17", "America/Denver"), "Oct 17");
  });

  test("relativeDueLabel honours the zone", () => {
    assert.equal(
      relativeDueLabel("2026-10-16", LATE_DENVER, false, "America/Denver"),
      "today",
    );
    assert.equal(
      relativeDueLabel("2026-10-16", LATE_DENVER, false, "UTC"),
      "1d overdue",
    );
  });

  test("an invalid zone falls back to APP_TIME_ZONE, not a crash", () => {
    assert.equal(daysUntil("2026-10-16", LATE_DENVER, "Not/AZone"), 0);
    assert.equal(
      dueDateShort("2026-10-16", false, LATE_DENVER, "Not/AZone"),
      "Today",
    );
  });
});

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
