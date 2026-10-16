import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  APP_TIME_ZONE,
  calendarDateIn,
  daysUntilIn,
  isValidTimeZone,
  normalizeTimeZone,
  resolveTimeZone,
} from "./time-zone";

// 2026-10-16 23:30 in Denver (MDT, UTC-6) is already 2026-10-17 in UTC —
// the evening window where the server (UTC) and a Mountain browser disagree.
const LATE_DENVER = new Date("2026-10-17T05:30:00Z");

describe("APP_TIME_ZONE", () => {
  test("is the bank's Mountain-time clock", () => {
    assert.equal(APP_TIME_ZONE, "America/Denver");
    assert.ok(isValidTimeZone(APP_TIME_ZONE));
  });
});

describe("calendarDateIn", () => {
  test("day boundary: Denver vs UTC", () => {
    assert.equal(calendarDateIn(LATE_DENVER, "America/Denver"), "2026-10-16");
    assert.equal(calendarDateIn(LATE_DENVER, "UTC"), "2026-10-17");
  });

  test("defaults to APP_TIME_ZONE", () => {
    assert.equal(calendarDateIn(LATE_DENVER), "2026-10-16");
  });

  test("east of UTC rolls over first", () => {
    // 2026-10-16 20:00 UTC is already the 17th in Tokyo.
    const at = new Date("2026-10-16T20:00:00Z");
    assert.equal(calendarDateIn(at, "Asia/Tokyo"), "2026-10-17");
    assert.equal(calendarDateIn(at, "America/Denver"), "2026-10-16");
  });

  test("an invalid zone falls back instead of throwing", () => {
    assert.equal(calendarDateIn(LATE_DENVER, "Not/AZone"), "2026-10-16");
  });
});

describe("daysUntilIn", () => {
  test("counts from the zone's calendar day", () => {
    assert.equal(daysUntilIn("2026-10-16", LATE_DENVER, "America/Denver"), 0);
    assert.equal(daysUntilIn("2026-10-16", LATE_DENVER, "UTC"), -1);
    assert.equal(daysUntilIn("2026-10-17", LATE_DENVER, "America/Denver"), 1);
    assert.equal(daysUntilIn("2026-10-17", LATE_DENVER, "UTC"), 0);
  });

  test("whole days across a DST change", () => {
    // US DST ends 2026-11-01; a 25-hour day must still count as one.
    const at = new Date("2026-10-31T18:00:00Z"); // Oct 31 noon MDT
    assert.equal(daysUntilIn("2026-11-02", at, "America/Denver"), 2);
  });
});

describe("cookie validation", () => {
  test("accepts real IANA zones", () => {
    for (const z of ["America/Denver", "UTC", "Etc/GMT+7", "Asia/Kolkata"]) {
      assert.ok(isValidTimeZone(z), z);
    }
  });

  test("rejects junk without throwing", () => {
    for (const z of [
      "",
      "Not/AZone",
      "America/Denver; Path=/",
      "<script>",
      "../../etc",
      "x".repeat(200),
      undefined,
      null,
      42,
    ]) {
      assert.equal(normalizeTimeZone(z), null, String(z));
      assert.equal(isValidTimeZone(z), false, String(z));
    }
  });

  test("resolveTimeZone falls back to APP_TIME_ZONE", () => {
    assert.equal(resolveTimeZone(undefined), APP_TIME_ZONE);
    assert.equal(resolveTimeZone("Not/AZone"), APP_TIME_ZONE);
    assert.equal(resolveTimeZone("America/New_York"), "America/New_York");
  });
});
