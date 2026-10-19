import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mapSeedRecord, planSeedImport, prsInEvidence, type FeedbackSeedRecord } from "./seed";
import { feedbackDocId, validateFeedbackPatch } from "./model";

const SEED_PATH = resolve("docs/feedback/feedback-tracker-seed.json");
const SCREENSHOT_DIR = resolve("docs/feedback/screenshots");
const SEED = JSON.parse(readFileSync(SEED_PATH, "utf8")) as FeedbackSeedRecord[];

describe("the real seed file", () => {
  test("has 59 records numbered 1..59, row = number + 1", () => {
    assert.equal(SEED.length, 59);
    assert.deepEqual(
      SEED.map((r) => r.number),
      Array.from({ length: 59 }, (_, i) => i + 1),
    );
    for (const r of SEED) assert.equal(r.row, (r.number as number) + 1);
  });

  test("every record maps and validates", () => {
    for (const rec of SEED) {
      const m = mapSeedRecord(rec);
      assert.ok(m.ok, m.ok ? "" : `${m.label}: ${m.error}`);
      assert.equal(m.id, feedbackDocId(rec.number as number));
      assert.equal(m.item.sheet_row, rec.row);
      assert.equal(m.item.original_comment, rec.original_comment, "verbatim");
      assert.equal(m.item.client_resolution, rec.resolution_ste);
      assert.equal(m.item.created_by, null);
      // Re-validating the mapped values through the app's patch validator
      // leaves them unchanged (original_comment / number / sheet_row are not
      // editable, so they are left out).
      const { status, reported_on, reviewer, page, type, summary, comment_display, client_resolution,
        resolution, client_note, evidence, prs, branches, follow_up_with, follow_up_topic, follow_ups,
        decision_source, screenshots, shipped_at } = m.item;
      const editable = { status, reported_on, reviewer, page, type, summary, comment_display,
        client_resolution, resolution, client_note, evidence, prs, branches, follow_up_with,
        follow_up_topic, follow_ups, decision_source, screenshots, shipped_at };
      assert.deepEqual(validateFeedbackPatch(editable), editable, m.id);
    }
  });

  test("screenshots are rowNN.png basenames that exist in docs/feedback/screenshots", () => {
    let count = 0;
    for (const rec of SEED) {
      const m = mapSeedRecord(rec);
      assert.ok(m.ok);
      for (const name of m.item.screenshots) {
        assert.match(name, /^row\d{2}\.png$/);
        assert.ok(existsSync(resolve(SCREENSHOT_DIR, name)), `${m.id}: ${name} missing`);
        count++;
      }
    }
    assert.ok(count > 0);
  });

  test("statuses are the seed's five", () => {
    const statuses = new Set(SEED.map((r) => mapSeedRecord(r)).map((m) => (m.ok ? m.item.status : null)));
    assert.deepEqual([...statuses].sort(), ["answered", "completed", "deployed", "follow_up", "postponed"]);
  });

  test("work.prs, work.branches and evidence PRs are carried over", () => {
    const m = mapSeedRecord(SEED.find((r) => r.number === 57)!);
    assert.ok(m.ok);
    assert.ok([86, 88, 91].every((n) => m.item.prs.includes(n)));
    assert.deepEqual(m.item.branches, ["feat/fb-58-meeting-add-todo"]);
    const m1 = mapSeedRecord(SEED.find((r) => r.number === 1)!);
    assert.ok(m1.ok);
    assert.deepEqual(m1.item.prs, [18]);
  });

  test("planSeedImport: all 59 to create on an empty database; existing ids skipped", () => {
    const empty = planSeedImport(SEED, new Set());
    assert.equal(empty.create.length, 59);
    assert.equal(empty.invalid.length, 0);
    const some = planSeedImport(SEED, new Set(["fb-001", "fb-037"]));
    assert.equal(some.create.length, 57);
    assert.deepEqual(some.skip, ["fb-001", "fb-037"]);
  });
});

describe("mapping edge cases", () => {
  const base = SEED[0];

  test("an invalid record is reported, not thrown", () => {
    const m = mapSeedRecord({ ...base, status: "closed" });
    assert.equal(m.ok, false);
    assert.match(m.ok ? "" : m.error, /Unknown status/);
    assert.equal(mapSeedRecord({ ...base, number: undefined }).ok, false);
    assert.equal(mapSeedRecord({ ...base, original_comment: " " }).ok, false);
  });

  test("a repeated number is invalid", () => {
    const plan = planSeedImport([base, base], new Set());
    assert.equal(plan.create.length, 1);
    assert.equal(plan.invalid.length, 1);
  });

  test("prsInEvidence reads only PR references", () => {
    assert.deepEqual(prsInEvidence(["PR #18 merged", "Merged PRs #90 and #93", "PR #86, #88", "Pass 14 #6"]), [
      18, 90, 93, 86, 88,
    ]);
  });
});
