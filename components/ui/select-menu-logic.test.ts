import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_TYPEAHEAD,
  PAGE_SIZE,
  TYPEAHEAD_TIMEOUT_MS,
  comboboxKeyAction,
  comboboxRows,
  filterOptions,
  findExact,
  firstEnabled,
  initialActive,
  lastEnabled,
  moveActive,
  nextTypeahead,
  printableChar,
  resolveComboboxText,
  selectKeyAction,
  toOptions,
  typeaheadLive,
  typeaheadMatch,
} from "./select-menu-logic";

// d = disabled, e = enabled
function rows(pattern: string) {
  return [...pattern].map((c) => ({ disabled: c === "d" }));
}

describe("active-row navigation", () => {
  test("first/last enabled skip disabled rows, -1 when there are none", () => {
    assert.equal(firstEnabled(rows("ddee")), 2);
    assert.equal(lastEnabled(rows("eedd")), 1);
    assert.equal(firstEnabled(rows("ddd")), -1);
    assert.equal(lastEnabled([]), -1);
  });

  test("next/prev skip disabled rows", () => {
    const r = rows("edede");
    assert.equal(moveActive(r, 0, "next"), 2);
    assert.equal(moveActive(r, 2, "next"), 4);
    assert.equal(moveActive(r, 4, "prev"), 2);
    assert.equal(moveActive(r, 2, "prev"), 0);
  });

  test("the ends don't wrap", () => {
    const r = rows("eeed");
    assert.equal(moveActive(r, 2, "next"), 2, "last enabled row stays put (trailing disabled)");
    assert.equal(moveActive(r, 0, "prev"), 0);
    assert.equal(moveActive(rows("dee"), 1, "prev"), 1, "leading disabled row is never reached");
  });

  test("from nothing active, next lands first and prev lands last", () => {
    const r = rows("deed");
    assert.equal(moveActive(r, -1, "next"), 1);
    assert.equal(moveActive(r, -1, "prev"), 2);
    assert.equal(moveActive(r, -1, "pageNext"), 1);
    assert.equal(moveActive(r, -1, "pagePrev"), 2);
    // An index past the end (options shrank) counts as nothing active.
    assert.equal(moveActive(r, 9, "next"), 1);
  });

  test("home/end jump to the first/last enabled row", () => {
    const r = rows("deeed");
    assert.equal(moveActive(r, 2, "first"), 1);
    assert.equal(moveActive(r, 2, "last"), 3);
  });

  test("page moves by PAGE_SIZE, settling on an enabled row", () => {
    const r = rows("e".repeat(25));
    assert.equal(moveActive(r, 0, "pageNext"), PAGE_SIZE);
    assert.equal(moveActive(r, 20, "pageNext"), 24, "clamps to the end");
    assert.equal(moveActive(r, 24, "pagePrev"), 24 - PAGE_SIZE);
    assert.equal(moveActive(r, 3, "pagePrev"), 0, "clamps to the start");

    const gappy = rows("eeeeeeeeeedde"); // 10 is disabled, 11 disabled, 12 enabled
    assert.equal(moveActive(gappy, 0, "pageNext"), 12, "past disabled rows forward");
    const tail = rows("eeeedddddddddddd");
    assert.equal(moveActive(tail, 1, "pageNext"), 3, "falls back to the last enabled row");
    assert.equal(moveActive(tail, 3, "pageNext"), 3, "never moves backwards");
    const head = rows("ddddddeeee");
    assert.equal(moveActive(head, 8, "pagePrev"), 6);
  });

  test("all disabled: nothing to land on", () => {
    const r = rows("ddd");
    assert.equal(moveActive(r, -1, "next"), -1);
    assert.equal(moveActive(r, -1, "first"), -1);
  });

  test("opening starts on the selected row unless it is disabled", () => {
    const r = rows("eede");
    assert.equal(initialActive(r, 3, "selected"), 3);
    assert.equal(initialActive(r, 2, "selected"), 0, "disabled selection → first enabled");
    assert.equal(initialActive(r, -1, "selected"), 0, "no selection → first enabled");
    assert.equal(initialActive(r, 3, "first"), 0);
    assert.equal(initialActive(r, 0, "last"), 3);
  });
});

