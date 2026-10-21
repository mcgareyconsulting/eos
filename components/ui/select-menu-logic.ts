// Pure logic behind `select-menu.tsx`: which row is active after a key, what
// a keypress means, type-ahead matching, and the combobox's filter / "create"
// rows. Kept free of React and the DOM so it runs under `node:test` — the repo
// has no component test library, so this file is where the behaviour is
// pinned down.

/** Anything the active-row cursor can land on. */
export type Navigable = { disabled?: boolean };

/** Same shape as `SelectOption` minus the React-only adornments. */
export type LabelledOption = Navigable & { value: string; label: string };

export type NavMove = "next" | "prev" | "first" | "last" | "pageNext" | "pagePrev";

/** Rows moved by PageUp / PageDown — the APG listbox default. */
export const PAGE_SIZE = 10;

/** Pause after which type-ahead starts a fresh search string. */
export const TYPEAHEAD_TIMEOUT_MS = 500;

/** First enabled index, or -1 when every row is disabled (or there are none). */
export function firstEnabled(items: readonly Navigable[]): number {
  return items.findIndex((i) => !i.disabled);
}

/** Last enabled index, or -1. */
export function lastEnabled(items: readonly Navigable[]): number {
  for (let i = items.length - 1; i >= 0; i--) if (!items[i].disabled) return i;
  return -1;
}

function nearestEnabled(items: readonly Navigable[], from: number, dir: 1 | -1): number {
  for (let i = from; i >= 0 && i < items.length; i += dir) if (!items[i].disabled) return i;
  return -1;
}

/**
 * Where the active row goes after a navigation key. Disabled rows are
 * skipped; the ends don't wrap (a native select doesn't either), so Down on
 * the last enabled row stays put. From "nothing active" (-1), next/pageNext
 * land on the first enabled row and prev/pagePrev on the last.
 */
export function moveActive(items: readonly Navigable[], current: number, move: NavMove): number {
  const valid = current >= 0 && current < items.length;
  switch (move) {
    case "first":
      return firstEnabled(items);
    case "last":
      return lastEnabled(items);
    case "next": {
      if (!valid) return firstEnabled(items);
      const n = nearestEnabled(items, current + 1, 1);
      return n === -1 ? current : n;
    }
    case "prev": {
      if (!valid) return lastEnabled(items);
      const n = nearestEnabled(items, current - 1, -1);
      return n === -1 ? current : n;
    }
    case "pageNext": {
      if (!valid) return firstEnabled(items);
      const target = Math.min(current + PAGE_SIZE, items.length - 1);
      const n = nearestEnabled(items, target, 1);
      if (n !== -1) return n;
      const back = nearestEnabled(items, target, -1);
      return back > current ? back : current;
    }
    case "pagePrev": {
      if (!valid) return lastEnabled(items);
      const target = Math.max(current - PAGE_SIZE, 0);
      const n = nearestEnabled(items, target, -1);
      if (n !== -1) return n;
      const fwd = nearestEnabled(items, target, 1);
      return fwd !== -1 && fwd < current ? fwd : current;
    }
  }
}

/** Active row when the list opens: the selected one if it can take focus,
 *  otherwise the first (or last) enabled row. */
export function initialActive(
  items: readonly Navigable[],
  selectedIndex: number,
  focus: "selected" | "first" | "last",
): number {
  if (focus === "first") return firstEnabled(items);
  if (focus === "last") return lastEnabled(items);
  if (selectedIndex >= 0 && selectedIndex < items.length && !items[selectedIndex].disabled) {
    return selectedIndex;
  }
  return firstEnabled(items);
}

// ─── Keyboard ───────────────────────────────────────────────────────────────

export type KeyLike = {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export type SelectKeyAction =
  /** Open the list with this row active. */
  | { type: "open"; focus: "selected" | "first" | "last" }
  | { type: "move"; move: NavMove }
  /** Choose the active row and close. */
  | { type: "commit" }
  /** Close without choosing; the key must not reach a parent dialog. */
  | { type: "close" }
  /** Tab: close without choosing and let focus move on as usual. */
  | { type: "tabClose" }
  | { type: "typeahead"; char: string };

/** A key that types a character, rather than a shortcut or a named key.
 *  Alt is excluded too: on macOS Option+letter types a symbol nobody meant
 *  as a search. */
export function printableChar(e: KeyLike): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  return e.key.length === 1 ? e.key : null;
}

/**
 * What a keydown on a select-only combobox trigger means (WAI-ARIA APG
 * "select-only combobox"). `typing` is true while a type-ahead string is
 * still live — Space then extends the search ("New York") instead of
 * choosing. Returns null for keys the trigger leaves alone (Escape on a
 * closed menu must still reach the dialog around it).
 */
export function selectKeyAction(e: KeyLike, open: boolean, typing: boolean): SelectKeyAction | null {
  const char = printableChar(e);
  if (!open) {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Enter":
        return { type: "open", focus: "selected" };
      case "Home":
        return { type: "open", focus: "first" };
      case "End":
        return { type: "open", focus: "last" };
    }
    if (e.key === " " && !typing) return { type: "open", focus: "selected" };
    return char ? { type: "typeahead", char } : null;
  }
  switch (e.key) {
    case "ArrowDown":
      return { type: "move", move: "next" };
    case "ArrowUp":
      return e.altKey ? { type: "commit" } : { type: "move", move: "prev" };
    case "Home":
      return { type: "move", move: "first" };
    case "End":
      return { type: "move", move: "last" };
    case "PageDown":
      return { type: "move", move: "pageNext" };
    case "PageUp":
      return { type: "move", move: "pagePrev" };
    case "Enter":
      return { type: "commit" };
    case "Escape":
      return { type: "close" };
    case "Tab":
      return { type: "tabClose" };
  }
  if (e.key === " " && !typing) return { type: "commit" };
  return char ? { type: "typeahead", char } : null;
}

