"use client";

import { useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, ListOrdered } from "lucide-react";
import { reconcileSpeakingOrder } from "@/lib/l10/speaking-order";
import { setTeamSpeakingOrder } from "./actions";

type Member = { user_id: string; full_name: string };

/**
 * Reorder the team's durable L10 speaking order (not join order).
 * Saves on each move so the next meeting picks up the new sequence.
 */
export function SpeakingOrderEditor({
  teamId,
  members,
  storedOrder,
  canEdit,
}: {
  teamId: string;
  members: Member[];
  storedOrder: string[];
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial = useMemo(
    () => reconcileSpeakingOrder(storedOrder, members),
    [storedOrder, members],
  );
  const [order, setOrder] = useState(initial);

  // Roster can change while the page is open — re-reconcile when props change.
  const orderKey = initial.join(",");
  const [syncedKey, setSyncedKey] = useState(orderKey);
  if (orderKey !== syncedKey) {
    setSyncedKey(orderKey);
    setOrder(initial);
  }

  const nameById = useMemo(
    () => new Map(members.map((m) => [m.user_id, m.full_name])),
    [members],
  );

  function move(index: number, direction: -1 | 1) {
    if (!canEdit) return;
    const next = index + direction;
    if (next < 0 || next >= order.length) return;
    const copy = [...order];
    const tmp = copy[index]!;
    copy[index] = copy[next]!;
    copy[next] = tmp;
    setOrder(copy);
    start(async () => {
      try {
        setError(null);
        await setTeamSpeakingOrder(teamId, copy);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setOrder(initial);
      }
    });
  }

  return (
    <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <ListOrdered className="h-4 w-4 text-hpb-blue" />
        Speaking order
      </div>
      <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
        Configured L10 rotation for Segue, Scorecard, and Rocks —{" "}
        <strong className="font-medium text-zinc-700 dark:text-zinc-300">
          not join order
        </strong>
        . New members are appended alphabetically until you place them.
      </p>

      <ol className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {order.map((uid, i) => {
          const name = nameById.get(uid) ?? uid;
          return (
            <li
              key={uid}
              className="flex items-center gap-2 px-3 py-2 text-sm"
            >
              <span className="w-5 shrink-0 tabular-nums text-xs text-zinc-400">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {name}
              </span>
              {canEdit && (
                <div className="flex shrink-0 gap-0.5">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={pending || i === 0}
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
                    aria-label={`Move ${name} up`}
                    title="Move up"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={pending || i === order.length - 1}
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
                    aria-label={`Move ${name} down`}
                    title="Move down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {order.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-zinc-500">
            No members yet.
          </li>
        )}
      </ol>

      {!canEdit && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Leaders can reorder this list.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
