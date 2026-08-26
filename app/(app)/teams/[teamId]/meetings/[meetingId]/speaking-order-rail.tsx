"use client";

import { useTransition } from "react";
import { initials } from "@/lib/initials";
import {
  canStepSpeaker,
  currentSpeakerUid,
  presentOrder,
  stepSpeakerIndex,
} from "@/lib/l10/speaking-order";
import { setSpeakingIndex } from "../actions";

// The speaking rotation, rendered by MeetingRail so it sits on screen for
// every stage — Rocks, Headlines and To-Dos are round-robin reports too, so
// the round needs to be drivable well past Segue, not just visible.
//
// People marked absent are dropped from the rotation entirely (not struck
// through): the list should read as exactly who is going to speak. The stored
// `speaking_index` still points into the FULL order, so prev/next go through
// stepSpeakerIndex, which skips absentees.
//
// The round cycles on every stage except Segue, which is once-around — the
// caller passes `wrap` from the group's active stage, not from the stage the
// viewer happens to be peeking at, since these buttons drive the room.
export function SpeakingOrderRail({
  teamId,
  meetingId,
  order,
  speakerIndex,
  absentUserIds,
  members,
  wrap = true,
}: {
  teamId: string;
  meetingId: string;
  order: string[];
  speakerIndex: number;
  absentUserIds: string[];
  members: { user_id: string; full_name: string }[];
  /** False on Segue: the round dead-ends instead of cycling. */
  wrap?: boolean;
}) {
  const [pending, start] = useTransition();

  const visible = presentOrder(order, absentUserIds);
  if (visible.length === 0) return null;

  const nameById = new Map(members.map((m) => [m.user_id, m.full_name]));
  const currentUid = currentSpeakerUid(order, speakerIndex, absentUserIds);
  const currentName = currentUid ? (nameById.get(currentUid) ?? "—") : "—";

  const canPrev = canStepSpeaker(order, speakerIndex, absentUserIds, -1, wrap);
  const canNext = canStepSpeaker(order, speakerIndex, absentUserIds, 1, wrap);

  const jumpTo = (uid: string) =>
    start(async () => {
      await setSpeakingIndex(teamId, meetingId, order.indexOf(uid));
    });

  const step = (direction: -1 | 1) =>
    start(async () => {
      await setSpeakingIndex(
        teamId,
        meetingId,
        stepSpeakerIndex(order, speakerIndex, absentUserIds, direction, wrap),
      );
    });

  return (
    <div className="space-y-2 px-3 py-3">
      <div className="truncate text-xs text-zinc-600 dark:text-zinc-400">
        Now: <strong className="text-hpb-green">{currentName}</strong>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {visible.map((uid, idx) => {
          const name = nameById.get(uid) ?? "—";
          const isCurrent = uid === currentUid;
          return (
            <button
              key={uid}
              type="button"
              onClick={() => jumpTo(uid)}
              disabled={pending}
              title={`${idx + 1}. ${name} — give them the floor`}
              className={
                "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ring-1 ring-inset transition disabled:opacity-60 " +
                (isCurrent
                  ? "bg-hpb-green text-white ring-hpb-green/40"
                  : "bg-zinc-100 text-zinc-600 ring-zinc-200 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-700")
              }
            >
              {initials(name) || "?"}
            </button>
          );
        })}
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={pending || !canPrev}
          className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-30 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          ← Prev
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={pending || !canNext}
          className="flex-1 rounded-md bg-hpb-green px-2 py-1 text-xs font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-green/40 disabled:opacity-40"
        >
          Next speaker →
        </button>
      </div>
    </div>
  );
}
