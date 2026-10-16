import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DUE_SOON_DAYS,
  TODO_DUE_SOON_DAYS,
  dueToneClass,
  urgencyChipClass,
} from "./due";
import { daysFromNow } from "./dates";

// A fixed local "now" so the boundaries do not drift with the wall clock.
const NOW = new Date(2026, 9, 16, 15, 30);
const inDays = (n: number) => daysFromNow(n, NOW);

const RED = "text-[#d63024]";
const BLUE = "text-hpb-blue";
const AMBER = "text-[#8a5a10]";
const MUTED = "text-zinc-500";
const DONE = "text-zinc-400";

describe("window constants", () => {
  test("rocks/milestones keep two weeks, to-dos get one", () => {
    assert.equal(DUE_SOON_DAYS, 14);
    assert.equal(TODO_DUE_SOON_DAYS, 7);
  });
});

describe("dueToneClass", () => {
  test("overdue is red", () => {
    assert.ok(dueToneClass(inDays(-1), false, NOW).includes(RED));
  });

  test("due today is HPB blue, not amber", () => {
    const tone = dueToneClass(inDays(0), false, NOW);
    assert.ok(tone.includes(BLUE));
    assert.ok(!tone.includes(AMBER));
    // Same with the to-do window.
    assert.ok(
      dueToneClass(inDays(0), false, NOW, TODO_DUE_SOON_DAYS).includes(BLUE),
    );
  });

  test("default window is amber through day 14, muted from day 15", () => {
    assert.ok(dueToneClass(inDays(1), false, NOW).includes(AMBER));
    assert.ok(dueToneClass(inDays(14), false, NOW).includes(AMBER));
    assert.ok(dueToneClass(inDays(15), false, NOW).includes(MUTED));
  });

  test("to-do window is amber through day 7, muted from day 8", () => {
    const tone = (n: number) =>
      dueToneClass(inDays(n), false, NOW, TODO_DUE_SOON_DAYS);
    assert.ok(tone(1).includes(AMBER));
    assert.ok(tone(7).includes(AMBER));
    assert.ok(tone(8).includes(MUTED));
    assert.ok(tone(14).includes(MUTED));
  });

  test("done and undated are muted, even when due today or overdue", () => {
    assert.ok(dueToneClass(inDays(0), true, NOW).includes(DONE));
    assert.ok(dueToneClass(inDays(-3), true, NOW).includes(DONE));
    assert.ok(dueToneClass(null, false, NOW).includes(DONE));
  });
});

describe("urgencyChipClass", () => {
  test("shares the tones and the window parameter", () => {
    assert.ok(urgencyChipClass(inDays(-1), false, NOW).includes(RED));
    assert.ok(urgencyChipClass(inDays(0), false, NOW).includes(BLUE));
    assert.ok(urgencyChipClass(inDays(14), false, NOW).includes(AMBER));
    assert.ok(!urgencyChipClass(inDays(15), false, NOW).includes(AMBER));
    assert.ok(
      urgencyChipClass(inDays(7), false, NOW, TODO_DUE_SOON_DAYS).includes(
        AMBER,
      ),
    );
    assert.ok(
      !urgencyChipClass(inDays(8), false, NOW, TODO_DUE_SOON_DAYS).includes(
        AMBER,
      ),
    );
    assert.ok(!urgencyChipClass(inDays(0), true, NOW).includes(BLUE));
  });
});
