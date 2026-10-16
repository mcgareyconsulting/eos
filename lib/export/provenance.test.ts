import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  appVersion,
  exportFileName,
  exporterLabel,
  filtersLabel,
  provenanceLines,
  slug,
} from "./provenance";

describe("provenance", () => {
  test("app version: build id, Cloud Run revision, or a local marker", () => {
    assert.equal(appVersion({ DEPLOYMENT_ID: "abc1234-xyz", K_REVISION: "eos-00042-abc" }), "abc1234-xyz · eos-00042-abc");
    assert.equal(appVersion({ DEPLOYMENT_ID: " abc " }), "abc");
    assert.equal(appVersion({}), "local build");
  });

  test("exporter label", () => {
    assert.equal(exporterLabel({ uid: "u", name: "Ada", email: "a@x" }), "Ada <a@x>");
    assert.equal(exporterLabel({ uid: "u", email: "a@x" }), "a@x");
    assert.equal(exporterLabel({ uid: "u" }), "u");
  });

  test("filters label", () => {
    assert.equal(filtersLabel([]), "None");
    assert.equal(
      filtersLabel([
        { label: "Team", value: "Ops" },
        { label: "View", value: "Active" },
      ]),
      "Team: Ops · View: Active",
    );
  });

  test("file names are ASCII slugs with the Mountain day", () => {
    assert.equal(slug("Café & Loans / Ops"), "cafe-loans-ops");
    assert.equal(slug("★★"), "export");
    // 05:30Z on the 17th is still the 16th in Denver (it would be the 17th
    // in Chicago).
    assert.equal(
      exportFileName("todos", ["Executive Team", "archived"], new Date("2026-10-17T05:30:00Z")),
      "hpb-pulse_todos_executive-team_archived_2026-10-16",
    );
  });

  test("exported at: Mountain time, labeled MDT / MST", () => {
    const at = (iso: string) =>
      provenanceLines({
        title: "To-Dos",
        exportedBy: "Ada",
        now: new Date(iso),
        filters: [],
        rowCount: 0,
        version: "local build",
      }).find((l) => l.label === "Exported at")?.value;
    assert.equal(at("2026-10-16T19:05:00Z"), "2026-10-16 13:05 MDT (Mountain Time, America/Denver)");
    assert.equal(at("2026-12-16T19:05:00Z"), "2026-12-16 12:05 MST (Mountain Time, America/Denver)");
  });
});