describe("select keyboard map", () => {
  const k = (key: string, mods: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) => ({
    key,
    ...mods,
  });

  test("closed: arrows, Enter and Space open on the selection; Home/End open at the ends", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Enter", " "]) {
      assert.deepEqual(selectKeyAction(k(key), false, false), { type: "open", focus: "selected" }, key);
    }
    assert.deepEqual(selectKeyAction(k("ArrowDown", { altKey: true }), false, false), {
      type: "open",
      focus: "selected",
    });
    assert.deepEqual(selectKeyAction(k("Home"), false, false), { type: "open", focus: "first" });
    assert.deepEqual(selectKeyAction(k("End"), false, false), { type: "open", focus: "last" });
  });

  test("closed: Escape and Tab are left alone (the dialog / focus order handle them)", () => {
    assert.equal(selectKeyAction(k("Escape"), false, false), null);
    assert.equal(selectKeyAction(k("Tab"), false, false), null);
  });

  test("open: navigation keys move", () => {
    assert.deepEqual(selectKeyAction(k("ArrowDown"), true, false), { type: "move", move: "next" });
    assert.deepEqual(selectKeyAction(k("ArrowUp"), true, false), { type: "move", move: "prev" });
    assert.deepEqual(selectKeyAction(k("Home"), true, false), { type: "move", move: "first" });
    assert.deepEqual(selectKeyAction(k("End"), true, false), { type: "move", move: "last" });
    assert.deepEqual(selectKeyAction(k("PageDown"), true, false), { type: "move", move: "pageNext" });
    assert.deepEqual(selectKeyAction(k("PageUp"), true, false), { type: "move", move: "pagePrev" });
  });

  test("open: Enter, Space and Alt+Up choose; Escape closes; Tab closes and moves on", () => {
    assert.deepEqual(selectKeyAction(k("Enter"), true, false), { type: "commit" });
    assert.deepEqual(selectKeyAction(k(" "), true, false), { type: "commit" });
    assert.deepEqual(selectKeyAction(k("ArrowUp", { altKey: true }), true, false), { type: "commit" });
    assert.deepEqual(selectKeyAction(k("Escape"), true, false), { type: "close" });
    assert.deepEqual(selectKeyAction(k("Tab"), true, false), { type: "tabClose" });
  });

  test("Space mid type-ahead is part of the search, open or closed", () => {
    assert.deepEqual(selectKeyAction(k(" "), true, true), { type: "typeahead", char: " " });
    assert.deepEqual(selectKeyAction(k(" "), false, true), { type: "typeahead", char: " " });
  });

  test("letters type ahead; shortcuts don't", () => {
    assert.deepEqual(selectKeyAction(k("m"), false, false), { type: "typeahead", char: "m" });
    assert.deepEqual(selectKeyAction(k("M"), true, false), { type: "typeahead", char: "M" });
    assert.equal(selectKeyAction(k("c", { metaKey: true }), true, false), null);
    assert.equal(selectKeyAction(k("r", { ctrlKey: true }), false, false), null);
    assert.equal(selectKeyAction(k("Shift"), true, false), null);
    assert.equal(printableChar(k("å", { altKey: true })), null);
  });
});

describe("combobox keyboard map", () => {
  test("closed: Down opens on the current value, Up opens at the bottom", () => {
    assert.deepEqual(comboboxKeyAction({ key: "ArrowDown" }, false, false), { type: "open", focus: "selected" });
    assert.deepEqual(comboboxKeyAction({ key: "ArrowUp" }, false, false), { type: "open", focus: "last" });
  });

  test("Enter picks only when a row is active, otherwise it submits the form", () => {
    assert.deepEqual(comboboxKeyAction({ key: "Enter" }, true, true), { type: "commit" });
    assert.equal(comboboxKeyAction({ key: "Enter" }, true, false), null);
    assert.equal(comboboxKeyAction({ key: "Enter" }, false, false), null);
  });

  test("Escape and Tab close an open list; on a closed one they pass through", () => {
    assert.deepEqual(comboboxKeyAction({ key: "Escape" }, true, false), { type: "close" });
    assert.equal(comboboxKeyAction({ key: "Escape" }, false, false), null);
    assert.deepEqual(comboboxKeyAction({ key: "Tab" }, true, true), { type: "tabClose" });
    assert.equal(comboboxKeyAction({ key: "Tab" }, false, false), null);
    assert.deepEqual(comboboxKeyAction({ key: "ArrowUp", altKey: true }, true, false), { type: "close" });
  });

  test("text-editing keys stay with the input", () => {
    for (const key of ["Home", "End", "a", " ", "Backspace", "ArrowLeft"]) {
      assert.equal(comboboxKeyAction({ key }, true, true), null, key);
    }
  });

  test("open: arrows and paging move", () => {
    assert.deepEqual(comboboxKeyAction({ key: "ArrowDown" }, true, false), { type: "move", move: "next" });
    assert.deepEqual(comboboxKeyAction({ key: "ArrowUp" }, true, true), { type: "move", move: "prev" });
    assert.deepEqual(comboboxKeyAction({ key: "PageDown" }, true, true), { type: "move", move: "pageNext" });
  });
});

