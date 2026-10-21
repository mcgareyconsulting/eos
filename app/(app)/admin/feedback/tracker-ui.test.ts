import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Guards for Daniel's UI calls on the tracker (PR #96): no native selects
// (SelectMenu / MultiSelect only), and no GitHub links while the repository
// moves hosts (PR numbers stay in the data).
const DIR = "app/(app)/admin/feedback";
const files = readdirSync(DIR, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => [f, readFileSync(join(DIR, f), "utf8")] as const);

test("the tracker has no native <select>", () => {
  assert.ok(files.length > 0);
  for (const [f, src] of files) {
    assert.doesNotMatch(src, /<select\b/, f);
    assert.doesNotMatch(src, /\bSelect\b[^M]*from "@\/components\/ui\/input"/, f);
  }
});

test("the tracker has no browser suggestion lists (<datalist>)", () => {
  for (const [f, src] of files) assert.doesNotMatch(src, /<datalist\b|\blist="/, f);
});

test("the tracker links nowhere on github.com", () => {
  for (const [f, src] of files) assert.doesNotMatch(src, /github\.com/i, f);
});

// Daniel, 2026-10-19 (design A): the internal resolution note is gone from
// the UI everywhere — not shown, not edited — and the detail modal shows no
// evidence, PRs or branches. The data keeps all of them.
const source = (name: string) => files.find(([f]) => f === name)?.[1] ?? "";

test("no tracker screen reads or edits the internal resolution note", () => {
  for (const [f, src] of files) {
    assert.doesNotMatch(src, /\.resolution\b/, f);
    // As a label or heading (prose in comments may still name it).
    assert.doesNotMatch(src, /["'>]\s*Internal resolution/i, f);
  }
});

test("the detail modal shows no evidence, PRs or branches", () => {
  const modal = source("feedback-detail-modal.tsx");
  assert.ok(modal.length > 0);
  assert.doesNotMatch(modal, /\.evidence\b|\.prs\b|\.branches\b/);
  assert.doesNotMatch(modal, /\bEvidence\b|\bBranches\b/);
});

test("the detail modal's comments go through the shared thread, as a feedback thread", () => {
  const modal = source("feedback-detail-modal.tsx");
  assert.match(modal, /from "@\/app\/\(app\)\/teams\/\[teamId\]\/entity-comments\/actions"/);
  assert.match(modal, /const THREAD = "feedback" as const/);
  // No client listener: feedback threads are server-only (firestore.rules).
  assert.doesNotMatch(modal, /useEntityComments|firebase\/firestore/);
});
