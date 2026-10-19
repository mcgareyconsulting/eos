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

test("the tracker links nowhere on github.com", () => {
  for (const [f, src] of files) assert.doesNotMatch(src, /github\.com/i, f);
});
