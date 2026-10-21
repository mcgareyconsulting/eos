"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EMPTY_TYPEAHEAD,
  comboboxKeyAction,
  comboboxRows,
  findExact,
  initialActive,
  moveActive,
  nextTypeahead,
  resolveComboboxText,
  selectKeyAction,
  toOptions,
  typeaheadLive,
  typeaheadMatch,
  type ComboboxRow,
} from "@/components/ui/select-menu-logic";

// Custom replacements for the native <select> (`Select` in ./input.tsx) and
// the `<Input list>` + <datalist> pair, whose menus are the browser's own.
//
//   SelectMenu  — pick one of a fixed list. Trigger button + listbox, in a
//                 "field" look (drop-in for `Select`) or a "pill" look (the
//                 scorecard filter chips).
//   Combobox    — a text field that suggests existing values and accepts a
//                 new one (the scorecard Group field).
//
// Both menus are portalled to document.body at a fixed position, above the
// modal layer (z-50), so a trigger inside a dialog's scrolling body is never
// clipped. Escape on an open menu closes the menu only: the key is handled on
// the focused control and stopped there, so the window listener every
// ModalShell uses (useDismissOnEscape) never sees it. Escape on a *closed*
// menu is left alone and closes the dialog as usual.
//
// Focus never leaves the trigger / input while the menu is open — the active
// row is announced through aria-activedescendant, and pointerdown on the menu
// is cancelled so clicking a row doesn't blur the field.
//
// The keyboard rules, type-ahead and combobox filtering live in
// ./select-menu-logic.ts, where they are unit-tested.

export type SelectOption<V extends string = string> = {
  value: V;
  label: string;
  /** Second, smaller line under the label (e.g. what a visibility means). */
  description?: ReactNode;
  /** Leading icon, ~14px (lucide `h-3.5 w-3.5`). */
  icon?: ReactNode;
  /** Background class for a small leading color dot, e.g. "bg-emerald-500"
   *  (headline category pills). */
  dotClassName?: string;
  disabled?: boolean;
};

export type SelectMenuSize = "sm" | "md";

type AriaLabelling = {
  /** Put it on a `<label htmlFor>` or wrap the control in a `<label>`; or
   *  pass aria-label / aria-labelledby. A combobox takes its name only from
   *  these, never from the value text it shows. */
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

// Same fills as `INPUT_SM` / `INPUT_MD` in ./input.tsx (32px), plus a 28px
// "sm" for dense rows. Heights are stated, never derived — see input.tsx.
const FIELD_SIZE: Record<SelectMenuSize, string> = {
  sm: "h-7 rounded-md text-xs",
  md: "h-8 rounded-md text-sm",
};
const FIELD_BASE =
  "w-full border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/30 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

// The `FilterSelect` chip in components/scorecard/scorecard-filters.tsx,
// verbatim, so swapping it in changes the menu and not the chip.
const PILL_SIZE: Record<SelectMenuSize, string> = {
  sm: "h-7 text-[11px]",
  md: "h-8 text-xs",
};
const PILL_BASE =
  "shrink-0 rounded-full border pl-2.5 pr-2 font-medium " +
  "border-zinc-300 bg-white text-zinc-800 hover:border-zinc-400 " +
  "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/30 dark:focus-visible:ring-hpb-gold/30 " +
  "disabled:cursor-not-allowed disabled:opacity-60";
const PILL_ACTIVE =
  "border-hpb-blue/40 bg-hpb-blue/5 text-hpb-blue dark:border-hpb-gold/40 dark:bg-hpb-gold/10 dark:text-hpb-gold";

const MENU_CLASS =
  "fixed left-0 top-0 z-[60] max-w-[min(24rem,calc(100vw-16px))] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900";
const LIST_CLASS = "max-h-64 overflow-y-auto py-1";

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) (ref as RefObject<T | null>).current = node;
}

