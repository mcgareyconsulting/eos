"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { SELECT_FIELD_CLASS } from "@/components/ui/input";
import {
  initialOwnerScope,
  ownerPickerRows,
  type OrgPerson,
  type OwnerPickerScope,
  type OwnerPickerTeam,
} from "@/lib/owner-picker";

export type { OrgPerson, OwnerPickerTeam } from "@/lib/owner-picker";

// Owner picker — started as the milestone owner picker (N66), now shared
// (milestone rows, the to-do Owner field). Two scopes:
//
//   team tab       — the parent team's own people only, labelled with its
//                    name. On a rock, deliberately NOT the teams the rock is
//                    shared into: listing them here would show anyone
//                    opening the picker where the rock has been shared.
//                    Shared-team people are reached through Whole org like
//                    anyone else.
//   "Whole org"    — everyone on any roster, A–Z; search matches a name or a
//                    team name, so no separate team filter. On a milestone,
//                    picking someone outside the parent team and the
//                    audience is allowed: they see the rock's headline and
//                    their own milestone only (lib/access/rock.ts), and the
//                    rock modal confirms that on save. Those people carry a
//                    gold dot, on the trigger and in the list (spec §3.3) —
//                    only when the caller passes `insideIds`.
//
// Opt-ins, all off by default so existing callers look and behave as before:
//   allowUnassigned — an Unassigned row first in either tab; picking it
//                     calls onChange(""), the same "" the issue form's
//                     native Owner select uses for no owner.
//   variant="field" — a full-width trigger with the form `Select` fill, for
//                     a form's main Owner field. The popover is the same
//                     size in both variants.
//   name            — a hidden input carrying the value, for FormData forms.
//
// The list rules (scopes, search, the Unassigned row) live in
// lib/owner-picker.ts, with tests.
//
// The popover is portalled and fixed-positioned: milestone rows sit at the
// bottom of a scrolling modal, where an absolute menu would be clipped.

const POPOVER_WIDTH = 416;
const GOLD_DOT_TITLE = "Will see only their milestone and the rock's title";

