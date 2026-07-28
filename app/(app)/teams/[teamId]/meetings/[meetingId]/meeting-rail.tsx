"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useAuthUid } from "@/lib/firebase/use-collection";
import { cn } from "@/lib/utils";
import {
  SEGMENTS,
  SEGMENT_LABELS,
  SEGMENT_DURATION_SECONDS,
  TOTAL_MEETING_SECONDS,
  type Segment,
} from "@/lib/l10/segments";
import { formatClock } from "@/lib/l10/format-clock";
import { useNow } from "@/lib/l10/use-now";
import { advanceSegment, endMeeting } from "../actions";
import { SpeakingOrderRail } from "./speaking-order-rail";

const VISIBLE = SEGMENTS.filter((s) => s !== "done");

// How long the Finish button stays armed before falling back to its safe
// label. Long enough to move the mouse, short enough that a stray click a
// minute later can't end the meeting.
const CONFIRM_WINDOW_MS = 4000;

// Live orchestrator chrome, rendered as the meeting's own left rail. The
// active stage + timer live on the meeting doc and stream to every client
// (last-write-wins). Each user may peek at another stage locally (?view=)
// without moving the group; "following" users snap to the active stage
// whenever it changes.
//
// This is a side panel rather than a bar above the content because vertical
// space is the scarce resource during an L10 — the old full-width card pushed
// Attendance/Scorecard below the fold and scrolled the clock off screen
// entirely during the 60-minute Issues segment.
export function MeetingRail({
  teamId,
  meetingId,
  viewSegment,
  following,
  initialSegment,
  initialStartedAtMs,
  meetingStartedAtMs,
  initialEnded,
  driverName,
  members,
  initialSpeakingOrder,
  initialSpeakerIndex,
  initialAbsentUserIds,
}: {
  teamId: string;
  meetingId: string;
  viewSegment: Segment;
  following: boolean;
  initialSegment: Segment;
  initialStartedAtMs: number | null;
  /** Meeting `started_at` — fixed for the life of the meeting, so a plain
   *  prop is enough; it never needs to come off the snapshot. */
  meetingStartedAtMs: number | null;
  initialEnded: boolean;
  driverName: string | null;
  members: { user_id: string; full_name: string }[];
  initialSpeakingOrder: string[];
  initialSpeakerIndex: number;
  initialAbsentUserIds: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Live shared state from the meeting-doc snapshot, or null until it arrives.
  // We derive the displayed values below, falling back to the server-rendered
  // props — so the rail is correct on every (re)render even if the snapshot
  // lags or is blocked, and the snapshot layers cross-client updates on top
  // when permitted.
  const [live, setLive] = useState<{
    segment: Segment;
    startedAtMs: number | null;
    ended: boolean;
    speakingOrder: string[];
    speakerIndex: number;
    absentUserIds: string[];
  } | null>(null);
  const uid = useAuthUid();

  useEffect(() => {
    if (!uid) return; // wait for client auth before subscribing
    const ref = doc(getClientDb(), "meetings", meetingId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const x = snap.data();
        if (!x) return;
        const ts = x.segment_started_at as
          { toMillis?: () => number } | null | undefined;
        setLive({
          segment: (x.current_segment as Segment) ?? "segue",
          startedAtMs: ts?.toMillis?.() ?? null,
          ended: x.ended_at != null,
          speakingOrder: (x.speaking_order as string[]) ?? [],
          speakerIndex: (x.speaking_index as number) ?? 0,
          absentUserIds: (x.absent_user_ids as string[]) ?? [],
        });
      },
      (e) => console.error("[meeting-rail] subscribe:", e),
    );
    return unsub;
  }, [meetingId, uid]);

  const activeSegment = live?.segment ?? initialSegment;
  const startedAtMs = live?.startedAtMs ?? initialStartedAtMs;
  const ended = live?.ended ?? initialEnded;
  const speakingOrder = live?.speakingOrder ?? initialSpeakingOrder;
  const speakerIndex = live?.speakerIndex ?? initialSpeakerIndex;
  const absentUserIds = live?.absentUserIds ?? initialAbsentUserIds;

  // Followers: when the group moves to a stage we're not showing, reload the
  // page so the new stage's content renders. (Peekers are left alone.)
  useEffect(() => {
    if (following && activeSegment !== viewSegment) router.refresh();
  }, [following, activeSegment, viewSegment, router]);

  // The meeting ending is a global event everyone should see immediately.
  useEffect(() => {
    if (ended && !initialEnded) router.refresh();
  }, [ended, initialEnded, router]);

  const [driving, startDrive] = useTransition();
  const [finishing, startFinish] = useTransition();

  // Two-step Finish. The button is permanently on screen now rather than
  // tucked into the page header, and ending a meeting can't be undone.
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );
  const finish = () => {
    if (!armed) {
      setArmed(true);
      armTimer.current = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
      return;
    }
    if (armTimer.current) clearTimeout(armTimer.current);
    setArmed(false);
    startFinish(async () => {
      await endMeeting(teamId, meetingId);
    });
  };

  const goLive = () => router.push(pathname);
  const peek = (s: Segment) =>
    s === activeSegment ? goLive() : router.push(`${pathname}?view=${s}`);

  // Driving the shared stage is a deliberate act — snap the driver back to live
  // so the content visibly moves with the meeting (even if they were peeking).
  const drive = (dir: "next" | "prev") =>
    startDrive(async () => {
      await advanceSegment(teamId, meetingId, dir);
      if (following) router.refresh();
      else router.push(pathname);
    });

  const activeIndex = SEGMENTS.indexOf(activeSegment);
  const peeking = viewSegment !== activeSegment;
  const running = !ended && activeSegment !== "done";

  // One clock for both readouts (see lib/l10/use-now.ts).
  const now = useNow();
  const totalElapsed =
    now !== null && meetingStartedAtMs
      ? Math.floor((now - meetingStartedAtMs) / 1000)
      : null;
  const segmentBudget = SEGMENT_DURATION_SECONDS[activeSegment] ?? 0;
  const segmentElapsed =
    now !== null && startedAtMs ? Math.floor((now - startedAtMs) / 1000) : null;
  const segmentRemaining =
    segmentElapsed === null ? null : segmentBudget - segmentElapsed;
  const over =
    segmentRemaining !== null && segmentBudget > 0 && segmentRemaining < 0;

  return (
    <aside
      className={cn(
        "w-full rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900",
        // Pinned beside the scrolling content. `self-start` is load-bearing:
        // a stretched flex item is as tall as the row and can never stick.
        "lg:sticky lg:top-4 lg:w-60 lg:shrink-0 lg:self-start",
        "lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto",
      )}
    >
      <div className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {/* Clocks. Total counts up from meeting start; the segment counts
            down from its budget and is allowed to run negative — a group
            needs to see how far past 5 minutes the Segue actually went. */}
        <div className="px-3 py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Total
            </span>
            <span className="text-sm font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
              {totalElapsed === null ? "—:—" : formatClock(totalElapsed)}
              <span className="text-zinc-400 dark:text-zinc-500">
                {" / "}
                {formatClock(TOTAL_MEETING_SECONDS)}
              </span>
            </span>
          </div>

          <div className="mt-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {SEGMENT_LABELS[activeSegment]}
            </div>
            <div
              className={cn(
                "text-3xl font-semibold tabular-nums leading-tight",
                over
                  ? "text-red-600 dark:text-red-400"
                  : segmentRemaining !== null &&
                      segmentRemaining < 30 &&
                      segmentBudget > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-zinc-900 dark:text-zinc-100",
              )}
            >
              {segmentElapsed === null
                ? "—:—"
                : segmentBudget > 0
                  ? formatClock(segmentRemaining ?? 0)
                  : formatClock(segmentElapsed)}
              {over && (
                <span className="ml-1.5 align-middle text-[10px] font-medium uppercase">
                  over
                </span>
              )}
            </div>
            {segmentBudget > 0 && (
              <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                target {formatClock(segmentBudget)}
              </div>
            )}
          </div>

          {driverName && running && (
            <div
              className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-hpb-green/10 px-2 py-0.5 text-[11px] font-medium text-hpb-green ring-1 ring-inset ring-hpb-green/30"
              title="Designated meeting driver"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-hpb-green" />
              <span className="truncate">{driverName} is driving</span>
            </div>
          )}
        </div>

        {/* Whose turn it is, on every stage including Segue. It duplicates
            the rotation segment-segue.tsx renders in the content column, but
            the rail is the one place the answer is always in the same spot —
            a section that vanishes on stage 1 costs more than the repeat.
            Sits directly under the clocks: who's up and how long they have
            are the two things a facilitator reads together, and the agenda
            below is reference rather than something you watch. */}
        {running && (
          <SpeakingOrderRail
            teamId={teamId}
            meetingId={meetingId}
            order={speakingOrder}
            speakerIndex={speakerIndex}
            absentUserIds={absentUserIds}
            members={members}
          />
        )}

        {/* Agenda. Clicking a row peeks locally (?view=) — it never moves the
            group; only Back/Next below do that. */}
        <nav className="px-2 py-2">
          {running && (
            <div className="px-1 pb-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
              Step {Math.min(activeIndex + 1, SEGMENTS.length - 1)} of{" "}
              {SEGMENTS.length - 1}
            </div>
          )}
          <ul className="space-y-0.5">
            {VISIBLE.map((s, idx) => {
              const isActive = s === activeSegment;
              const isViewed = s === viewSegment;
              const isPast = idx < activeIndex;
              return (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => peek(s)}
                    disabled={ended}
                    aria-current={isViewed ? "step" : undefined}
                    title={
                      isActive
                        ? "Group is here"
                        : `Peek at ${SEGMENT_LABELS[s]} (just you)`
                    }
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition disabled:cursor-default",
                      isViewed
                        ? "bg-hpb-blue font-medium text-white"
                        : isActive
                          ? "bg-hpb-blue/10 font-medium text-hpb-blue hover:bg-hpb-blue/20"
                          : isPast
                            ? "text-hpb-green hover:bg-hpb-green/10"
                            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                    )}
                  >
                    <span
                      className={cn(
                        "w-3 shrink-0 text-[10px] tabular-nums",
                        isViewed ? "text-white/70" : "text-zinc-400",
                      )}
                    >
                      {isPast ? <Check className="h-3 w-3" /> : <>{idx + 1}</>}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {SEGMENT_LABELS[s]}
                    </span>
                    {isActive && !isViewed && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-hpb-blue" />
                    )}
                    <span
                      className={cn(
                        "shrink-0 text-[10px] tabular-nums",
                        isViewed ? "text-white/70" : "text-zinc-400",
                      )}
                    >
                      {Math.round(SEGMENT_DURATION_SECONDS[s] / 60)} MIN
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Context only — the catch-up control is the floating pill below,
              so there aren't two competing buttons for the same action. */}
          {running && peeking && (
            <p className="mt-2 rounded-md bg-hpb-blue/5 px-2 py-1.5 text-[11px] leading-snug text-zinc-600 dark:bg-hpb-blue/10 dark:text-zinc-300">
              Peeking at <strong>{SEGMENT_LABELS[viewSegment]}</strong>
              <br />
              Group is on <strong>{SEGMENT_LABELS[activeSegment]}</strong>
            </p>
          )}
        </nav>

        {/* Transport — drives the shared stage; any user. */}
        {running && (
          <div className="space-y-2 px-3 py-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => drive("prev")}
                disabled={driving || activeSegment === "segue"}
                className="flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => drive("next")}
                disabled={driving}
                className="flex-1 rounded-md bg-hpb-blue px-2 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40 disabled:opacity-60"
              >
                Next →
              </button>
            </div>
            <button
              type="button"
              onClick={finish}
              disabled={finishing}
              className={cn(
                "w-full rounded-md px-2 py-1.5 text-sm transition disabled:opacity-60",
                armed
                  ? "bg-red-600 font-medium text-white hover:brightness-110"
                  : "border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800",
              )}
            >
              {armed ? "End meeting?" : "Finish"}
            </button>
          </div>
        )}
      </div>

      {/* Floating catch-up. Deliberately `fixed`, not `sticky`: the page
          scrolls inside <main> (see components/app-shell.tsx), so a control
          living in the scrolled column drifts out of reach exactly when a
          peeker reading segment content needs it. This only ever moves *you*
          to the group — it never moves the group. */}
      {running && peeking && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <button
            type="button"
            onClick={goLive}
            className="inline-flex items-center gap-2 rounded-full bg-hpb-blue px-4 py-2 text-sm font-medium text-white shadow-lg shadow-black/20 ring-1 ring-inset ring-white/20 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/50"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            Group is on {SEGMENT_LABELS[activeSegment]} — Catch up
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </aside>
  );
}
