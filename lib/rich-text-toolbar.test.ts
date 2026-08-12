import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  insertLink,
  toggleLinePrefix,
  toggleWrap,
  type Selection,
} from "./rich-text-toolbar";
import { parseRichText, richTextToPlain } from "./rich-text";

// Notation: "|" marks a collapsed caret, "[...]" marks a selection. These
// helpers let a case read as what the author sees in the textarea, which is
// the only way the caret arithmetic stays reviewable.

function parse(spec: string): { text: string; sel: Selection } {
  const caret = spec.indexOf("|");
  if (caret !== -1) {
    const text = spec.replace("|", "");
    return { text, sel: { start: caret, end: caret } };
  }
  const open = spec.indexOf("[");
  const close = spec.indexOf("]");
  assert.ok(open !== -1 && close > open, `bad spec: ${spec}`);
  const text = spec.slice(0, open) + spec.slice(open + 1, close) + spec.slice(close + 1);
  return { text, sel: { start: open, end: close - 1 } };
}

function render(text: string, sel: Selection): string {
  if (sel.start === sel.end) {
    return text.slice(0, sel.start) + "|" + text.slice(sel.start);
  }
  return (
    text.slice(0, sel.start) +
    "[" +
    text.slice(sel.start, sel.end) +
    "]" +
    text.slice(sel.end)
  );
}

const bold = (spec: string) => {
  const { text, sel } = parse(spec);
  const r = toggleWrap(text, sel, "**", "bold text");
  return render(r.text, r.sel);
};

const bullets = (spec: string) => {
  const { text, sel } = parse(spec);
  const r = toggleLinePrefix(text, sel, "bullet");
  return render(r.text, r.sel);
};

const numbers = (spec: string) => {
  const { text, sel } = parse(spec);
  const r = toggleLinePrefix(text, sel, "ordered");
  return render(r.text, r.sel);
};

const link = (spec: string) => {
  const { text, sel } = parse(spec);
  const r = insertLink(text, sel);
  return render(r.text, r.sel);
};

describe("toggleWrap (bold / italic)", () => {
  test("wraps a selection and keeps it selected", () => {
    assert.equal(bold("Blocked on [vendor SLA]."), "Blocked on **[vendor SLA]**.");
  });

  test("with no selection, inserts a placeholder and selects it", () => {
    assert.equal(bold("Blocked on |"), "Blocked on **[bold text]**");
  });

  test("unwraps when the markers sit just outside the selection", () => {
    assert.equal(bold("Blocked on **[vendor SLA]**."), "Blocked on [vendor SLA].");
  });

  test("unwraps when the selection includes the markers", () => {
    assert.equal(bold("Blocked on [**vendor SLA**]."), "Blocked on [vendor SLA].");
  });

  test("italic uses a single underscore", () => {
    const { text, sel } = parse("ship [soon]");
    const r = toggleWrap(text, sel, "_", "italic text");
    assert.equal(render(r.text, r.sel), "ship _[soon]_");
  });

  test("round-trips through the parser", () => {
    const { text, sel } = parse("Blocked on [vendor SLA].");
    const r = toggleWrap(text, sel, "**", "bold text");
    assert.equal(richTextToPlain(r.text), "Blocked on vendor SLA.");
    const blocks = parseRichText(r.text);
    assert.equal(blocks[0].kind, "paragraph");
    assert.equal(
      blocks[0].kind === "paragraph" &&
        blocks[0].children.some((c) => c.kind === "strong"),
      true,
    );
  });
});

describe("toggleLinePrefix (lists)", () => {
  test("prefixes the caret's line", () => {
    assert.equal(bullets("core cutover slip|ped"), "[- core cutover slipped]");
  });

  test("prefixes every line the selection touches", () => {
    assert.equal(
      bullets("[vendor resourcing\nstaffing gaps]"),
      "[- vendor resourcing\n- staffing gaps]",
    );
  });

  test("leaves untouched lines alone", () => {
    const { text, sel } = parse("Blockers:\n[vendor\nstaffing]");
    const r = toggleLinePrefix(text, sel, "bullet");
    assert.equal(r.text, "Blockers:\n- vendor\n- staffing");
  });

  test("numbered lists count from one", () => {
    assert.equal(numbers("[first\nsecond\nthird]"), "[1. first\n2. second\n3. third]");
  });

  test("toggling an already-marked block removes the markers", () => {
    assert.equal(bullets("[- vendor\n- staffing]"), "[vendor\nstaffing]");
    assert.equal(numbers("[1. first\n2. second]"), "[first\nsecond]");
  });

  test("switching kind replaces the marker instead of stacking it", () => {
    // "- vendor" is already marked, so asking for numbers must not yield
    // "1. - vendor".
    const { text, sel } = parse("[- vendor\n- staffing]");
    const cleared = toggleLinePrefix(text, sel, "ordered");
    assert.equal(cleared.text, "vendor\nstaffing");
    const renumbered = toggleLinePrefix(cleared.text, cleared.sel, "ordered");
    assert.equal(renumbered.text, "1. vendor\n2. staffing");
  });

  test("opens a list on an empty line, caret after the marker", () => {
    // Found in the browser: clicking Bullets on a fresh empty line did
    // nothing, because a blank line counted as "already marked" and the
    // toggle took the strip branch. This is the common flow — click, then
    // type the first item — so the caret must land after the marker.
    assert.equal(bullets("|"), "- |");
    assert.equal(numbers("|"), "1. |");
  });

  test("opens a list on the empty line after existing text", () => {
    assert.equal(bullets("Blockers:\n|"), "Blockers:\n- |");
  });

  test("a blank line among content lines still stays blank", () => {
    const { text, sel } = parse("[vendor\n\nstaffing]");
    assert.equal(toggleLinePrefix(text, sel, "bullet").text, "- vendor\n\n- staffing");
  });

  test("what it emits is what the parser reads back as a list", () => {
    const { text, sel } = parse("[vendor\nstaffing]");
    const r = toggleLinePrefix(text, sel, "bullet");
    const blocks = parseRichText(r.text);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, "bullet-list");
    assert.equal(blocks[0].kind === "bullet-list" && blocks[0].items.length, 2);
  });
});

describe("insertLink", () => {
  test("a selected label lands the caret on the empty target", () => {
    // The "https://" stub comes back selected, so typing replaces it.
    assert.equal(link("see [the doc] now"), "see [the doc]([https://]) now");
  });

  test("a selected URL becomes the target, label selected for typing", () => {
    assert.equal(
      link("see [https://hpb.dev/d] now"),
      "see [[link text]](https://hpb.dev/d) now",
    );
  });

  test("no selection inserts a full placeholder snippet", () => {
    assert.equal(link("see |"), "see [link text]([https://])");
  });

  test("a selected mailto is treated as a target too", () => {
    const { text, sel } = parse("[mailto:joe@hpb.dev]");
    assert.equal(insertLink(text, sel).text, "[link text](mailto:joe@hpb.dev)");
  });

  test("what it emits parses back as a link", () => {
    const { text, sel } = parse("see [https://hpb.dev/d]");
    const r = insertLink(text, sel);
    assert.equal(richTextToPlain(r.text), "see link text (https://hpb.dev/d)");
  });
});
