"use client";

import { useMemo, useTransition } from "react";
import { doc } from "firebase/firestore";
import { ChevronDown, ChevronUp, UserCheck, UserX } from "lucide-react";
import { getClientDb } from "@/lib/firebase/client";
import { useDoc } from "@/lib/firebase/use-collection";
import { initials } from "@/lib/initials";
import {
  currentSpeakerUid,
  presentOrder,
  reconcileSpeakingOrder,
  stepSpeakerIndex,
} from "@/lib/l10/speaking-order";
import { QuickAddIssue } from "@/components/quick-add-issue";
import {
  setAttendeeAbsence,
  setSpeakingIndex,
  setSpeakingOrder,
} from "../actions";

type Member = { user_id: string; full_name: string };

type MeetingShape = {
  speaking_order?: string[];
  speaking_index?: number;
  absent_user_ids?: string[];
};

// The Segue stage: personal + professional good news, 30-60 seconds each, no
// discussion. This is also where attendance is settled, because everything
// downstream keys off it — absent people drop out of the speaking rotation
// entirely, and the Rocks stage dims their rocks.
//
// Order, pointer and attendance all live on the meeting doc and are written
// through server actions that deliberately skip revalidatePath, so this
// subscribes directly (same pattern as segment-issues.tsx and its discussing pin)
// and every client sees the round move without a refresh.
export function SegmentSegue({
  teamId,
  meetingId,
  userId,
  members,
  initialSpeakingOrder,
  initialSpeakerIndex,
  initialAbsentUserIds,
}: {
  teamId: string;
  meetingId: string;
  userId: string;
  members: Member[];
  initialSpeakingOrder: string[];
  initialSpeakerIndex: number;
  initialAbsentUserIds: string[];
}) {
  const db = getClientDb();
  const meetingRef = useMemo(
    () => doc(db, "meetings", meetingId),
    [db, meetingId],
  );
  const meeting = useDoc<MeetingShape>(
    meetingRef,
    {
      speaking_order: initialSpeakingOrder,
      speaking_index: initialSpeakerIndex,
      absent_user_ids: initialAbsentUserIds,
    },
    "segue",
  );

  const [pending, start] = useTransition();

  // `order` is the full stored rotation and stays the source of truth for the
  // pointer; `attending` is what actually gets numbered and spoken.
  const order = reconcileSpeakingOrder(meeting.speaking_order, members);
  const absentUserIds = meeting.absent_user_ids ?? [];
  const absent = new Set(absentUserIds);
  const index = meeting.speaking_index ?? 0;

  const attending = presentOrder(order, absentUserIds);
  const away = order.filter((uid) => absent.has(uid));

  const nameById = new Map(members.map((m) => [m.user_id, m.full_name]));
  const currentUid = currentSpeakerUid(order, index, absentUserIds);
  const currentPos = currentUid ? attending.indexOf(currentUid) : -1;
  const remaining =
    currentPos === -1 ? attending.length : attending.length - currentPos - 1;
  const roundDone = attending.length > 0 && remaining === 0;
  // stepSpeakerIndex deliberately goes inert at the ends of the round — mirror
  // that in the buttons (as the rail does) instead of leaving live-looking
  // controls that silently do nothing.
  const atStart = currentPos <= 0;
  const atEnd = currentPos === -1 || currentPos >= attending.length - 1;

  // Swap with the neighbouring *attending* person, but write positions in the
  // full order so absent teammates keep their slot for when they're back.
  function move(uid: string, direction: -1 | 1) {
    const full = [...order];
    const i = full.indexOf(uid);
    if (i === -1) return;
    let j = i + direction;
    while (j >= 0 && j < full.length && absent.has(full[j])) j += direction;
    if (j < 0 || j >= full.length) return;
    [full[i], full[j]] = [full[j], full[i]];
    start(async () => {
      await setSpeakingOrder(teamId, meetingId, full);
    });
  }

  function jumpTo(uid: string) {
    start(async () => {
      await setSpeakingIndex(teamId, meetingId, order.indexOf(uid));
    });
  }

  function step(direction: -1 | 1) {
    start(async () => {
      await setSpeakingIndex(
        teamId,
        meetingId,
        stepSpeakerIndex(order, index, absentUserIds, direction),
      );
    });
  }

  function toggleAbsence(uid: string, isAbsent: boolean) {
    start(async () => {
      await setAttendeeAbsence(teamId, meetingId, uid, !isAbsent);
    });
  }

  return (
    <div className="space-y-3">
      {/* The stage's own coaching line lives in the page heading now — this
          row would have repeated it verbatim right underneath. */}
      <div className="flex justify-end">
        <QuickAddIssue
          teamId={teamId}
          prefill="From segue: "
          meetingId={meetingId}
        />
      </div>

      <div className="rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="text-sm font-medium">
            Good news round
            <span className="ml-2 text-xs font-normal text-zinc-600 dark:text-zinc-400">
              {attending.length === 0
                ? "nobody in the room"
                : roundDone
                  ? "everyone's shared"
                  : `${remaining} still to share`}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={pending || attending.length === 0 || atStart}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={pending || attending.length === 0 || atEnd}
              className="rounded-md bg-hpb-green px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-green/40 disabled:opacity-60"
            >
              Next speaker →
            </button>
          </div>
        </div>

        {attending.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
            {order.length === 0
              ? "No teammates on this team yet."
              : "Everyone is marked absent."}
          </div>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {attending.map((uid, position) => {
              const name = nameById.get(uid) ?? "—";
              const isCurrent = uid === currentUid;
              const isSelf = uid === userId;
              return (
                <div
                  key={uid}
                  className={
                    "flex items-center gap-3 px-4 py-3 transition " +
                    (isCurrent ? "bg-hpb-green/5" : "")
                  }
                >
                  <span className="w-4 text-xs tabular-nums text-zinc-500">
                    {position + 1}
                  </span>

                  <button
                    type="button"
                    onClick={() => jumpTo(uid)}
                    disabled={pending}
                    title={`Give the floor to ${name}`}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className={
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset " +
                        (isCurrent
                          ? "bg-hpb-green text-white ring-hpb-green/40"
                          : "bg-hpb-blue/10 text-hpb-blue ring-hpb-blue/30")
                      }
                    >
                      {initials(name) || "?"}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {name}
                        {isSelf && (
                          <span className="ml-1 text-xs font-normal text-zinc-500">
                            (you)
                          </span>
                        )}
                      </span>
                      {isCurrent && (
                        <span className="block text-[11px] font-medium text-hpb-green">
                          Sharing now
                        </span>
                      )}
                    </span>
                  </button>

                  <div className="flex items-center gap-1">
                    {/* You can't mark yourself absent — same rule the
                        Conclude attendance grid follows. */}
                    {!isSelf && (
                      <button
                        type="button"
                        onClick={() => toggleAbsence(uid, false)}
                        disabled={pending}
                        title={`Mark ${name} absent — drops them from the round`}
                        className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                      >
                        <UserX className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => move(uid, -1)}
                      disabled={pending || position === 0}
                      title="Move earlier"
                      className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(uid, 1)}
                      disabled={pending || position === attending.length - 1}
                      title="Move later"
                      className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Not in the room: out of the rotation, but one click from rejoining
            (and their rocks stay dimmed on the Rocks stage until they do). */}
        {away.length > 0 && (
          <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Not attending ({away.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {away.map((uid) => {
                const name = nameById.get(uid) ?? "—";
                return (
                  <button
                    key={uid}
                    type="button"
                    onClick={() => toggleAbsence(uid, true)}
                    disabled={pending}
                    title={`Mark ${name} here — puts them back in the round`}
                    className="inline-flex items-center gap-1.5 rounded-full bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-100 disabled:opacity-40 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800 dark:hover:bg-zinc-800"
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Never auto-advances the stage — the group moves on when the
          facilitator says so, not when a pointer hits the end. */}
      {roundDone && (
        <p className="text-xs font-medium text-hpb-green">
          Everyone&rsquo;s shared — on to Scorecard.
        </p>
      )}
    </div>
  );
}
