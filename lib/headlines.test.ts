import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  UNKNOWN_OWNER_LABEL,
  groupByOwner,
  splitCascadingSection,
  type SectionableHeadline,
} from "./headlines";

// These rules are shared by the Headlines tab and the in-meeting Headlines
// segment. Both surfaces resolve a per-row display name on their own
// (member lookup / "You" / CSV owner fallback) — this module only owns the
// section split and the owner-name grouping once that name is known.

const headline = (
  over: Partial<SectionableHeadline> & { id: string },
): SectionableHeadline & { id: string } => ({
  kind: "customer",
  broadcast: false,
  ...over,
});

describe("splitCascadingSection", () => {
  test("routes cascading-kind headlines to the cascading list", () => {
    const { team, cascading } = splitCascadingSection([
      headline({ id: "a", kind: "customer" }),
      headline({ id: "b", kind: "cascading" }),
      headline({ id: "c", kind: "general" }),
    ]);
    assert.deepEqual(
      team.map((h) => h.id),
      ["a", "c"],
    );
    assert.deepEqual(
      cascading.map((h) => h.id),
      ["b"],
    );
  });

  test("routes broadcast copies to the cascading list even if kind isn't cascading", () => {
    // Broadcast copies are always cascading in practice, but the split
    // should not depend on that — either signal alone is enough.
    const { team, cascading } = splitCascadingSection([
      headline({ id: "a", kind: "customer", broadcast: true }),
      headline({ id: "b", kind: "employee", broadcast: false }),
    ]);
    assert.deepEqual(
      cascading.map((h) => h.id),
      ["a"],
    );
    assert.deepEqual(
      team.map((h) => h.id),
      ["b"],
    );
  });

  test("preserves input order within each list", () => {
    const { team } = splitCascadingSection([
      headline({ id: "z" }),
      headline({ id: "a" }),
      headline({ id: "m" }),
    ]);
    assert.deepEqual(
      team.map((h) => h.id),
      ["z", "a", "m"],
    );
  });

  test("handles an empty list", () => {
    const { team, cascading } = splitCascadingSection([]);
    assert.deepEqual(team, []);
    assert.deepEqual(cascading, []);
  });
});

describe("groupByOwner", () => {
  const row = (id: string, name: string) => ({ id, name });

  test("groups rows by resolved display name, preserving first-appearance order", () => {
    const groups = groupByOwner(
      [row("1", "Alice"), row("2", "Bob"), row("3", "Alice")],
      (r) => r.name,
    );
    assert.deepEqual(
      groups.map((g) => g.name),
      ["Alice", "Bob"],
    );
    assert.deepEqual(
      groups[0].headlines.map((h) => h.id),
      ["1", "3"],
    );
    assert.deepEqual(
      groups[1].headlines.map((h) => h.id),
      ["2"],
    );
  });

  test("keeps each group's internal order as given (callers sort first)", () => {
    const groups = groupByOwner(
      [row("newest", "Alice"), row("older", "Alice")],
      (r) => r.name,
    );
    assert.deepEqual(
      groups[0].headlines.map((h) => h.id),
      ["newest", "older"],
    );
  });

  test("collects unresolved names ('—') into a trailing unknown group", () => {
    const groups = groupByOwner(
      [row("1", "Alice"), row("2", "—"), row("3", "Bob"), row("4", "—")],
      (r) => r.name,
    );
    assert.deepEqual(
      groups.map((g) => g.name),
      ["Alice", "Bob", UNKNOWN_OWNER_LABEL],
    );
    assert.deepEqual(
      groups.at(-1)!.headlines.map((h) => h.id),
      ["2", "4"],
    );
  });

  test("puts the unknown group last even if it appears first", () => {
    const groups = groupByOwner(
      [row("1", "—"), row("2", "Alice")],
      (r) => r.name,
    );
    assert.deepEqual(
      groups.map((g) => g.name),
      ["Alice", UNKNOWN_OWNER_LABEL],
    );
  });

  test("treats a blank/whitespace-only name as unknown too", () => {
    const groups = groupByOwner([row("1", "   "), row("2", "")], (r) => r.name);
    assert.deepEqual(
      groups.map((g) => g.name),
      [UNKNOWN_OWNER_LABEL],
    );
  });

  test("returns no groups for an empty list", () => {
    assert.deepEqual(groupByOwner([], (r: { name: string }) => r.name), []);
  });

  test("omits the unknown group entirely when every row resolves", () => {
    const groups = groupByOwner([row("1", "Alice")], (r) => r.name);
    assert.deepEqual(
      groups.map((g) => g.name),
      ["Alice"],
    );
  });
});
