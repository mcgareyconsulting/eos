"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
} from "lucide-react";
import { DetailModal } from "@/components/detail-modal";
import {
  AGENDA_TOOL_TYPES,
  agendaItemLabel,
  availableToolsToAdd,
  defaultDurationForTool,
  defaultL10Items,
  formatAgendaDuration,
  totalAgendaSeconds,
  type AgendaItem,
  type AgendaToolType,
} from "@/lib/l10/agenda";
import { SEGMENT_HINTS, SEGMENT_LABELS } from "@/lib/l10/segments";
import { createAgenda, updateAgenda } from "./actions";

export type AgendaEditorInitial = {
  id?: string;
  name: string;
  items: AgendaItem[];
};

export function AgendaEditorModal({
  teamId,
  initial,
  onClose,
  onSaved,
}: {
  teamId: string;
  initial: AgendaEditorInitial;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [items, setItems] = useState<AgendaItem[]>(
    initial.items.length ? initial.items : defaultL10Items(),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const totalLabel = formatAgendaDuration(totalAgendaSeconds(items));
  const addable = useMemo(() => availableToolsToAdd(items), [items]);

  function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= items.length) return;
    const copy = [...items];
    const tmp = copy[index]!;
    copy[index] = copy[next]!;
    copy[next] = tmp;
    setItems(copy);
  }

  function setMinutes(index: number, minutes: number) {
    const secs = Math.max(1, Math.round(minutes)) * 60;
    setItems((prev) =>
      prev.map((it, i) =>
        i === index ? { ...it, duration_seconds: secs } : it,
      ),
    );
  }

  function remove(index: number) {
    if (items.length <= 1) {
      setError("Keep at least one stage on the agenda");
      return;
    }
    setError(null);
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function addTool(type: AgendaToolType) {
    setItems((prev) => [
      ...prev,
      { type, duration_seconds: defaultDurationForTool(type) },
    ]);
  }

  function save() {
    start(async () => {
      try {
        setError(null);
        if (initial.id) {
          await updateAgenda(teamId, initial.id, { name, items });
        } else {
          await createAgenda(teamId, { name, items });
        }
        onSaved();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <DetailModal
      ariaLabel={initial.id ? "Edit agenda" : "Create agenda"}
      onClose={onClose}
      size="lg"
    >
      <div className="space-y-5 pr-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {initial.id ? "Edit agenda" : "New agenda"}
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Set the stage order and time budget. When you start a meeting you
            pick which agenda to run.
          </p>
        </div>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. Level 10, Weekly focus"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Stages
            </span>
            <span className="text-xs tabular-nums text-zinc-500">
              Total {totalLabel}
            </span>
          </div>

          <ol className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {items.map((item, i) => (
              <li
                key={`${item.type}-${i}`}
                className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:flex-nowrap"
              >
                <span className="w-5 shrink-0 tabular-nums text-xs text-zinc-400">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {agendaItemLabel(item)}
                  </div>
                  <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                    {SEGMENT_HINTS[item.type]}
                  </div>
                </div>
                <label className="flex shrink-0 items-center gap-1 text-sm">
                  <input
                    type="number"
                    min={1}
                    max={480}
                    value={Math.round(item.duration_seconds / 60)}
                    onChange={(e) =>
                      setMinutes(i, Number(e.target.value) || 1)
                    }
                    className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-950"
                  />
                  <span className="text-xs text-zinc-500">min</span>
                </label>
                <div className="flex shrink-0 gap-0.5">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={pending || i === 0}
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
                    aria-label="Move up"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={pending || i === items.length - 1}
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
                    aria-label="Move down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    disabled={pending || items.length <= 1}
                    className="rounded p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950/40"
                    aria-label="Remove stage"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ol>

          {addable.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Add stage
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {addable.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addTool(type)}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <Plus className="h-3 w-3" />
                    {SEGMENT_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {addable.length === 0 && (
            <p className="mt-2 text-[11px] text-zinc-500">
              All {AGENDA_TOOL_TYPES.length} meeting tools are on this agenda.
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || !name.trim() || items.length === 0}
            className="rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
          >
            {pending ? "Saving…" : initial.id ? "Save agenda" : "Create agenda"}
          </button>
        </div>
      </div>
    </DetailModal>
  );
}
