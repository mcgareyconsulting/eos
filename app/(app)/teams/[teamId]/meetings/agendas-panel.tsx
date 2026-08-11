"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ClipboardList, Pencil, Plus, Trash2 } from "lucide-react";
import {
  agendaItemLabel,
  defaultL10Items,
  formatAgendaDuration,
  totalAgendaSeconds,
  type AgendaItem,
} from "@/lib/l10/agenda";
import { deleteAgenda } from "./actions";
import { AgendaEditorModal, type AgendaEditorInitial } from "./agenda-editor";

export type AgendaListItem = {
  id: string;
  name: string;
  items: AgendaItem[];
  is_default?: boolean;
};

export function AgendasPanel({
  teamId,
  agendas,
  canEdit,
}: {
  teamId: string;
  agendas: AgendaListItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<AgendaEditorInitial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function openCreate() {
    setEditor({
      name: "Custom meeting",
      items: defaultL10Items(),
    });
  }

  function openEdit(a: AgendaListItem) {
    setEditor({
      id: a.id,
      name: a.name,
      items: a.items,
    });
  }

  function remove(a: AgendaListItem) {
    if (a.is_default) return;
    if (
      !window.confirm(
        `Delete agenda “${a.name}”? Past meetings keep their snapshot; only this template is removed.`,
      )
    ) {
      return;
    }
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
            Templates for stage order and time budgets. Leaders pick one when
            starting a meeting.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Plus className="h-3.5 w-3.5" />
            New agenda
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="rounded-xl border border-zinc-300 bg-white divide-y divide-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 dark:divide-zinc-800">
        {agendas.length === 0 && (
          <div className="px-4 py-6 text-sm text-zinc-600 dark:text-zinc-400">
            No agendas yet
            {canEdit
              ? " — create one, or refresh to seed Level 10 defaults."
              : "."}
          </div>
        )}
        {agendas.map((a) => {
          const total = formatAgendaDuration(totalAgendaSeconds(a.items));
          const stageSummary = a.items
            .map((it) => agendaItemLabel(it))
            .join(" → ");
          return (
            <div
              key={a.id}
              className="flex items-start gap-3 px-4 py-3 sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">{a.name}</span>
                  {a.is_default && (
                    <span className="rounded-full bg-hpb-blue/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-hpb-blue">
                      Default
                    </span>
                  )}
                  <span className="text-xs tabular-nums text-zinc-500">
                    {total} · {a.items.length} stages
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-zinc-600 dark:text-zinc-400">
                  {stageSummary}
                </p>
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(a)}
                    disabled={pending}
                    className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    aria-label={`Edit ${a.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {!a.is_default && (
                    <button
                      type="button"
                      onClick={() => remove(a)}
                      disabled={pending}
                      className="rounded p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      aria-label={`Delete ${a.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editor && (
        <AgendaEditorModal
          teamId={teamId}
          initial={editor}
          onClose={() => setEditor(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </section>
  );
}
