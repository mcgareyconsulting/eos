// Constrained markdown subset for description/body fields (P3-2). The client
// asked for three things — bold, bullets, hyperlinks — so that is exactly what
// this grammar accepts; anything else stays literal text.
//
// Why a parser instead of an HTML editor: descriptions keep living in the same
// plain-string Firestore field they always have, so there is no migration, no
// second format to read, and nothing downstream (BigQuery batch, Google Tasks
// notes, CSV export) has to learn HTML. The renderer builds React elements
// from this AST — never `dangerouslySetInnerHTML` — which is the property the
// 2026-08-04 audit relied on when it cleared the comment linkifier.
//
// Backward compatibility rule: text with no markers must parse to exactly the
// paragraphs it already was. Single newlines are therefore *kept inside*
// paragraph text (callers render with `whitespace-pre-wrap`, as they already
// did) rather than becoming break nodes.

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: InlineNode[] }
  | { kind: "em"; children: InlineNode[] }
  | { kind: "link"; href: string; children: InlineNode[] };

export type ListItem = { children: InlineNode[] };

export type BlockNode =
  | { kind: "paragraph"; children: InlineNode[] }
  | { kind: "bullet-list"; items: ListItem[] }
  | { kind: "ordered-list"; start: number; items: ListItem[] };

/** Marker characters a backslash can escape into a literal. */
const ESCAPABLE = new Set(["*", "_", "[", "]", "(", ")", "\\", "-"]);

// Only http(s) and mailto ever become an href. Everything else — including
// `javascript:`, `data:`, and protocol-relative `//host` — renders as the
// literal text the author typed. React would also block a javascript: href,
// but the allowlist is the guarantee we want to be able to point at.
const SAFE_SCHEME = /^(?:https?:\/\/|mailto:)/i;

/**
 * Returns the URL if it is safe to put in an `href`, else null. Callers must
 * treat null as "render the author's text literally, do not link it".
 */
export function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (!url || /[\s<>"']/.test(url)) return null;
  // Control chars, including the NUL/tab tricks used to smuggle a
  // "java\0script:" scheme past a naive prefix check.
  if (/[\x00-\x1f\x7f]/.test(url)) return null;
  return SAFE_SCHEME.test(url) ? url : null;
}

// Bare-URL run: stop at whitespace/angle bracket, then give back trailing
// punctuation that is almost always sentence punctuation rather than URL.
const BARE_URL = /^https?:\/\/[^\s<>()]+(?:\([^\s<>()]*\))?[^\s<>()]*/i;

function trimUrlTail(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (ch === ")") {
      // Keep a closing paren only if the URL opened one (wiki-style links).
      const opens = (url.slice(0, end).match(/\(/g) ?? []).length;
      const closes = (url.slice(0, end).match(/\)/g) ?? []).length;
      if (opens >= closes) break;
      end -= 1;
      continue;
    }
    if (".,;:!?\"'’]}>".includes(ch)) {
      end -= 1;
      continue;
    }
    break;
  }
  return url.slice(0, end);
}

/** True when `_` at `i` is inside a word (snake_case_name must not italicize). */
function isIntraWordUnderscore(src: string, i: number): boolean {
  const before = src[i - 1];
  return before !== undefined && /[A-Za-z0-9]/.test(before);
}

/**
 * Finds the closing run for an emphasis marker opened at `from`, or -1.
 * A marker never closes on whitespace-adjacent or empty content, so
 * "2 * 3 * 4" and a lone "**" stay literal.
 */
function findCloser(src: string, marker: string, from: number): number {
  let i = from;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src.startsWith(marker, i)) {
      if (i === from) return -1; // empty content
      if (/\s/.test(src[i - 1])) {
        i += marker.length;
        continue; // "* 3 *" — closer can't follow a space
      }
      if (marker === "_" && /[A-Za-z0-9]/.test(src[i + 1] ?? "")) {
        i += marker.length;
        continue; // mid-word underscore
      }
      return i;
    }
    i += 1;
  }
  return -1;
}

function parseLinkAt(
  src: string,
  i: number,
): { node: InlineNode; next: number } | null {
  // [label](url) — label may not contain a nested bracket, url no spaces.
  let depth = 0;
  let close = -1;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === "\\") {
      j += 1;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        close = j;
        break;
      }
    } else if (ch === "\n" && src[j + 1] === "\n") break; // never span blocks
  }
  if (close < 0 || src[close + 1] !== "(") return null;
  const end = src.indexOf(")", close + 2);
  if (end < 0) return null;

  const label = src.slice(i + 1, close);
  const href = safeHref(src.slice(close + 2, end));
  if (!href) return null; // unsafe or malformed → caller keeps it literal
  const children = parseInline(label);
  return {
    node: {
      kind: "link",
      href,
      children: children.length > 0 ? children : [{ kind: "text", text: href }],
    },
    next: end + 1,
  };
}

/**
 * Parses one block's text into inline nodes. Unmatched or unsafe markers are
 * emitted as the literal characters the author typed.
 */
