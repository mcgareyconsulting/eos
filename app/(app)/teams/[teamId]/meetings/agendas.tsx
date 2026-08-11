"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { DetailModal } from "@/components/detail-modal";
import {
  agendaItemLabel,
  availableToolsToAdd,
  builtInAgendaOptions,
  defaultDurationForTool,
  defaultL10Items,
  formatAgendaDuration,
  mergeAgendaOptions,
  totalAgendaSeconds,
  type AgendaItem,
  type AgendaOption,
  type AgendaToolType,
} from "@/lib/l10/agenda";
import { SEGMENT_LABELS } from "@/lib/l10/segments";
import { cn } from "@/lib/utils";
import { createAgenda, deleteAgenda, startMeeting, updateAgenda } from "./actions";

export type { AgendaOption };

// ---------------------------------------------------------------------------
// Agendas panel (leader/admin only — page mounts this when isLeader)
// Built-ins are code presets; only customs are stored / edited.
// ---------------------------------------------------------------------------

export function AgendasPanel({
  teamId,
  customs,
}: {
  teamId: string;
  customs: AgendaOption[];
}) {
  const router = useRouter();
  const builtins = useMemo(() => builtInAgendaOptions(), []);
  const [editor, setEditor] = useState<{
    id?: string;
    name: string;
    items: AgendaItem[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove(a: AgendaOption) {
    if (a.builtin) return;
    if (!window.confirm(`Delete agenda “${a.name}”?`)) return;
    start(async () => {
      try {
        setError(null);
        await deleteAgenda(teamId, a.id);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
            <ClipboardList className="h-4 w-4 text-hpb-blue" />
            Agendas
          </h2>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            Stage order and time budgets. Pick one when starting a meeting.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            setEditor({ name: "Custom meeting", items: defaultL10Items() })
          }
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="rounded-xl border border-zinc-300 bg-white divide-y divide-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 dark:divide-zinc-800">
        {builtins.map((a) => (
          <AgendaRow key={a.id} agenda={a} />
        ))}
        {customs.map((a) => (
          <AgendaRow
            key={a.id}
            agenda={a}
            onEdit={() =>
              setEditor({ id: a.id, name: a.name, items: a.items })
            }
            onDelete={() => remove(a)}
            pending={pending}
          />
        ))}
      </div>

      {editor && (
        <AgendaEditor
          teamId={teamId}
          initial={editor}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function AgendaRow({
  agenda,
  onEdit,
  onDelete,
  pending,
}: {
  agenda: AgendaOption;
  onEdit?: () => void;
  onDelete?: () => void;
  pending?: boolean;
}) {
  const total = formatAgendaDuration(totalAgendaSeconds(agenda.items));
  return (
    <div className="flex items-start gap-3 px-4 py-3 sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{agenda.name}</span>
          {agenda.builtin && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800">
              Built-in
            </span>
          )}
          <span className="text-xs tabular-nums text-zinc-500">
            {total} · {agenda.items.length} stages
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-zinc-600 dark:text-zinc-400">
          {agenda.items.map((it) => agendaItemLabel(it)).join(" → ")}
        </p>
      </div>
      {(onEdit || onDelete) && (
        <div className="flex shrink-0 gap-1">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              disabled={pending}
              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label={`Edit ${agenda.name}`}
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="rounded p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
              aria-label={`Delete ${agenda.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor modal
// ---------------------------------------------------------------------------

function AgendaEditor({
  teamId,
  initial,
  onClose,
  onSaved,
}: {
  teamId: string;
  initial: { id?: string; name: string; items: AgendaItem[] };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [items, setItems] = useState<AgendaItem[]>(
    initial.items.length ? initial.items : defaultL10Items(),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const addable = useMemo(() => availableToolsToAdd(items), [items]);
  const totalLabel = formatAgendaDuration(totalAgendaSeconds(items));

  function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= items.length) return;
    const copy = [...items];
    const tmp = copy[index]!;
    copy[index] = copy[next]!;
    copy[next] = tmp;
    setItems(copy);
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
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <DetailModal
      ariaLabel={initial.id ? "Edit agenda" : "New agenda"}
      onClose={onClose}
      size="lg"
    >
      <div className="space-y-4 pr-6">
        <h2 className="text-lg font-semibold tracking-tight">
          {initial.id ? "Edit agenda" : "New agenda"}
        </h2>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>

        <div>
          <div className="flex items-baseline justify-between">
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
                className="flex items-center gap-2 px-3 py-2"
              >
                <span className="w-5 shrink-0 text-xs tabular-nums text-zinc-400">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {agendaItemLabel(item)}
                </span>
                <label className="flex shrink-0 items-center gap-1 text-sm">
                  <input
                    type="number"
                    min={1}
                    max={480}
                    value={Math.round(item.duration_seconds / 60)}
                    onChange={(e) => {
                      const mins = Math.max(1, Math.round(Number(e.target.value) || 1));
                      setItems((prev) =>
                        prev.map((it, idx) =>
                          idx === i
                            ? { ...it, duration_seconds: mins * 60 }
                            : it,
                        ),
                      );
                    }}
                    className="w-14 rounded border border-zinc-300 bg-white px-1.5 py-1 text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-950"
                  />
                  <span className="text-xs text-zinc-500">min</span>
                </label>
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
                  onClick={() => {
                    if (items.length <= 1) {
                      setError("Keep at least one stage");
                      return;
                    }
                    setError(null);
                    setItems((prev) => prev.filter((_, idx) => idx !== i));
                  }}
                  disabled={pending || items.length <= 1}
                  className="rounded p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                  aria-label="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ol>

          {addable.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {addable.map((type: AgendaToolType) => (
                <button
                  key={type}
                  type="button"
                  onClick={() =>
                    setItems((prev) => [
                      ...prev,
                      {
                        type,
                        duration_seconds: defaultDurationForTool(type),
                      },
                    ])
                  }
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  <Plus className="h-3 w-3" />
                  {SEGMENT_LABELS[type]}
                </button>
              ))}
            </div>
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
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </DetailModal>
  );
}

// ---------------------------------------------------------------------------
// Start meeting — pick agenda (built-ins + customs)
// ---------------------------------------------------------------------------

export function StartMeetingPicker({
  teamId,
  customs,
}: {
  teamId: string;
  customs: AgendaOption[];
}) {
  const options = useMemo(() => mergeAgendaOptions(customs), [customs]);
  const defaultId = options[0]?.id ?? null;
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(defaultId);
  const [pending, start] = useTransition();

  const selection =
    options.find((a) => a.id === selectedId) ?? options[0] ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSelectedId(defaultId);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
      >
        <Plus className="h-4 w-4" />
        Start meeting
      </button>

      {open && (
        <DetailModal
          ariaLabel="Start meeting"
          onClose={() => !pending && setOpen(false)}
          size="md"
        >
          <div className="space-y-4 pr-6">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Start meeting
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Choose an agenda. Order and timers lock in for this meeting.
              </p>
            </div>

            <ul className="space-y-2">
              {options.map((a) => {
                const active = selection?.id === a.id;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      disabled={pending}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2.5 text-left transition",
                        active
                          ? "border-hpb-blue bg-hpb-blue/5 ring-1 ring-hpb-blue/40"
                          : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {a.name}
                          {a.builtin ? (
                            <span className="ml-1.5 text-[10px] font-normal uppercase text-zinc-400">
                              built-in
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                          {formatAgendaDuration(totalAgendaSeconds(a.items))}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-zinc-500">
                        {a.items.map((it) => agendaItemLabel(it)).join(" → ")}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!selection) return;
                  // Redirects into the live room — do not catch NEXT_REDIRECT.
                  start(async () => {
                    await startMeeting(teamId, selection.id);
                  });
                }}
                disabled={pending || !selection}
                className="inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
              >
                <Play className="h-3.5 w-3.5" />
                {pending ? "Starting…" : "Start"}
              </button>
            </div>
          </div>
        </DetailModal>
      )}
    </>
  );
}
