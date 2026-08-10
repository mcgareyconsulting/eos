import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  compareRocksForSection,
  groupRocksForL10,
  sortRocksForSection,
} from "./rock-order";

// Pass 18 #17 — Department rocks first in L10: the leading Department
// section must always precede the per-owner speaking-order walk, and "now
// speaking" must never land on that section (it has no single speaker).

type Rock = {
  id: string;
  owner_id: string | null;
  status: string;
  quarter?: string | null;
  due_date: string | null;
  rock_type: string | null;
};

const isDepartmentRock = (r: Rock) =>
  r.owner_id == null || r.rock_type === "department";

const members = [
  { user_id: "u-sarah", full_name: "Sarah Chen" },
  { user_id: "u-marcus", full_name: "Marcus Reed" },
  { user_id: "u-elena", full_name: "Elena Vasquez" },
];
const order = ["u-sarah", "u-marcus", "u-elena"];

function rock(id: string, overrides: Partial<Rock> = {}): Rock {
  return {
    id,
    owner_id: null,
    status: "on_track",
    quarter: "2026-Q3",
    due_date: null,
    rock_type: null,
    ...overrides,
  };
}

describe("groupRocksForL10", () => {
  test("puts the Department section first, ahead of every owner section", () => {
    const rocks = [
      rock("r-sarah", { owner_id: "u-sarah" }),
      rock("r-shared", { owner_id: null }),
      rock("r-marcus", { owner_id: "u-marcus" }),
    ];
    const sections = groupRocksForL10(
      rocks,
      isDepartmentRock,
      members,
      order,
      [],
      "u-sarah",
      "Department",
    );
    assert.equal(sections[0].key, "department");
    assert.equal(sections[0].isDepartmentSection, true);
    assert.deepEqual(sections[0].rocks.map((r) => r.id), ["r-shared"]);
    assert.deepEqual(
      sections.slice(1).map((s) => s.key),
      ["u-sarah", "u-marcus"],
    );
  });

  test("department-typed rocks land in Department even with a personal owner", () => {
    // rock_type === "department" pulls a rock into the shared section even
    // when a person is accountable for it — Feature 5a's rule, mirrored
    // from the Rocks tab.
    const rocks = [
      rock("r-dept-owned", { owner_id: "u-marcus", rock_type: "department" }),
      rock("r-personal", { owner_id: "u-marcus" }),
    ];
    const sections = groupRocksForL10(
      rocks,
      isDepartmentRock,
      members,
      order,
      [],
      null,
      "Department",
    );
    assert.equal(sections[0].key, "department");
    assert.deepEqual(sections[0].rocks.map((r) => r.id), ["r-dept-owned"]);
    const marcus = sections.find((s) => s.key === "u-marcus");
    assert.deepEqual(marcus?.rocks.map((r) => r.id), ["r-personal"]);
  });

  test("omits the Department section entirely when there are no department rocks", () => {
    const rocks = [rock("r1", { owner_id: "u-sarah" })];
    const sections = groupRocksForL10(
      rocks,
      isDepartmentRock,
      members,
      order,
      [],
      null,
      "Department",
    );
    assert.equal(sections.some((s) => s.isDepartmentSection), false);
  });

  test("orders remaining owner sections by speaking order, present before absent", () => {
    const rocks = [
      rock("r-elena", { owner_id: "u-elena" }),
      rock("r-sarah", { owner_id: "u-sarah" }),
      rock("r-marcus", { owner_id: "u-marcus" }),
    ];
    const sections = groupRocksForL10(
      rocks,
      isDepartmentRock,
      members,
      order,
      ["u-sarah"], // Sarah absent — must not sit above Marcus/Elena
      null,
      "Department",
    );
    assert.deepEqual(
      sections.map((s) => s.key),
      ["u-marcus", "u-elena", "u-sarah"],
    );
    assert.equal(sections.find((s) => s.key === "u-sarah")?.absent, true);
    assert.equal(sections.find((s) => s.key === "u-marcus")?.absent, false);
  });

  test("'now speaking' highlights only the current speaker's owner section, never Department", () => {
    const rocks = [
      rock("r-shared", { owner_id: null }),
      rock("r-marcus", { owner_id: "u-marcus" }),
      rock("r-elena", { owner_id: "u-elena" }),
    ];
    const sections = groupRocksForL10(
      rocks,
      isDepartmentRock,
      members,
      order,
      [],
      "u-marcus",
      "Department",
    );
    assert.equal(
      sections.find((s) => s.isDepartmentSection)?.isCurrentSpeaker,
      false,
    );
    assert.equal(
      sections.find((s) => s.key === "u-marcus")?.isCurrentSpeaker,
      true,
    );
    assert.equal(
      sections.find((s) => s.key === "u-elena")?.isCurrentSpeaker,
      false,
    );
  });

  test("places stale owner_ids (not on the roster) after reconciled sections, present orphans before absent", () => {
    const rocks = [
      rock("r-gone1", { owner_id: "u-gone-1" }),
      rock("r-gone2", { owner_id: "u-gone-2" }),
      rock("r-sarah", { owner_id: "u-sarah" }),
    ];
    const sections = groupRocksForL10(
      rocks,
      isDepartmentRock,
      members,
      order,
      ["u-gone-2"],
      null,
      "Department",
    );
    const keys = sections.map((s) => s.key);
    assert.deepEqual(keys, ["u-sarah", "u-gone-1", "u-gone-2"]);
    assert.equal(sections.find((s) => s.key === "u-gone-1")?.title, "—");
  });

  test("returns no sections for an empty rock list", () => {
    assert.deepEqual(
      groupRocksForL10([], isDepartmentRock, members, order, [], null, "Department"),
      [],
    );
  });
});

describe("sortRocksForSection / compareRocksForSection", () => {
  test("orders by status, then quarter, then due date", () => {
    const rocks = [
      rock("off-q4", { status: "off_track", quarter: "2026-Q4" }),
      rock("on-q3-later", {
        status: "on_track",
        quarter: "2026-Q3",
        due_date: "2026-09-15",
      }),
      rock("on-q3-sooner", {
        status: "on_track",
        quarter: "2026-Q3",
        due_date: "2026-08-01",
      }),
      rock("done", { status: "done" }),
      rock("cancelled", { status: "cancelled" }),
    ];
    const sorted = sortRocksForSection(rocks).map((r) => r.id);
    assert.deepEqual(sorted, [
      "on-q3-sooner",
      "on-q3-later",
      "off-q4",
      "done",
      "cancelled",
    ]);
  });

  test("puts undated rocks after dated ones within the same status/quarter", () => {
    const rocks = [
      rock("undated", { due_date: null }),
      rock("dated", { due_date: "2026-08-01" }),
    ];
    assert.deepEqual(sortRocksForSection(rocks).map((r) => r.id), [
      "dated",
      "undated",
    ]);
  });

  test("is a stable pairwise comparator (ties resolve to 0)", () => {
    const a = rock("a");
    const b = rock("b");
    assert.equal(compareRocksForSection(a, b), 0);
  });
});
