import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { appVersion, exportFileName, slug } from "./provenance";

describe("provenance", () => {
  test("app version: build id, Cloud Run revision, or a local marker", () => {
    assert.equal(appVersion({ DEPLOYMENT_ID: "abc1234-xyz", K_REVISION: "eos-00042-abc" }), "abc1234-xyz · eos-00042-abc");
    assert.equal(appVersion({ DEPLOYMENT_ID: " abc " }), "abc");
    assert.equal(appVersion({}), "local build");
  });

  test("slugs are lowercase ASCII words", () => {
    assert.equal(slug("Café & Loans / Ops"), "cafe-loans-ops");
    assert.equal(slug("★★"), "export");
    assert.equal(slug('a"b;c\r\nd'), "a-b-c-d");
    // Trimmed at 40 without a dangling dash.
    assert.equal(slug(`${"x".repeat(39)} y`), "x".repeat(39));
  });

  test("file name: page, team, view, Mountain date and time, MT, .csv", () => {
    // 05:30Z on the 17th is 23:30 on the 16th in Denver (MDT).
    assert.equal(
      exportFileName("todos", ["Executive Team", "archived"], new Date("2026-10-17T05:30:00Z")),
      "todos-executive-team-archived-2026-10-16-2330-MT.csv",
    );
    // Winter: MST.
    assert.equal(
      exportFileName("todos", ["Ops"], new Date("2026-12-16T19:05:00Z")),
      "todos-ops-2026-12-16-1205-MT.csv",
    );
  });

  test("file names only ever hold safe characters", () => {
    const name = exportFileName('to"dos', ['Team "A"; drop', "../../etc"], new Date());
    assert.match(name, /^[a-z0-9-]+-MT\.csv$/);
  });
});