export function OwnerPicker({
  value,
  valueName,
  onChange,
  team,
  insideIds,
  orgPeople,
  onNeedOrg,
  teamNameById,
  label = "Milestone owner",
  allowUnassigned = false,
  unassignedLabel = "Unassigned",
  variant = "compact",
  name,
  id,
  className,
}: {
  /** The owner's user id; "" for none. */
  value: string;
  /** What the trigger shows — the caller resolves the name (or "Unassigned"). */
  valueName: string;
  onChange: (userId: string) => void;
  /** The parent team — the first tab's whole list. */
  team: OwnerPickerTeam;
  /** Everyone who sees the whole rock (parent team + audience). Only
   *  drives the "sees only their milestone" dot; never listed. Undefined
   *  while the org list loads — no dot until it is known. */
  insideIds?: ReadonlySet<string>;
  /** null until first requested — see onNeedOrg. */
  orgPeople: OrgPerson[] | null;
  /** Called the first time the Whole org scope is opened. */
  onNeedOrg: () => void;
  teamNameById: ReadonlyMap<string, string>;
  /** Accessible name of the field: the trigger reads "{label}: {valueName}",
   *  the popover "Choose {label}" (lowercased). */
  label?: string;
  /** Adds an Unassigned row, first in either tab, that picks "" (no owner). */
  allowUnassigned?: boolean;
  /** The Unassigned row's text. */
  unassignedLabel?: string;
  /** "compact" — the milestone-row trigger (size it with className);
   *  "field" — full-width, matching the form `Select`. */
  variant?: "compact" | "field";
  /** Renders `<input type="hidden" name={name} value={value}>` for FormData. */
  name?: string;
  /** Put on the trigger button, for a `<label htmlFor>`. */
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<OwnerPickerScope>("team");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const outsideRock = !!value && !!insideIds && !insideIds.has(value);

  function openPicker() {
    // An owner not on the parent team is only findable org-wide.
    const s = initialOwnerScope(team, value);
    setScope(s);
    if (s === "org") onNeedOrg();
    setQuery("");
    setActive(0);
    setOpen(true);
  }
  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }
  function pickScope(s: OwnerPickerScope) {
    setScope(s);
    setActive(0);
    if (s === "org") onNeedOrg();
    // Clicking the tab takes focus off the search box; put it back so the
    // next keystroke searches.
    searchRef.current?.focus();
  }

  // Position under the trigger, or above it when the viewport runs out.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const height = 520;
      const up = r.bottom + height > window.innerHeight && r.top > height;
      // 8px inside the viewport's right edge, and its left on narrow screens.
      const left = Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_WIDTH - 8));
      setPos({ left, top: up ? r.top - 4 : r.bottom + 4, up });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const rows = useMemo(
    () =>
      ownerPickerRows({
        scope,
        query,
        team,
        orgPeople,
        teamNameById,
        unassignedLabel: allowUnassigned ? unassignedLabel : undefined,
      }),
    [scope, query, team, orgPeople, teamNameById, allowUnassigned, unassignedLabel],
  );

  const activeId = rows[Math.min(active, rows.length - 1)]?.key;

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-key="${CSS.escape(activeId ?? "")}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function choose(userId: string) {
    onChange(userId);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // Handled here, not on window: the rock modal listens for Escape on the
    // window, and one keypress must not close both.
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = rows[Math.min(active, rows.length - 1)];
      if (r) choose(r.id);
    }
  }

  const field = variant === "field";

  return (
    <>
      {name !== undefined && <input type="hidden" name={name} value={value} />}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        onClick={() => (open ? close() : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${valueName}`}
        className={cn(
          field
            ? cn(
                SELECT_FIELD_CLASS,
                "flex items-center gap-1.5 bg-white text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/30",
              )
            : "flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-1.5 py-1.5 text-left text-xs dark:border-zinc-700 dark:bg-zinc-900",
          open && "ring-2 ring-hpb-blue/30",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{valueName}</span>
        {outsideRock && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-hpb-gold"
            title={GOLD_DOT_TITLE}
            aria-hidden
          />
        )}
        <ChevronDown
          className={cn("shrink-0 opacity-60", field ? "h-4 w-4" : "h-3 w-3")}
          aria-hidden
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label={`Choose ${label.toLowerCase()}`}
            onKeyDown={onKeyDown}
            style={{
              left: pos.left,
              top: pos.top,
              transform: pos.up ? "translateY(-100%)" : undefined,
            }}
            className="fixed z-[60] w-[416px] max-w-[calc(100vw-16px)] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="space-y-2 border-b border-zinc-200 p-2 dark:border-zinc-700">
              <div
                role="radiogroup"
                aria-label="Who to choose from"
                className="flex rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800"
              >
                {(
                  [
                    ["team", team.name],
                    ["org", "Whole org"],
                  ] as const
                ).map(([s, tabLabel]) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={scope === s}
                    onClick={() => pickScope(s)}
                    title={tabLabel}
                    className={cn(
                      "min-w-0 flex-1 truncate rounded px-2 py-1 text-[12px] font-semibold transition-colors",
                      scope === s
                        ? "bg-white text-hpb-blue shadow-sm dark:bg-zinc-900 dark:text-hpb-gold"
                        : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
                    )}
                  >
                    {tabLabel}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  <input
                    ref={searchRef}
                    autoFocus
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActive(0);
                    }}
                    placeholder={scope === "org" ? "Name or team…" : "Search people…"}
                    aria-label="Search people"
                    className="h-8 w-full rounded-md border border-zinc-300 bg-transparent pl-7 pr-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-hpb-blue/30 dark:border-zinc-700"
                  />
                </div>
              </div>
            </div>

            <ul ref={listRef} className="max-h-96 overflow-y-auto py-1" role="listbox" aria-label="People">
              {rows.map((r) => (
                <li key={r.key} data-key={r.key} role="option" aria-selected={r.id === value}>
                  <button
                    type="button"
                    onClick={() => choose(r.id)}
                    onMouseMove={() => setActive(rows.findIndex((p) => p.key === r.key))}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left",
                      r.key === activeId && "bg-zinc-100 dark:bg-zinc-800",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-[13px]",
                          r.unassigned
                            ? "text-zinc-500 dark:text-zinc-400"
                            : "text-zinc-800 dark:text-zinc-100",
                        )}
                      >
                        {r.name}
                      </span>
                      {r.detail && (
                        <span className="block truncate text-[11px] text-zinc-500">
                          {r.detail}
                        </span>
                      )}
                    </span>
                    {insideIds && !r.unassigned && !insideIds.has(r.id) && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-hpb-gold"
                        title={GOLD_DOT_TITLE}
                        aria-label="Sees only their milestone"
                      />
                    )}
                    {r.id === value && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-hpb-blue dark:text-hpb-gold" aria-hidden />
                    )}
                  </button>
                </li>
              ))}
              {scope === "org" && !orgPeople && (
                <li className="px-3 py-2 text-[13px] text-zinc-500">Loading the org…</li>
              )}
              {(scope === "team" || orgPeople) && rows.length === 0 && (
                <li className="px-3 py-2 text-[13px] text-zinc-500">No matches.</li>
              )}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
