/**
 * Guard for I-10 / the 2026-09-27 region drift: firebase-functions v2 reads
 * the global options when a trigger is *defined*, so every module under
 * functions/src that defines a function must import ./global-options before
 * anything else. A new function file that forgets it would silently deploy
 * with public ingress, the Compute Engine default SA (roles/editor) and
 * us-central1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "functions", "src");
const DEFINES_FUNCTION = /\b(onSchedule|onDocument\w*|onCall|onRequest|onTaskDispatched|onMessagePublished|onObject\w*|before\w+)\s*\(/;

function firstImport(source: string): string | undefined {
  return source.match(/^import\s[^;]*;/m)?.[0];
}

test("every functions module that defines a trigger imports ./global-options first", () => {
  const files = readdirSync(SRC).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "global-options.ts",
  );
  const definers = files.filter((f) => DEFINES_FUNCTION.test(readFileSync(join(SRC, f), "utf8")));
  assert.ok(definers.length >= 5, `expected the known function modules, found ${definers.join(", ")}`);
  for (const f of definers) {
    assert.equal(
      firstImport(readFileSync(join(SRC, f), "utf8")),
      'import "./global-options";',
      `${f} must import "./global-options" as its first import`,
    );
  }
});

test("global options keep internal-only ingress, us-east1 and the dedicated SA", () => {
  const src = readFileSync(join(SRC, "global-options.ts"), "utf8");
  assert.match(src, /ingressSettings:\s*"ALLOW_INTERNAL_ONLY"/);
  assert.match(src, /FUNCTIONS_REGION = "us-east1"/);
  assert.match(src, /FUNCTIONS_SERVICE_ACCOUNT = "eos-functions@hpb-eos-prod\.iam\.gserviceaccount\.com"/);
});
