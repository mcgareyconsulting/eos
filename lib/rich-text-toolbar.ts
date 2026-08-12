// Pure text transforms behind the description editor toolbar
// (components/rich-text-editor.tsx). They live here, apart from the React
// component, because the caret arithmetic is the fiddly part and is worth
// unit-testing directly; the editor only supplies the current value and
// selection and applies what comes back.
//
// Every transform emits markers that lib/rich-text.ts can parse back.

export type Selection = { start: number; end: number };


/** Wraps the selection in `marker`, or unwraps it when already wrapped. */
export function toggleWrap(
  text: string,
  sel: Selection,
  marker: string,
  placeholder: string,
): { text: string; sel: Selection } {
  const { start, end } = sel;
  const selected = text.slice(start, end);
  const m = marker.length;

  if (selected && text.slice(start - m, start) === marker && text.slice(end, end + m) === marker) {
    return {
      text: text.slice(0, start - m) + selected + text.slice(end + m),
      sel: { start: start - m, end: end - m },
    };
  }
  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length > m * 2) {
    const inner = selected.slice(m, -m);
    return {
      text: text.slice(0, start) + inner + text.slice(end),
      sel: { start, end: start + inner.length },
    };
  }

  const body = selected || placeholder;
  return {
    text: text.slice(0, start) + marker + body + marker + text.slice(end),
    sel: selected
      ? { start: start + m, end: end + m }
      : { start: start + m, end: start + m + body.length },
  };
}

/** Prefixes every line the selection touches with a bullet/number marker. */
export function toggleLinePrefix(
  text: string,
  sel: Selection,
  kind: "bullet" | "ordered",
): { text: string; sel: Selection } {
  const lineStart = text.lastIndexOf("\n", Math.max(0, sel.start - 1)) + 1;
  const lineEndIdx = text.indexOf("\n", sel.end);
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;

  const block = text.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const marked = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/;

  // Judge "already a list" from the content lines only. Deciding it over the
  // blank ones too made a blank line vacuously "marked", so clicking Bullets
  // on an empty line took the strip branch and did nothing — which is exactly
  // the moment a user reaches for it (click, then type the first item).
  const content = lines.filter((l) => l.trim());
  const allMarked = content.length > 0 && content.every((l) => marked.test(l));
  const blankOnly = content.length === 0;

  const next = lines
    .map((line, i) => {
      if (!line.trim() && !blankOnly) return line;
      if (allMarked) return line.replace(marked, "");
      const prefix = kind === "bullet" ? "- " : `${i + 1}. `;
      return prefix + line.replace(marked, "");
    })
    .join("\n");

  return {
    text: text.slice(0, lineStart) + next + text.slice(lineEnd),
    // Opening a list on an empty line leaves the caret after the marker, ready
    // to type; otherwise keep the reformatted block selected.
    sel: blankOnly
      ? { start: lineStart + next.length, end: lineStart + next.length }
      : { start: lineStart, end: lineStart + next.length },
  };
}

/**
 * Wraps the selection as a markdown link. A selection that is itself a URL
 * becomes the target; otherwise it becomes the label and the caret lands on
 * the empty target so the author can paste.
 */
export function insertLink(text: string, sel: Selection): { text: string; sel: Selection } {
  const selected = text.slice(sel.start, sel.end).trim();
  const isUrl = /^(?:https?:\/\/|mailto:)\S+$/i.test(selected);
  const label = isUrl ? "link text" : selected || "link text";
  const target = isUrl ? selected : "https://";
  const snippet = `[${label}](${target})`;

  // Select the part the author most likely wants to replace next.
  const labelStart = sel.start + 1;
  const targetStart = sel.start + label.length + 3;
  return {
    text: text.slice(0, sel.start) + snippet + text.slice(sel.end),
    sel: isUrl
      ? { start: labelStart, end: labelStart + label.length }
      : { start: targetStart, end: targetStart + target.length },
  };
}
