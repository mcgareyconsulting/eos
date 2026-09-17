"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDismissOnEscape } from "@/components/ui/modal";

export type MultiSelectOption = { value: string; label: string };

/**
 * Filter-style multi-select: a 32px trigger (same geometry as `Select`) that
 * opens a checkbox list. **An empty selection means "no filter"**, so the
 * trigger reads as the bare label until something is picked, then shows the
 * one chosen name or a count.
 *
 * `searchable` adds a type-to-filter box inside the list — for lists long
 * enough (the org's teams) that scrolling to the right row is slower than
 * typing three letters.
 */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  searchable = false,
  className,
}: {
  /** Noun shown on the trigger when nothing is selected, e.g. "Role". */
  label: string;
  options: MultiSelectOption[];
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  searchable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Every close path goes through here so the search box starts empty on
  // the next open, without an effect to reset it.
  function close() {
    setOpen(false);
    setQuery("");
  }

  useDismissOnEscape(close, open);

  // pointerdown rather than click, same as the other popovers: the list is
  // gone before a click lands on whatever sits underneath it.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function toggle(v: string) {
    const next = new Set(value);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  }

  const q = query.trim().toLowerCase();
  const visible = q
    ? options.filter((o) => o.label.toLowerCase().includes(q))
    : options;

  const selectedLabels = options.filter((o) => value.has(o.value)).map((o) => o.label);
  const summary =
    selectedLabels.length === 0
      ? label
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : `${label} · ${selectedLabels.length}`;
  const active = selectedLabels.length > 0;

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className={cn(
          "flex h-8 w-full items-center gap-1.5 rounded-md border px-2 text-sm",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40",
          active
            ? "border-hpb-blue/40 bg-hpb-blue/5 text-hpb-blue dark:border-hpb-gold/40 dark:bg-hpb-gold/10 dark:text-hpb-gold"
            : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800",
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
        {active ? (
          // A span, not a nested button: a button inside a button is invalid
          // HTML and browsers unwrap it.
          <span
            role="button"
            tabIndex={0}
            aria-label={`Clear ${label.toLowerCase()} filter`}
            onClick={(e) => {
              e.stopPropagation();
              onChange(new Set());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onChange(new Set());
              }
            }}
            className="rounded p-0.5 hover:bg-hpb-blue/10 dark:hover:bg-hpb-gold/20"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </span>
        ) : (
          <ChevronDown
            className={cn("h-3.5 w-3.5 shrink-0 opacity-70 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        )}
      </button>

      {open && (
        <div
          className="absolute left-0 z-30 mt-1 w-64 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {searchable && (
            <div className="relative border-b border-zinc-200 dark:border-zinc-700">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              {/* Mounted only while open, so autoFocus fires on each open. */}
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Find ${label.toLowerCase()}…`}
                aria-label={`Find ${label.toLowerCase()}`}
                className="h-9 w-full bg-transparent pl-8 pr-2 text-sm focus:outline-none"
              />
            </div>
          )}
          <ul
            id={listId}
            role="listbox"
            aria-multiselectable
            aria-label={label}
            className="max-h-64 overflow-y-auto py-1"
          >
            {visible.length === 0 && (
              <li className="px-3 py-2 text-sm text-zinc-500">No matches.</li>
            )}
            {visible.map((o) => {
              const selected = value.has(o.value);
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        selected
                          ? "border-hpb-blue bg-hpb-blue text-white dark:border-hpb-gold dark:bg-hpb-gold dark:text-zinc-900"
                          : "border-zinc-300 dark:border-zinc-600",
                      )}
                      aria-hidden
                    >
                      {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 truncate">{o.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {active && (
            <div className="border-t border-zinc-200 px-2.5 py-1.5 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="text-xs font-medium text-hpb-blue hover:underline dark:text-hpb-gold"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