export function parseInline(src: string): InlineNode[] {
  const out: InlineNode[] = [];
  let buf = "";
  let i = 0;

  const flush = () => {
    if (buf) {
      out.push({ kind: "text", text: buf });
      buf = "";
    }
  };

  while (i < src.length) {
    const ch = src[i];

    if (ch === "\\" && ESCAPABLE.has(src[i + 1] ?? "")) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    // Bold before italic, so ** never reads as an empty * pair.
    if (src.startsWith("**", i)) {
      const close = findCloser(src, "**", i + 2);
      if (close > 0) {
        flush();
        out.push({ kind: "strong", children: parseInline(src.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    if ((ch === "*" || ch === "_") && !(ch === "_" && isIntraWordUnderscore(src, i))) {
      const close = findCloser(src, ch, i + 1);
      if (close > 0) {
        flush();
        out.push({ kind: "em", children: parseInline(src.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    if (ch === "[") {
      const link = parseLinkAt(src, i);
      if (link) {
        flush();
        out.push(link.node);
        i = link.next;
        continue;
      }
    }

    if ((ch === "h" || ch === "H") && BARE_URL.test(src.slice(i))) {
      const raw = trimUrlTail(BARE_URL.exec(src.slice(i))![0]);
      const href = safeHref(raw);
      if (href) {
        flush();
        out.push({ kind: "link", href, children: [{ kind: "text", text: raw }] });
        i += raw.length;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }

  flush();
  return out;
}

const BULLET_LINE = /^ {0,3}[-*+][ \t]+(.*)$/;
const ORDERED_LINE = /^ {0,3}(\d{1,9})[.)][ \t]+(.*)$/;

/**
 * Splits a description into blocks: bullet lists, ordered lists, and
 * paragraphs. Blank lines separate paragraphs; single newlines stay inside
 * one paragraph (rendered by `whitespace-pre-wrap`) so pre-existing plain
 * text keeps the exact shape it has today.
 */
export function parseRichText(raw: string | null | undefined): BlockNode[] {
  const text = String(raw ?? "").replace(/\r\n?/g, "\n");
  if (!text.trim()) return [];

  const lines = text.split("\n");
  const blocks: BlockNode[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    const joined = para.join("\n").trim();
    if (joined) blocks.push({ kind: "paragraph", children: parseInline(joined) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.trim()) {
      flushPara();
      continue;
    }

    const bullet = BULLET_LINE.exec(line);
    const ordered = bullet ? null : ORDERED_LINE.exec(line);
    if (!bullet && !ordered) {
      para.push(line);
      continue;
    }

    flushPara();
    const items: ListItem[] = [];
    let start = 1;

    // Consume the run of like-kind item lines. A continuation line (indented,
    // not itself an item) folds into the item above it.
    for (; i < lines.length; i++) {
      const cur = lines[i];
      if (!cur.trim()) break;
      const b = BULLET_LINE.exec(cur);
      const o = b ? null : ORDERED_LINE.exec(cur);
      const isSameKind = bullet ? !!b : !!o;

      if (isSameKind) {
        if (bullet) {
          items.push({ children: parseInline(b![1].trim()) });
        } else {
          if (items.length === 0) start = Number(o![1]);
          items.push({ children: parseInline(o![2].trim()) });
        }
        continue;
      }
      if (!b && !o && /^\s+\S/.test(cur) && items.length > 0) {
        const prev = items[items.length - 1];
        prev.children = [
          ...prev.children,
          { kind: "text", text: " " },
          ...parseInline(cur.trim()),
        ];
        continue;
      }
      break;
    }
    i -= 1; // outer loop re-reads the line that ended the list

    blocks.push(
      bullet
        ? { kind: "bullet-list", items }
        : { kind: "ordered-list", start, items },
    );
  }

  flushPara();
  return blocks;
}

function inlineToPlain(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      if (n.kind === "text") return n.text;
      if (n.kind === "link") {
        const label = inlineToPlain(n.children);
        return label === n.href ? n.href : `${label} (${n.href})`;
      }
      return inlineToPlain(n.children);
    })
    .join("");
}

/**
 * Flattens markup to readable plain text for surfaces that can't render it:
 * Google Tasks notes, BigQuery/CSV columns, `title` tooltips, list previews.
 * Marker-free input comes back unchanged apart from trimming.
 */
export function richTextToPlain(raw: string | null | undefined): string {
  return parseRichText(raw)
    .map((block) => {
      if (block.kind === "paragraph") return inlineToPlain(block.children);
      return block.items
        .map((item, idx) => {
          const bullet =
            block.kind === "bullet-list" ? "• " : `${block.start + idx}. `;
          return bullet + inlineToPlain(item.children);
        })
        .join("\n");
    })
    .join("\n\n");
}

/** True when the text carries markup a plain `<p>` would render wrong. */
export function hasRichMarkup(raw: string | null | undefined): boolean {
  const blocks = parseRichText(raw);
  return blocks.some(
    (b) =>
      b.kind !== "paragraph" ||
      b.children.some((c) => c.kind !== "text"),
  );
}
