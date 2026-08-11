"use client";

import { useState, useTransition } from "react";
import { Plus, Play } from "lucide-react";
import { DetailModal } from "@/components/detail-modal";
import {
  agendaItemLabel,
  formatAgendaDuration,
  totalAgendaSeconds,
  type AgendaItem,
} from "@/lib/l10/agenda";
import { cn } from "@/lib/utils";
import { startMeeting } from "./actions";
import type { AgendaListItem } from "./agendas-panel";

/**
 * Leader control: pick an agenda template, then mint the live meeting with
 * that template snapshotted onto the meeting doc.
 */
export function StartMeetingPicker({
  teamId,
  agendas,
}: {
  teamId: string;
  agendas: AgendaListItem[];
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    () =>
      agendas.find((a) => a.is_default)?.id ?? agendas[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Keep selection valid if the list reloads while the modal is closed.
  const selection =
    agendas.find((a) => a.id === selectedId) ??
    agendas.find((a) => a.is_default) ??
    agendas[0] ??
    null;

  function openModal() {
    setError(null);
    setSelectedId(
      agendas.find((a) => a.is_default)?.id ?? agendas[0]?.id ?? null,
    );
    setOpen(true);
  }

  function confirm() {
    if (!selection) {
      setError("Create an agenda first");
      return;
    }
    // No try/catch around startMeeting: it redirects into the live room, and
    // catching NEXT_REDIRECT would swallow navigation (same as Finish → endMeeting).
    start(async () => {
      setError(null);
      await startMeeting(teamId, selection.id);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
      >
        <Plus className="h-4 w-4" />
        Start meeting
      </button>

      {open && (
        <DetailModal
          ariaLabel="Choose meeting agenda"
          onClose={() => !pending && setOpen(false)}
          size="md"
        >
          <div className="space-y-4 pr-6">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Start meeting
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Choose which agenda to run. Stage order and timers are fixed for
                this meeting once it starts.
              </p>
            </div>

            {agendas.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No agendas yet. Create one in the Agendas section below, then
                start the meeting.
              </p>
            ) : (
              <ul className="space-y-2">
                {agendas.map((a) => {
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
                          <span className="text-sm font-medium">{a.name}</span>
                          <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                            {formatAgendaDuration(
                              totalAgendaSeconds(a.items),
                            )}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {stageLine(a.items)}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

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
                onClick={confirm}
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

function stageLine(items: AgendaItem[]): string {
  return items.map((it) => agendaItemLabel(it)).join(" → ");
}
