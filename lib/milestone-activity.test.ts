import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  milestoneEditEvent,
  milestoneTraceRows,
  type MilestoneTraceFields,
} from "./milestone-activity";

const names = new Map([
  ["ann", "Ann Lee"],
  ["bob", "Bob Ray"],
]);
const nameOf = (id: string) => names.get(id);
const due = (iso: string) => `D(${iso})`;

const base: MilestoneTraceFields = {
  title: "Ship it",
  owner_id: "ann",
  due_date: "2026-11-01",
  description: null,
};

describe("milestoneTraceRows", () => {
  test("a new milestone is one created row with owner and due", () => {
    assert.deepEqual(milestoneTraceRows(null, base, "bob", nameOf, due), [
      { kind: "created", detail: "Owner Ann Lee · Due D(2026-11-01)" },
    ]);
  });

  test("the actor's own milestone reads 'you'; no due date is left out", () => {
    assert.deepEqual(
      milestoneTraceRows(null, { ...base, due_date: null }, "ann", nameOf, due),
      [{ kind: "created", detail: "Owner you" }],
    );
  });

  test("an unchanged save writes nothing", () => {
    assert.deepEqual(milestoneTraceRows(base, { ...base }, "ann", nameOf, due), []);
  });

  test("title, owner and due changes fold into one updated row", () => {
    const rows = milestoneTraceRows(
      base,
      { ...base, title: "Ship it now", owner_id: "bob", due_date: null },
      "ann",
      nameOf,
      due,
    );
    assert.deepEqual(rows, [
      {
        kind: "updated",
        detail: "Renamed to “Ship it now” · Owner Bob Ray · Due date cleared",
      },
    ]);
  });

  test("a description change is its own row, after the summary", () => {
    assert.deepEqual(
      milestoneTraceRows(
        base,
        { ...base, due_date: "2026-11-02", description: "Notes" },
        "ann",
        nameOf,
        due,
      ),
      [
        { kind: "updated", detail: "Due D(2026-11-02)" },
        { kind: "description", detail: null },
      ],
    );
  });

  test("clearing a description counts; null and missing are the same", () => {
    assert.deepEqual(
      milestoneTraceRows({ ...base, description: "x" }, base, "ann", nameOf, due),
      [{ kind: "description", detail: null }],
    );
  });
});

describe("milestoneEditEvent (followers hear a milestone edit like a to-do edit)", () => {
  const base = { title: "Kickoff", owner_id: "a", due_date: "2026-10-01", description: null };
  test("description change", () => {
    assert.equal(
      milestoneEditEvent(base, { ...base, description: "<p>Scope</p>" }),
      "description_changed",
    );
  });
  test("title outranks description; nothing changed → null", () => {
    assert.equal(
      milestoneEditEvent(base, { ...base, title: "Kick-off", description: "x" }),
      "title_changed",
    );
    assert.equal(milestoneEditEvent(base, base), null);
  });
  test("reassignment alone is left to the owner notices; created → null", () => {
    assert.equal(milestoneEditEvent(base, { ...base, owner_id: "b" }), null);
    assert.equal(milestoneEditEvent(null, base), null);
  });
});