describe("type-ahead", () => {
  const items = [
    { label: "Alabama" },
    { label: "Alaska" },
    { label: "Arizona", disabled: true },
    { label: "Arkansas" },
    { label: "  California" },
    { label: "Colorado" },
  ];

  test("buffer grows while typing and restarts after a pause", () => {
    let s = nextTypeahead(EMPTY_TYPEAHEAD, "a", 1000);
    assert.equal(s.buffer, "a");
    s = nextTypeahead(s, "l", 1000 + TYPEAHEAD_TIMEOUT_MS - 1);
    assert.equal(s.buffer, "al");
    assert.ok(typeaheadLive(s, s.at + 10));
    assert.ok(!typeaheadLive(s, s.at + TYPEAHEAD_TIMEOUT_MS));
    s = nextTypeahead(s, "c", s.at + TYPEAHEAD_TIMEOUT_MS);
    assert.equal(s.buffer, "c");
    assert.ok(!typeaheadLive(EMPTY_TYPEAHEAD, 0));
  });

  test("a prefix matches case-insensitively, ignoring leading spaces", () => {
    assert.equal(typeaheadMatch(items, "CAL", -1), 4);
    assert.equal(typeaheadMatch(items, "co", -1), 5);
    assert.equal(typeaheadMatch(items, "zz", 0), -1);
    assert.equal(typeaheadMatch(items, "", 0), -1);
    assert.equal(typeaheadMatch([], "a", 0), -1);
  });

  test("a longer string stays on the current row while it still matches", () => {
    assert.equal(typeaheadMatch(items, "ala", 0), 0);
    assert.equal(typeaheadMatch(items, "alas", 0), 1);
  });

  test("repeating one letter cycles through its rows, skipping disabled, wrapping", () => {
    assert.equal(typeaheadMatch(items, "a", -1), 0);
    assert.equal(typeaheadMatch(items, "a", 0), 1);
    assert.equal(typeaheadMatch(items, "aa", 1), 3, "Arizona is disabled");
    assert.equal(typeaheadMatch(items, "aaa", 3), 0, "wraps");
    assert.equal(typeaheadMatch(items, "c", 5), 4);
  });

  test("disabled rows are never matched", () => {
    assert.equal(typeaheadMatch(items, "ari", -1), -1);
  });
});

describe("combobox rows", () => {
  const groups = toOptions(["Weekly", "Compliance", "Sales pipeline"]);

  test("bare strings become value = label options", () => {
    assert.deepEqual(groups[0], { value: "Weekly", label: "Weekly" });
    const mixed = toOptions(["A", { value: "b", label: "B", disabled: true }]);
    assert.deepEqual(mixed[1], { value: "b", label: "B", disabled: true });
  });

  test("filtering is a case-insensitive substring match that keeps order", () => {
    assert.deepEqual(
      filterOptions(groups, "L").map((o) => o.label),
      ["Weekly", "Compliance", "Sales pipeline"],
    );
    assert.deepEqual(filterOptions(groups, " pipe ").map((o) => o.label), ["Sales pipeline"]);
    assert.equal(filterOptions(groups, "").length, 3);
  });

  test("exact match ignores case and outer spaces, by label or value", () => {
    assert.equal(findExact(groups, "  weekly ")?.value, "Weekly");
    assert.equal(findExact(groups, "week"), undefined);
    assert.equal(findExact(groups, "   "), undefined);
    const byValue = [{ value: "gte", label: "At least" }];
    assert.equal(findExact(byValue, "GTE")?.label, "At least");
  });

  test("new text adds a create row after the matches", () => {
    const r = comboboxRows(groups, "Comp", { allowCreate: true });
    assert.deepEqual(
      r.map((x) => (x.kind === "option" ? x.option.label : `+${x.value}`)),
      ["Compliance", "+Comp"],
    );
  });

  test("no create row for an existing value, empty text, or when creating is off", () => {
    assert.ok(comboboxRows(groups, "compliance", { allowCreate: true }).every((x) => x.kind === "option"));
    assert.equal(comboboxRows(groups, "   ", { allowCreate: true }).length, 3);
    assert.deepEqual(comboboxRows(groups, "Ops", { allowCreate: false }), []);
  });

  test("the create row carries the trimmed text", () => {
    const r = comboboxRows(groups, "  Ops  ", { allowCreate: true });
    assert.deepEqual(r, [{ kind: "create", value: "Ops" }]);
  });

  test("disabled options stay listed but are flagged for navigation", () => {
    const r = comboboxRows([{ value: "x", label: "X", disabled: true }], "", { allowCreate: true });
    assert.equal(r[0].disabled, true);
    assert.equal(moveActive(r, -1, "next"), -1);
  });

  test("leaving the field snaps to an existing option, otherwise trims", () => {
    assert.equal(resolveComboboxText(groups, " compliance"), "Compliance");
    assert.equal(resolveComboboxText(groups, "  New group "), "New group");
    assert.equal(resolveComboboxText(groups, ""), "");
    assert.equal(
      resolveComboboxText([{ value: "Old", label: "Old", disabled: true }], "old"),
      "old",
      "a disabled option is not snapped to",
    );
  });
});
