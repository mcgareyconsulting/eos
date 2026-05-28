"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useAuthUid } from "@/lib/firebase/use-collection";
import {
  SEGMENTS,
  SEGMENT_LABELS,
  SEGMENT_HINTS,
  type Segment,
} from "@/lib/l10/segments";
import { advanceSegment } from "../actions";
import { SegmentTimer } from "./segment-timer";

const VISIBLE = SEGMENTS.filter((s) => s !== "done");

// Live orchestrator chrome. The active stage + timer live on the meeting doc
// and stream to every client (last-write-wins). Each user may peek at another
// stage locally (?view=) without moving the group; "following" users snap to
// the active stage whenever it changes.
export function MeetingLive({
  teamId,
  meetingId,
  viewSegment,
  following,
  initialSegment,
  initialStartedAtMs,
  initialEnded,
}: {
  teamId: string;
  meetingId: string;
  viewSegment: Segment;
  following: boolean;
  initialSegment: Segment;
  initialStartedAtMs: number | null;
  initialEnded: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Live shared state from the meeting-doc snapshot, or null until it arrives.
  // We derive the displayed values below, falling back to the server-rendered
  // props — so the control bar is correct on every (re)render even if the
  // snapshot lags or is blocked, and the snapshot layers cross-client updates
  // on top when permitted.
  const [live, setLive] = useState<{
    segment: Segment;
    startedAtMs: number | null;
    ended: boolean;
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
          | { toMillis?: () => number }
          | null
          | undefined;
        setLive({
          segment: (x.current_segment as Segment) ?? "segue",
          startedAtMs: ts?.toMillis?.() ?? null,
          ended: x.ended_at != null,
        });
      },
      (e) => console.error("[meeting-live] subscribe:", e),
    );
    return unsub;
  }, [meetingId, uid]);

  const activeSegment = live?.segment ?? initialSegment;
  const startedAtMs = live?.startedAtMs ?? initialStartedAtMs;
  const ended = live?.ended ?? initialEnded;

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
  const pct = Math.min(
    ((activeIndex + 1) / (SEGMENTS.length - 1)) * 100,
    100,
  );

  return (
    <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      {!ended && (
        <>
          <div className="mb-3 flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
            <span>
              Step {Math.min(activeIndex + 1, SEGMENTS.length - 1)} of{" "}
              {SEGMENTS.length - 1}
            </span>
            <span>{Math.round(pct)}%</span>
          </div>
          <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full bg-hpb-blue transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      )}

      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {VISIBLE.map((s, idx) => {
          const isActive = s === activeSegment;
          const isViewed = s === viewSegment;
          const isPast = idx < activeIndex;
          const cls =
            "relative rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition ring-1 ring-inset " +
            (isViewed
              ? "bg-hpb-blue text-white ring-hpb-blue/30"
              : isActive
                ? "bg-hpb-blue/10 text-hpb-blue ring-hpb-blue/40"
                : isPast
                  ? "bg-hpb-green/10 text-hpb-green ring-hpb-green/30 hover:bg-hpb-green/20"
                  : "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700");
          return (
            <button
              key={s}
              type="button"
              onClick={() => peek(s)}
              disabled={ended}
              className={cls}
              aria-current={isViewed ? "step" : undefined}
              title={
                isActive
                  ? "Group is here"
                  : `Peek at ${SEGMENT_LABELS[s]} (just you)`
              }
            >
              {SEGMENT_LABELS[s]}
              {isActive && !isViewed && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-hpb-blue align-middle" />
              )}
            </button>
          );
        })}
      </div>

      {/* Peek banner — you're viewing a stage the group isn't on. */}
      {!ended && peeking && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-hpb-blue/5 px-3 py-2 text-xs text-zinc-600 dark:bg-hpb-blue/10 dark:text-zinc-300">
          <span>
            Peeking at <strong>{SEGMENT_LABELS[viewSegment]}</strong> · group is
            on <strong>{SEGMENT_LABELS[activeSegment]}</strong>
          </span>
          <button
            type="button"
            onClick={goLive}
            className="font-medium text-hpb-blue hover:underline"
          >
            Return to live
          </button>
        </div>
      )}

      {/* Active-stage control row (drives the shared stage; any user). */}
      {!ended && activeSegment !== "done" && (
        <div className="mt-3 flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <div className="text-lg font-semibold">
                {SEGMENT_LABELS[activeSegment]}
              </div>
              <SegmentTimer segment={activeSegment} startedAtMs={startedAtMs} />
            </div>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {SEGMENT_HINTS[activeSegment]}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => drive("prev")}
              disabled={driving || activeSegment === "segue"}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-40 dark:hover:bg-zinc-800"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => drive("next")}
              disabled={driving}
              className="rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40 disabled:opacity-60"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