/**
 * Places an open, portalled menu under its anchor (or above it when the
 * viewport runs out below), at least as wide as the anchor, kept on screen,
 * and follows it on scroll/resize. Writes the menu's style directly rather
 * than through state: no extra render per scroll event, and the menu stays
 * `visibility: hidden` until the first placement so it never flashes at 0,0.
 */
function useAnchoredMenu(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  layoutKey: unknown,
) {
  useLayoutEffect(() => {
    if (!open) return;
    const GAP = 4;
    const EDGE = 8;
    function place() {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const r = anchor.getBoundingClientRect();
      menu.style.minWidth = `${r.width}px`;
      const h = menu.offsetHeight;
      const w = menu.offsetWidth;
      const below = window.innerHeight - r.bottom - GAP - EDGE;
      const above = r.top - GAP - EDGE;
      const up = h > below && above > below;
      const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - w - EDGE));
      menu.style.transform = `translate(${left}px, ${up ? Math.max(EDGE, r.top - GAP - h) : r.bottom + GAP}px)`;
      menu.style.visibility = "visible";
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef, menuRef, layoutKey]);
}

/** Close on a pointerdown outside the anchor and the menu — pointerdown, not
 *  click, like the other popovers, so the menu is gone before a click lands
 *  on whatever sits under it. */
function useOutsidePointerDown(
  open: boolean,
  refs: RefObject<HTMLElement | null>[],
  onOutside: () => void,
) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (refs.some((r) => r.current?.contains(t))) return;
      onOutside();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, refs, onOutside]);
}

