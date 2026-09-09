"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Library, Plus } from "lucide-react";
import type { ScorecardPeriod } from "@/lib/scorecard-periods";
import { MetricFormModal } from "./metric-form-modal";
import { AddExistingMetricModal } from "./add-existing-metric-modal";

type Member = { user_id: string; full_name: string };

/**
 * "Add measurable", split into the two things that phrase now means:
 * **Create new** (the original form) and **Add existing** (pull one already
 * defined elsewhere in the org onto this scorecard).
 *
 * The split is a menu rather than two buttons in the header because the two
 * are one intent with two routes, and a team that already tracks a number
 * should be nudged to reuse it rather than type a second measurable with the
 * same name — which is how a scorecard ends up with two "Total Teller
 * Transactions" that disagree.
 *
 * Create stays first and keeps the primary styling: it is the common case,
 * and the menu should not make the familiar action feel demoted.
 */
export function AddMeasurableMenu({
  teamId,
  members,
  defaultOwnerId,
  groups,
  activePeriod,
}: {
  teamId: string;
  members: Member[];
  defaultOwnerId: string;
  groups: string[];
  activePeriod: ScorecardPeriod;
}) {
  const [open, setOpen] = useState(false);
  // Both modals are mounted as siblings of the popover, never inside it.
  // Choosing an item closes the popover, and a modal rendered within it would
  // be unmounted in the same tick it was told to open — it simply never
  // appeared. Hence controlled state here rather than inside each modal.
  const [createOpen, setCreateOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape. `pointerdown` rather than `click`
  // so the menu is already gone by the time a click lands on whatever is
  // underneath it — otherwise opening one modal from a menu item that sits
  // over another control fires both.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const itemClass =
    "flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none dark:hover:bg-zinc-800 dark:focus:bg-zinc-800";

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add measurable
        <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Add measurable"
          className="absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              setCreateOpen(true);
            }}
          >
            <Plus
              className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500"
              aria-hidden
            />
            <span>
              <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Create new
              </span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                Define a new measurable for this team
              </span>
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            className={`${itemClass} border-t border-zinc-200 dark:border-zinc-700`}
            onClick={() => {
              setOpen(false);
              setPickerOpen(true);
            }}
          >
            <Library
              className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500"
              aria-hidden
            />
            <span>
              <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Add existing
              </span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                Pull one already tracked by another team
              </span>
            </span>
          </button>
        </div>
      )}

      {/* Mounted per open, like the picker: fresh useState initialisers are
          the form reset, so a second Create-new starts empty rather than
          holding the last one's typing. */}
      {createOpen && (
        <MetricFormModal
          mode="create"
          teamId={teamId}
          members={members}
          defaultOwnerId={defaultOwnerId}
          groups={groups}
          activePeriod={activePeriod}
          open
          onOpenChange={setCreateOpen}
        />
      )}

      {/* Mounted only while open, so the catalog is re-fetched and the search
          box starts empty each time rather than showing the last visit's
          list. Still a sibling of the popover, never a child of it. */}
      {pickerOpen && (
        <AddExistingMetricModal
          teamId={teamId}
          teamGroups={groups}
          open
          onOpenChange={setPickerOpen}
        />
      )}
    </div>
  );
}