export type ComboboxKeyAction =
  | { type: "open"; focus: "selected" | "last" }
  | { type: "move"; move: NavMove }
  | { type: "commit" }
  | { type: "close" }
  | { type: "tabClose" };

/**
 * Keydown on an editable combobox's text input. Home/End/printable keys are
 * the text field's own (caret, typing), so they are never claimed here.
 * Enter is claimed only when a row is active — otherwise it keeps its normal
 * meaning, submitting the form.
 */
export function comboboxKeyAction(e: KeyLike, open: boolean, hasActive: boolean): ComboboxKeyAction | null {
  switch (e.key) {
    case "ArrowDown":
      if (!open) return { type: "open", focus: "selected" };
      return e.altKey ? null : { type: "move", move: "next" };
    case "ArrowUp":
      if (!open) return e.altKey ? null : { type: "open", focus: "last" };
      return e.altKey ? { type: "close" } : { type: "move", move: "prev" };
    case "PageDown":
      return open ? { type: "move", move: "pageNext" } : null;
    case "PageUp":
      return open ? { type: "move", move: "pagePrev" } : null;
    case "Enter":
      return open && hasActive ? { type: "commit" } : null;
    case "Escape":
      return open ? { type: "close" } : null;
    case "Tab":
      return open ? { type: "tabClose" } : null;
  }
  return null;
}

// ─── Type-ahead ─────────────────────────────────────────────────────────────

export type TypeaheadState = { buffer: string; at: number };

export const EMPTY_TYPEAHEAD: TypeaheadState = { buffer: "", at: 0 };

/** Whether a type-ahead string is still being typed at `now`. */
export function typeaheadLive(state: TypeaheadState, now: number): boolean {
  return state.buffer !== "" && now - state.at < TYPEAHEAD_TIMEOUT_MS;
}

/** Append a typed character, starting over after a pause. */
export function nextTypeahead(state: TypeaheadState, char: string, now: number): TypeaheadState {
  const buffer = typeaheadLive(state, now) ? state.buffer + char : char;
  return { buffer, at: now };
}

function fold(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * The row a type-ahead string lands on, or -1. Matches label prefixes,
 * case-insensitively, skipping disabled rows and wrapping past the end.
 *
 * - A longer string searches from the current row *inclusive*, so typing
 *   "ca" then "n" stays on "Canada" rather than jumping past it.
 * - A string of one repeated character ("b", "bb", "bbb") cycles through the
 *   rows starting with it, from the row after the current one — the native
 *   select habit of pressing a letter again to reach the next match.
 */
export function typeaheadMatch(
  items: readonly (Navigable & { label: string })[],
  buffer: string,
  current: number,
): number {
  const q = buffer.toLowerCase();
  if (!q || items.length === 0) return -1;
  const repeated = [...q].every((c) => c === q[0]);
  const needle = repeated ? q[0] : q;
  const start = repeated ? current + 1 : Math.max(current, 0);
  const n = items.length;
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n;
    const item = items[i];
    if (!item.disabled && item.label.trimStart().toLowerCase().startsWith(needle)) return i;
  }
  return -1;
}

// ─── Combobox ───────────────────────────────────────────────────────────────

/** Accept bare strings (a list of group names) as well as full options. */
export function toOptions<T extends LabelledOption>(options: readonly (string | T)[]): (T | LabelledOption)[] {
  return options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

/** Options whose label contains the query, case-insensitively, in their
 *  original order. An empty query keeps everything. */
export function filterOptions<T extends LabelledOption>(options: readonly T[], query: string): T[] {
  const q = fold(query);
  if (!q) return [...options];
  return options.filter((o) => o.label.toLowerCase().includes(q));
}

/** The option the text names exactly (ignoring case and outer spaces), by
 *  label or by value. */
export function findExact<T extends LabelledOption>(options: readonly T[], text: string): T | undefined {
  const q = fold(text);
  if (!q) return undefined;
  return options.find((o) => fold(o.label) === q || fold(o.value) === q);
}

export type ComboboxRow<T extends LabelledOption> =
  | { kind: "option"; option: T; disabled?: boolean }
  | { kind: "create"; value: string; disabled?: undefined };

/**
 * The rows a combobox shows for `query`: matching options, then — when
 * `allowCreate` and the text isn't already an option — one "create" row
 * carrying the trimmed text.
 */
export function comboboxRows<T extends LabelledOption>(
  options: readonly T[],
  query: string,
  { allowCreate }: { allowCreate: boolean },
): ComboboxRow<T>[] {
  const rows: ComboboxRow<T>[] = filterOptions(options, query).map((option) => ({
    kind: "option",
    option,
    disabled: option.disabled,
  }));
  const text = query.trim();
  if (allowCreate && text && !findExact(options, text)) rows.push({ kind: "create", value: text });
  return rows;
}

/**
 * What a combobox's free text settles to when the field is left: an existing
 * option's own value when the text names one (so "weekly " files under the
 * existing "Weekly" rather than starting a near-duplicate group), otherwise
 * the text trimmed.
 */
export function resolveComboboxText<T extends LabelledOption>(options: readonly T[], text: string): string {
  const hit = findExact(options, text);
  return hit && !hit.disabled ? hit.value : text.trim();
}