/** Keep the active row in view as the keyboard moves it. */
function useScrollActiveIntoView(open: boolean, activeId: string | undefined) {
  useEffect(() => {
    if (!open || !activeId) return;
    document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [open, activeId]);
}

function OptionAdornment({ option }: { option: SelectOption<string> }) {
  if (option.icon) {
    return (
      <span className="flex shrink-0 items-center" aria-hidden>
        {option.icon}
      </span>
    );
  }
  if (option.dotClassName) {
    return <span className={cn("h-2 w-2 shrink-0 rounded-full", option.dotClassName)} aria-hidden />;
  }
  return null;
}

function OptionBody({ option, selected }: { option: SelectOption<string>; selected: boolean }) {
  return (
    <>
      <OptionAdornment option={option} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", selected && "font-medium")}>{option.label}</span>
        {option.description && (
          <span className="mt-0.5 block whitespace-normal text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
            {option.description}
          </span>
        )}
      </span>
      <Check
        className={cn(
          "h-3.5 w-3.5 shrink-0 text-hpb-blue dark:text-hpb-gold",
          !selected && "invisible",
        )}
        aria-hidden
      />
    </>
  );
}

function optionRowClass(size: SelectMenuSize, active: boolean, disabled?: boolean) {
  return cn(
    "flex cursor-pointer select-none items-center gap-2 px-2.5 py-1.5 text-zinc-800 dark:text-zinc-200",
    size === "sm" ? "text-xs" : "text-sm",
    active && "bg-zinc-100 dark:bg-zinc-800",
    disabled && "cursor-not-allowed opacity-40",
  );
}

// ─── SelectMenu ─────────────────────────────────────────────────────────────

export type SelectMenuProps<V extends string = string> = AriaLabelling & {
  options: readonly SelectOption<V>[];
  /** Controlled value. Omit (with or without `defaultValue`) for uncontrolled. */
  value?: V;
  defaultValue?: V;
  /** Fires only when the value actually changes, like a native select. */
  onChange?: (value: V) => void;
  /** Submits the value with the form (a hidden input), for FormData / server
   *  actions. Not submitted while `disabled`, same as a native select. */
  name?: string;
  /** `form` attribute for the hidden input, when the control sits outside its form. */
  form?: string;
  /** Blocks form submission while empty, with the browser's own message. */
  required?: boolean;
  disabled?: boolean;
  /** Trigger text while no option matches `value`. */
  placeholder?: string;
  /** "field" (default) is the form-control look, a drop-in for `Select`;
   *  "pill" is the rounded filter chip. */
  variant?: "field" | "pill";
  /** "md" (default) is 32px, matching inputs and buttons; "sm" is 28px. */
  size?: SelectMenuSize;
  /** Pill only: the blue "this filter is applied" treatment. */
  active?: boolean;
  /** Classes for the trigger (width, min-width…). */
  className?: string;
  /** Classes for the floating menu (e.g. a fixed width like "w-72"). */
  menuClassName?: string;
  /** Custom trigger content for the current option (undefined = none chosen). */
  renderValue?: (option: SelectOption<V> | undefined) => ReactNode;
  title?: string;
  autoFocus?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The trigger button. */
  ref?: Ref<HTMLButtonElement>;
};

/**
 * Single-choice select with a custom listbox. Keyboard (APG select-only
 * combobox): ↓/↑/Enter/Space open; ↓/↑ move, Home/End jump, PageUp/PageDown
 * move by 10, Enter/Space choose, Escape closes (the menu only), Tab closes
 * and moves on; typing letters jumps to the matching option. Disabled options
 * are skipped by every key and can't be clicked.
 */
export function SelectMenu<V extends string = string>({
  options,
  value,
  defaultValue,
  onChange,
  name,
  form,
  required = false,
  disabled = false,
  placeholder = "Select…",
  variant = "field",
  size = "md",
  active: pillActive = false,
  className,
  menuClassName,
  renderValue,
  title,
  autoFocus,
  onOpenChange,
  ref,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: SelectMenuProps<V>) {
  const [uncontrolled, setUncontrolled] = useState<V | undefined>(defaultValue);
  const current = value !== undefined ? value : uncontrolled;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const typeahead = useRef(EMPTY_TYPEAHEAD);
  // Set when Enter/Space was handled on keydown, so the click the browser
  // may still synthesise from the same key doesn't toggle the menu straight
  // back. Cleared on keyup (after that click would have fired) and on any
  // pointerdown.
  const swallowClick = useRef(false);

  const reactId = useId();
  const listId = `${reactId}-listbox`;
  const optionId = (i: number) => `${reactId}-option-${i}`;

  const selectedIndex = options.findIndex((o) => o.value === current);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  // Options can change under an open menu; never point past the end.
  const active = activeIndex < options.length ? activeIndex : -1;
  const activeId = open && active >= 0 ? optionId(active) : undefined;

  const setTriggerRef = useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      assignRef(ref, node);
    },
    [ref],
  );

  // Tab closes on keydown and again on the blur that follows; report once.
  const reportedOpen = useRef(false);
  const setMenuOpen = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (reportedOpen.current === next) return;
      reportedOpen.current = next;
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  function openMenu(focusIndex: number) {
    typeahead.current = EMPTY_TYPEAHEAD;
    setActiveIndex(focusIndex);
    setMenuOpen(true);
  }

  const close = useCallback(() => setMenuOpen(false), [setMenuOpen]);

  function commit(index: number) {
    const o = options[index];
    close();
    if (!o || o.disabled || o.value === current) return;
    if (value === undefined) setUncontrolled(o.value);
    onChange?.(o.value);
  }

  const outsideRefs = useMemo(() => [triggerRef, menuRef], []);
  useOutsidePointerDown(open, outsideRefs, close);
  useAnchoredMenu(open, triggerRef, menuRef, options.length);
  useScrollActiveIntoView(open, activeId);

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const now = Date.now();
    const action = selectKeyAction(e, open, typeaheadLive(typeahead.current, now));
    if (!action) return;
    if (e.key === "Enter" || e.key === " ") swallowClick.current = true;
    switch (action.type) {
      case "open":
        e.preventDefault();
        openMenu(initialActive(options, selectedIndex, action.focus));
        return;
      case "move":
        e.preventDefault();
        setActiveIndex(moveActive(options, active, action.move));
        return;
      case "commit":
        e.preventDefault();
        commit(active);
        return;
      case "close":
        // Stopped here so the dialog around us (window listener) stays open.
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      case "tabClose":
        close();
        return;
      case "typeahead": {
        e.preventDefault();
        const next = nextTypeahead(typeahead.current, action.char, now);
        const match = typeaheadMatch(options, next.buffer, open ? active : selectedIndex);
        if (open) {
          if (match >= 0) setActiveIndex(match);
        } else {
          openMenu(match >= 0 ? match : initialActive(options, selectedIndex, "selected"));
        }
        // After openMenu, which resets it.
        typeahead.current = next;
        return;
      }
    }
  }

  function onKeyUp() {
    if (swallowClick.current) {
      setTimeout(() => {
        swallowClick.current = false;
      }, 0);
    }
  }

  function onClick() {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    // Safari doesn't focus a button on click; the keys and the blur-to-close
    // both need focus on the trigger.
    triggerRef.current?.focus();
    if (open) close();
    else openMenu(initialActive(options, selectedIndex, "selected"));
  }

  const triggerContent = renderValue ? (
    renderValue(selected)
  ) : selected ? (
    <>
      <OptionAdornment option={selected} />
      <span className="min-w-0 truncate">{selected.label}</span>
    </>
  ) : (
    <span className="min-w-0 truncate text-zinc-400 dark:text-zinc-500">{placeholder}</span>
  );

  return (
    <>
      <button
        ref={setTriggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
        aria-invalid={ariaInvalid || undefined}
        disabled={disabled}
        title={title}
        autoFocus={autoFocus}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onPointerDown={() => {
          swallowClick.current = false;
        }}
        onBlur={() => {
          if (open) close();
        }}
        className={cn(
          "inline-flex items-center gap-1.5 text-left",
          variant === "pill"
            ? cn(PILL_BASE, PILL_SIZE[size], pillActive && PILL_ACTIVE)
            : cn(FIELD_BASE, FIELD_SIZE[size], "px-2 text-zinc-900 dark:text-zinc-100"),
          className,
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">{triggerContent}</span>
        <ChevronDown
          className={cn(
            "shrink-0 text-zinc-400 transition-transform",
            variant === "pill" ? "h-3 w-3" : "h-3.5 w-3.5",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      <FormValue
        name={name}
        form={form}
        value={current ?? ""}
        required={required}
        disabled={disabled}
        onFocusRedirect={() => triggerRef.current?.focus()}
      />

      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ visibility: "hidden" }}
            onPointerDown={(e) => e.preventDefault()}
            className={cn(MENU_CLASS, menuClassName)}
          >
            <ul
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              aria-labelledby={ariaLabelledBy}
              className={LIST_CLASS}
            >
              {options.length === 0 && (
                <li className="px-3 py-2 text-sm text-zinc-500">No options.</li>
              )}
              {options.map((o, i) => (
                <li
                  key={o.value}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === selectedIndex}
                  aria-disabled={o.disabled || undefined}
                  onPointerMove={() => {
                    if (!o.disabled && i !== active) setActiveIndex(i);
                  }}
                  onClick={() => {
                    if (!o.disabled) commit(i);
                  }}
                  className={optionRowClass(size, i === active, o.disabled)}
                >
                  <OptionBody option={o} selected={i === selectedIndex} />
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Carries the value into a surrounding <form>. A plain hidden input normally;
 * when `required`, a visually-hidden text input instead, because hidden inputs
 * are exempt from constraint validation. That one sits right after the
 * trigger (sr-only keeps its static position), so the browser's "Please
 * select…" bubble points at the control, and it hands focus to the trigger
 * when the browser focuses it on a failed submit.
 */
function FormValue({
  name,
  form,
  value,
  required,
  disabled,
  onFocusRedirect,
}: {
  name?: string;
  form?: string;
  value: string;
  required: boolean;
  disabled: boolean;
  onFocusRedirect: () => void;
}) {
  if (required) {
    return (
      <input
        name={name}
        form={form}
        value={value}
        required
        disabled={disabled}
        onChange={() => {}}
        onFocus={onFocusRedirect}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
      />
    );
  }
  if (!name) return null;
  return <input type="hidden" name={name} form={form} value={value} disabled={disabled} />;
}

// ─── Combobox ───────────────────────────────────────────────────────────────

export type ComboboxProps = AriaLabelling & {
  /** Suggestions. Bare strings are shorthand for `{ value: s, label: s }`. */
  options: readonly (string | SelectOption)[];
  /** The text in the field — controlled. Typing calls onChange per keystroke,
   *  exactly like an `<Input>`; picking a row sets it to that option's value. */
  value: string;
  onChange: (value: string) => void;
  /** On the text input itself, so FormData gets the typed text. */
  name?: string;
  form?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  /** Offer the typed text as a new value when it isn't an option. Default true. */
  allowCreate?: boolean;
  /** Copy for that row. Default: Add “text”. */
  createLabel?: (text: string) => ReactNode;
  /** Shown when nothing matches and creating is off. */
  emptyText?: string;
  size?: SelectMenuSize;
  /** Classes for the wrapper (width etc.). */
  className?: string;
  menuClassName?: string;
  /** The text input. */
  ref?: Ref<HTMLInputElement>;
};

/**
 * Text field with a suggestion list: pick an existing value or type a new
 * one. Replaces `<Input list>` + `<datalist>`.
 *
 * Opening by click / ↓ / the chevron shows every option; typing filters by
 * label and, unless `allowCreate` is off, adds an "Add “…”" row for text that
 * isn't an option yet. ↓/↑ move, Enter picks the active row (with no active
 * row Enter is left alone and submits the form), Escape closes the list only,
 * Tab closes. Leaving the field snaps text that names an existing option
 * (any case, stray spaces) to that option's value, and trims the rest.
 */
export function Combobox({
  options: rawOptions,
  value,
  onChange,
  name,
  form,
  placeholder,
  required,
  disabled = false,
  autoFocus,
  maxLength,
  allowCreate = true,
  createLabel = (text) => <>Add “{text}”</>,
  emptyText = "No matches.",
  size = "md",
  className,
  menuClassName,
  ref,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: ComboboxProps) {
  const options: SelectOption[] = useMemo(() => toOptions(rawOptions), [rawOptions]);
  const [open, setOpen] = useState(false);
  // Off while the list was opened to browse (show everything); on once the
  // user types, so the list narrows to what they're typing.
  const [filtering, setFiltering] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const reactId = useId();
  const listId = `${reactId}-listbox`;
  const rowId = (i: number) => `${reactId}-row-${i}`;

  const rows: ComboboxRow<SelectOption>[] = comboboxRows(options, filtering ? value : "", {
    allowCreate,
  });
  const typed = filtering && value.trim() !== "";
  const showMenu = open && (rows.length > 0 || typed);
  const active = activeIndex < rows.length ? activeIndex : -1;
  const activeId = showMenu && active >= 0 ? rowId(active) : undefined;
  const exact = findExact(options, value);

  const setInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      assignRef(ref, node);
    },
    [ref],
  );

  const close = useCallback(() => {
    setOpen(false);
    setFiltering(false);
  }, []);

  function browse(focus: "selected" | "last") {
    const all = comboboxRows(options, "", { allowCreate: false });
    const sel = exact ? all.findIndex((r) => r.kind === "option" && r.option === exact) : -1;
    setFiltering(false);
    // Down lands on the current value (or nothing yet, so the next Down picks
    // the first row); Up starts from the bottom.
    setActiveIndex(focus === "last" ? initialActive(all, -1, "last") : sel);
    setOpen(true);
  }

  function pick(row: ComboboxRow<SelectOption> | undefined) {
    if (!row || row.disabled) return;
    const next = row.kind === "option" ? row.option.value : row.value;
    if (next !== value) onChange(next);
    close();
  }

  const outsideRefs = useMemo(() => [wrapRef, menuRef], []);
  useOutsidePointerDown(showMenu, outsideRefs, close);
  useAnchoredMenu(showMenu, wrapRef, menuRef, rows.length);
  useScrollActiveIntoView(showMenu, activeId);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const action = comboboxKeyAction(e, showMenu, active >= 0);
    if (!action) return;
    switch (action.type) {
      case "open":
        e.preventDefault();
        browse(action.focus);
        return;
      case "move":
        e.preventDefault();
        setActiveIndex(moveActive(rows, active, action.move));
        return;
      case "commit":
        e.preventDefault();
        pick(rows[active]);
        return;
      case "close":
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      case "tabClose":
        close();
        return;
    }
  }

  return (
    <div ref={wrapRef} className={cn("relative w-full", className)}>
      <input
        ref={setInputRef}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={showMenu}
        aria-controls={showMenu ? listId : undefined}
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || undefined}
        autoComplete="off"
        name={name}
        form={form}
        value={value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        maxLength={maxLength}
        onChange={(e) => {
          onChange(e.target.value);
          setFiltering(true);
          setActiveIndex(-1);
          setOpen(true);
        }}
        onClick={() => {
          if (!open) browse("selected");
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          close();
          const settled = resolveComboboxText(options, value);
          if (settled !== value) onChange(settled);
        }}
        className={cn(
          FIELD_BASE,
          FIELD_SIZE[size],
          size === "sm" ? "pl-2" : "pl-3",
          "pr-8 placeholder:text-zinc-400",
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={showMenu ? "Hide suggestions" : "Show suggestions"}
        disabled={disabled}
        // Keep focus (and the caret) in the input.
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => {
          if (showMenu) close();
          else {
            browse("selected");
            inputRef.current?.focus();
          }
        }}
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-zinc-400 hover:text-zinc-600 disabled:pointer-events-none dark:hover:text-zinc-300"
      >
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", showMenu && "rotate-180")}
          aria-hidden
        />
      </button>

      {showMenu &&
        createPortal(
          <div
            ref={menuRef}
            style={{ visibility: "hidden" }}
            onPointerDown={(e) => e.preventDefault()}
            className={cn(MENU_CLASS, menuClassName)}
          >
            <ul
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              aria-labelledby={ariaLabelledBy}
              className={LIST_CLASS}
            >
              {rows.length === 0 && (
                <li className="px-3 py-2 text-sm text-zinc-500">{emptyText}</li>
              )}
              {rows.map((row, i) =>
                row.kind === "option" ? (
                  <li
                    key={`o:${row.option.value}`}
                    id={rowId(i)}
                    role="option"
                    aria-selected={row.option === exact}
                    aria-disabled={row.disabled || undefined}
                    onPointerMove={() => {
                      if (!row.disabled && i !== active) setActiveIndex(i);
                    }}
                    onClick={() => pick(row)}
                    className={optionRowClass(size, i === active, row.disabled)}
                  >
                    <OptionBody option={row.option} selected={row.option === exact} />
                  </li>
                ) : (
                  <li
                    key="create"
                    id={rowId(i)}
                    role="option"
                    aria-selected={false}
                    onPointerMove={() => {
                      if (i !== active) setActiveIndex(i);
                    }}
                    onClick={() => pick(row)}
                    className={cn(
                      optionRowClass(size, i === active),
                      i > 0 && "border-t border-zinc-100 dark:border-zinc-800",
                      "text-hpb-blue dark:text-hpb-gold",
                    )}
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{createLabel(row.value)}</span>
                  </li>
                ),
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
