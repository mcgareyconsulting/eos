import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  hasRichMarkup,
  parseInline,
  parseRichText,
  richTextToPlain,
  safeHref,
  type BlockNode,
  type InlineNode,
} from "./rich-text";

// The grammar is deliberately small (bold / italic / bullets / links) because
// that is the whole client ask. These tests pin two things that matter more
// than the happy path: pre-existing plain-text descriptions must survive
// untouched, and nothing an author types may become an unsafe href.

/** Compact shape for assertions: "strong(bold)" / "link(label -> href)". */
function shape(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      if (n.kind === "text") return n.text;
      if (n.kind === "link") return `link(${shape(n.children)} -> ${n.href})`;
      return `${n.kind}(${shape(n.children)})`;
    })
    .join("");
}

function blockShape(blocks: BlockNode[]): string {
  return blocks
    .map((b) => {
      if (b.kind === "paragraph") return `p[${shape(b.children)}]`;
      const items = b.items.map((i) => shape(i.children)).join("|");
      return b.kind === "bullet-list"
        ? `ul[${items}]`
        : `ol@${b.start}[${items}]`;
    })
    .join(" ");
}

describe("backward compatibility with existing plain text", () => {
  test("marker-free text is one paragraph of plain text", () => {
    const blocks = parseRichText("Third reschedule — vendor resourcing.");
    assert.deepEqual(blocks, [
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "Third reschedule — vendor resourcing." },
        ],
      },
    ]);
  });

  test("single newlines stay inside the paragraph for whitespace-pre-wrap", () => {
    // Callers already render with `whitespace-pre-wrap`; keeping the \n in the
    // text node is what makes today's multi-line descriptions look identical.
    const blocks = parseRichText("Two RMs out;\ndoc intake still manual.");
    assert.equal(blocks.length, 1);
    assert.equal(
      blockShape(blocks),
      "p[Two RMs out;\ndoc intake still manual.]",
    );
  });

  test("blank lines split paragraphs", () => {
    assert.equal(blockShape(parseRichText("One.\n\nTwo.")), "p[One.] p[Two.]");
  });

  test("empty and whitespace-only input yields no blocks", () => {
    for (const raw of [null, undefined, "", "   ", "\n\n"]) {
      assert.deepEqual(parseRichText(raw), []);
    }
  });

  test("prose punctuation is never mistaken for markup", () => {
    const prose =
      "Cost is 2 * 3 * 4 and the file is snake_case_name.ts (see p_1).";
    assert.equal(blockShape(parseRichText(prose)), `p[${prose}]`);
  });

  test("hasRichMarkup distinguishes plain from formatted", () => {
    assert.equal(hasRichMarkup("just prose"), false);
    assert.equal(hasRichMarkup("- a bullet"), true);
    assert.equal(hasRichMarkup("**bold**"), true);
    assert.equal(hasRichMarkup("see https://x.dev"), true);
  });
});

describe("inline emphasis", () => {
  test("bold wins over italic so ** is never an empty * pair", () => {
    assert.equal(
      shape(parseInline("Blocked on **vendor SLA**.")),
      "Blocked on strong(vendor SLA).",
    );
  });

  test("italic via * or _", () => {
    assert.equal(shape(parseInline("*soon*")), "em(soon)");
    assert.equal(shape(parseInline("_soon_")), "em(soon)");
  });

  test("emphasis nests", () => {
    assert.equal(
      shape(parseInline("**very _bad_ news**")),
      "strong(very em(bad) news)",
    );
  });

  test("unmatched or empty markers stay literal", () => {
    assert.equal(shape(parseInline("**unclosed")), "**unclosed");
    assert.equal(shape(parseInline("a ** b")), "a ** b");
    assert.equal(shape(parseInline("****")), "****");
    assert.equal(shape(parseInline("50% * 2")), "50% * 2");
  });

  test("backslash escapes a marker into a literal", () => {
    assert.equal(shape(parseInline("\\*not italic\\*")), "*not italic*");
    assert.equal(shape(parseInline("2 \\* 3 \\* 4")), "2 * 3 * 4");
    // Each marker character needs its own backslash, as in CommonMark: the
    // toolbar never emits a half-escaped pair, and "\\**x\\**" would leave the
    // second asterisk of each pair free to open emphasis.
    assert.equal(
      shape(parseInline("\\*\\*not bold\\*\\*")),
      "**not bold**",
    );
  });
});

describe("links", () => {
  test("labeled markdown link", () => {
    assert.equal(
      shape(parseInline("see [the doc](https://docs.google.com/d/1a2b)")),
      "see link(the doc -> https://docs.google.com/d/1a2b)",
    );
  });

  test("bare URL becomes its own link", () => {
    assert.equal(
      shape(parseInline("see https://docs.google.com/d/1a2b now")),
      "see link(https://docs.google.com/d/1a2b -> https://docs.google.com/d/1a2b) now",
    );
  });

  test("trailing sentence punctuation is left out of the href", () => {
    assert.equal(
      shape(parseInline("at https://hpb.dev/x.")),
      "at link(https://hpb.dev/x -> https://hpb.dev/x).",
    );
    assert.equal(
      shape(parseInline("(see https://hpb.dev/x)")),
      "(see link(https://hpb.dev/x -> https://hpb.dev/x))",
    );
  });

  test("balanced parens inside a URL are kept", () => {
    const url = "https://en.wikipedia.org/wiki/EOS_(company)";
    assert.equal(shape(parseInline(url)), `link(${url} -> ${url})`);
  });

  test("a bold label inside a link is preserved", () => {
    assert.equal(
      shape(parseInline("[**the** doc](https://hpb.dev)")),
      "link(strong(the) doc -> https://hpb.dev)",
    );
  });

  test("mailto links are allowed", () => {
    assert.equal(
      shape(parseInline("[Joe](mailto:joe@hpb.dev)")),
      "link(Joe -> mailto:joe@hpb.dev)",
    );
  });
});

