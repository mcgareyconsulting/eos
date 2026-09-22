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

// Milestone owner picker (N66). Two scopes:
//
//   team tab       — the parent team's own people only, labelled with its
//                    name. Deliberately NOT the teams the rock is shared
//                    into: listing them here would show anyone opening the
//                    picker where the rock has been shared. Shared-team
//                    people are reached through Whole org like anyone else.
//   "Whole org"    — everyone on any roster, A–Z; search matches a name or a
//                    team name, so no separate team filter. Picking
//                    someone outside the rock's teams is allowed: they see the
//                    rock's headline and their own milestone only, and the
//                    rock modal confirms that on save. No per-row "outside"
//                    tag — each row already lists its teams.
//
// The popover is portalled and fixed-positioned: milestone rows sit at the
// bottom of a scrolling modal, where an absolute menu would be clipped.

type Member = { user_id: string; full_name: string };

export type RockTeamRoster = { id: string; name: string; people: Member[] };

export type OrgPerson = {
  user_id: string;
  full_name: string;
  team_ids: string[];
};

type Scope = "rock" | "org";

type Row = {
  key: string;
  id: string;
  name: string;
  detail?: string;
};

export function OwnerPicker({
  value,
  valueName,
  onChange,
  team,
  insideIds,
  orgPeople,
  onNeedOrg,
  teamNameById,
  className,
}: {
  value: string;
  valueName: string;
  onChange: (userId: string) => void;
  /** The parent team — the first tab's whole list. */
  team: RockTeamRoster;
  /** Everyone on the rock's teams (parent + shared). Only drives the
   *  "outside this rock" dot; never listed. Undefined while shared rosters
   *  load — no dot until it is known. */
  insideIds?: ReadonlySet<string>;
  /** null until first requested — see onNeedOrg. */
  orgPeople: OrgPerson[] | null;
  /** Called the first time the Whole org scope is opened. */
  onNeedOrg: () => void;
  teamNameById: ReadonlyMap<string, string>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("rock");
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
    const onTeam = team.people.some((p) => p.user_id === value);
    const s: Scope = onTeam || !value ? "rock" : "org";
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
  function pickScope(s: Scope) {
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
      const left = Math.min(r.left, window.innerWidth - 416 - 8);
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

  const q = query.trim().toLowerCase();
  const rows: Row[] = useMemo(() => {
    if (scope === "rock") {
      return team.people
        .filter((p) => !q || p.full_name.toLowerCase().includes(q))
        .map((p) => ({
          key: p.user_id,
          id: p.user_id,
          name: p.full_name,
        }));
    }
    if (!orgPeople) return [];
    return orgPeople
      .map((p) => ({
        p,
        teams: p.team_ids.map((id) => teamNameById.get(id) ?? "Team"),
      }))
      .filter(
        ({ p, teams }) =>
          !q ||
          p.full_name.toLowerCase().includes(q) ||
          teams.some((n) => n.toLowerCase().includes(q)),
      )
      .map(({ p, teams }) => ({
        key: p.user_id,
        id: p.user_id,
        name: p.full_name,
        detail: teams.join(", "),
      }));
  }, [scope, team, orgPeople, teamNameById, q]);

  const people = rows;
  const activeId = people[Math.min(active, people.length - 1)]?.key;

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-key="${CSS.escape(activeId ?? "")}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function choose(id: string) {
    onChange(id);
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
      setActive((i) => Math.min(i + 1, people.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const p = people[Math.min(active, people.length - 1)];
      if (p) choose(p.id);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Milestone owner: ${valueName}`}
        className={cn(
          "flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-1.5 py-1.5 text-left text-xs dark:border-zinc-700 dark:bg-zinc-900",
          open && "ring-2 ring-hpb-blue/30",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{valueName}</span>
        {outsideRock && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-hpb-gold"
            title="Outside this rock's teams"
            aria-hidden
          />
        )}
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label="Choose milestone owner"
            onKeyDown={onKeyDown}
            style={{
              left: pos.left,
              top: pos.top,
              transform: pos.up ? "translateY(-100%)" : undefined,
            }}
            className="fixed z-[60] w-[416px] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="space-y-2 border-b border-zinc-200 p-2 dark:border-zinc-700">
              <div
                role="radiogroup"
                aria-label="Who to choose from"
                className="flex rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800"
              >
                {(
                  [
                    ["rock", team.name],
                    ["org", "Whole org"],
                  ] as const
                ).map(([s, label]) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={scope === s}
                    onClick={() => pickScope(s)}
                    title={label}
                    className={cn(
                      "min-w-0 flex-1 truncate rounded px-2 py-1 text-[12px] font-semibold transition-colors",
                      scope === s
                        ? "bg-white text-hpb-blue shadow-sm dark:bg-zinc-900 dark:text-hpb-gold"
                        : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
                    )}
                  >
                    {label}
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
              {scope === "org" && !orgPeople && (
                <li className="px-3 py-2 text-[13px] text-zinc-500">Loading the org…</li>
              )}
              {(scope === "rock" || orgPeople) && people.length === 0 && (
                <li className="px-3 py-2 text-[13px] text-zinc-500">No matches.</li>
              )}
              {rows.map((r) => (
                  <li key={r.key} data-key={r.key} role="option" aria-selected={r.id === value}>
                    <button
                      type="button"
                      onClick={() => choose(r.id)}
                      onMouseMove={() => setActive(people.findIndex((p) => p.key === r.key))}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left",
                        r.key === activeId && "bg-zinc-100 dark:bg-zinc-800",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-zinc-800 dark:text-zinc-100">
                          {r.name}
                        </span>
                        {r.detail && (
                          <span className="block truncate text-[11px] text-zinc-500">
                            {r.detail}
                          </span>
                        )}
                      </span>
                      {r.id === value && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-hpb-blue dark:text-hpb-gold" aria-hidden />
                      )}
                    </button>
                  </li>
                ),
              )}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