describe("safeHref rejects everything but http(s) and mailto", () => {
  const unsafe = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "//evil.example.com",
    "/relative/path",
    "about:blank",
    // Smuggling attempts: a NUL or tab inside the scheme.
    "java\u0000script:alert(1)",
    "java\tscript:alert(1)",
    "\u0000javascript:alert(1)",
    "",
    "   ",
  ];
  for (const raw of unsafe) {
    test(`rejects ${JSON.stringify(raw)}`, () => {
      assert.equal(safeHref(raw), null);
    });
  }

  test("accepts http, https and mailto", () => {
    assert.equal(safeHref("https://hpb.dev"), "https://hpb.dev");
    assert.equal(safeHref("http://hpb.dev"), "http://hpb.dev");
    assert.equal(safeHref(" https://hpb.dev "), "https://hpb.dev");
    assert.equal(safeHref("mailto:joe@hpb.dev"), "mailto:joe@hpb.dev");
  });

  test("an unsafe link target renders as literal text, not a link", () => {
    // The whole point: authors can't smuggle a scheme through the editor.
    const nodes = parseInline("[click me](javascript:alert(1))");
    assert.equal(shape(nodes), "[click me](javascript:alert(1))");
    assert.equal(
      nodes.every((n) => n.kind === "text"),
      true,
    );
  });

  test("angle brackets and quotes in a target disqualify it", () => {
    assert.equal(safeHref('https://hpb.dev" onmouseover="x'), null);
    assert.equal(safeHref("https://hpb.dev<script>"), null);
  });
});

describe("lists", () => {
  test("a run of dash lines becomes one bullet list", () => {
    assert.equal(
      blockShape(parseRichText("- core cutover slipped\n- vendor resourcing")),
      "ul[core cutover slipped|vendor resourcing]",
    );
  });

  test("* and + also open bullets", () => {
    assert.equal(blockShape(parseRichText("* a\n* b")), "ul[a|b]");
    assert.equal(blockShape(parseRichText("+ a\n+ b")), "ul[a|b]");
  });

  test("numbered lists keep their starting number", () => {
    assert.equal(
      blockShape(parseRichText("1. first\n2. second")),
      "ol@1[first|second]",
    );
    assert.equal(
      blockShape(parseRichText("3) third\n4) fourth")),
      "ol@3[third|fourth]",
    );
  });

  test("paragraph then list then paragraph", () => {
    assert.equal(
      blockShape(
        parseRichText("Blockers:\n- vendor\n- staffing\nShipping Friday."),
      ),
      "p[Blockers:] ul[vendor|staffing] p[Shipping Friday.]",
    );
  });

  test("bullets carry inline markup", () => {
    assert.equal(
      blockShape(parseRichText("- **core** cutover\n- [doc](https://hpb.dev)")),
      "ul[strong(core) cutover|link(doc -> https://hpb.dev)]",
    );
  });

  test("an indented continuation line folds into the item above", () => {
    assert.equal(
      blockShape(parseRichText("- core cutover\n    slipped again\n- staffing")),
      "ul[core cutover slipped again|staffing]",
    );
  });

  test("switching marker kind starts a new list", () => {
    assert.equal(blockShape(parseRichText("- a\n1. b")), "ul[a] ol@1[b]");
  });

  test("a dash with no space is prose, not a bullet", () => {
    assert.equal(blockShape(parseRichText("-5 degrees")), "p[-5 degrees]");
  });
});

describe("richTextToPlain for Google Tasks / BigQuery / tooltips", () => {
  test("plain text round-trips unchanged", () => {
    assert.equal(
      richTextToPlain("Two RMs out;\ndoc intake manual."),
      "Two RMs out;\ndoc intake manual.",
    );
  });

  test("markers are stripped and bullets become glyphs", () => {
    assert.equal(
      richTextToPlain("Blocked on **vendor SLA**.\n- core slipped\n- staffing"),
      "Blocked on vendor SLA.\n\n• core slipped\n• staffing",
    );
  });

  test("numbered items keep their numbers", () => {
    assert.equal(richTextToPlain("2. second\n3. third"), "2. second\n3. third");
  });

  test("a labeled link keeps both label and URL", () => {
    assert.equal(
      richTextToPlain("see [the doc](https://hpb.dev/d)"),
      "see the doc (https://hpb.dev/d)",
    );
  });

  test("a bare link is not duplicated", () => {
    assert.equal(
      richTextToPlain("see https://hpb.dev/d"),
      "see https://hpb.dev/d",
    );
  });

  test("empty input is an empty string", () => {
    assert.equal(richTextToPlain(null), "");
  });
});
