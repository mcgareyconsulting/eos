"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserX, UserCheck } from "lucide-react";
import { collection } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import { RatingForm } from "@/components/l10/rating-form";
import { saveMeetingNotes, rateMeeting, setAttendeeAbsence } from "../actions";

type Member = { user_id: string; full_name: string };

export type MeetingRating = {
  user_id: string;
  rating: number;
  notes: string | null;
};

export function ConcludeReview({
  teamId,
  meetingId,
  currentUserId,
  members,
  absentUserIds,
  ratings: initialRatings,
  notes,
  readOnly = false,
}: {
  teamId: string;
  meetingId: string;
  currentUserId: string;
  members: Member[];
  absentUserIds: string[];
  ratings: MeetingRating[];
  notes: string | null;
  /** Concluded meeting: history is browsable but attendance is frozen. */
  readOnly?: boolean;
}) {
  const db = getClientDb();

  // Ratings stream live — the end-of-meeting moment is everyone rating at
  // once, and a one-shot server fetch left every screen stuck on its own
  // stale average until the viewer submitted something themselves.
  const ratingsQuery = useMemo(
    () => collection(db, "meetings", meetingId, "effectiveness_scores"),
    [db, meetingId],
  );
  const liveRatings = useCollection<{
    id: string;
    user_id?: string;
    rating?: number;
    notes?: string | null;
  }>(ratingsQuery, initialRatings.map((r) => ({ id: r.user_id, ...r })));
  const ratings: MeetingRating[] = liveRatings
    .map((d) => ({
      user_id: d.user_id ?? d.id,
      rating: d.rating as number,
      notes: d.notes ?? null,
    }))
    // Same malformed-doc guard as the server render — never let a bad doc
    // poison the average into NaN.
    .filter((r) => Number.isFinite(r.rating));

  // Peers = everyone on the team other than me — used for attendance only.
  const peers = members.filter((m) => m.user_id !== currentUserId);
  const myRating = ratings.find((r) => r.user_id === currentUserId) ?? null;
  const absent = new Set(absentUserIds);
  // Absent members' rows render "Absent", so their scores must not move the
  // number shown next to them (mirrors the recap's average).
  const presentRatings = ratings.filter((r) => !absent.has(r.user_id));
  const average =
    presentRatings.length === 0
      ? null
      : Math.round(
          (presentRatings.reduce((sum, r) => sum + r.rating, 0) /
            presentRatings.length) *
            10,
        ) / 10;
  const ratedIds = new Set(ratings.map((r) => r.user_id));
  const waitingOn = members.filter(
    (m) => !absent.has(m.user_id) && !ratedIds.has(m.user_id),
  );

  return (
    <div className="space-y-6">
      <NotesCard
        teamId={teamId}
        meetingId={meetingId}
        initialNotes={notes}
        readOnly={readOnly}
      />

      <section className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            {readOnly ? "Meeting rating" : "Rate this meeting"}
          </h2>
          <span className="text-xs text-zinc-600 dark:text-zinc-400">
            {presentRatings.length === 0
              ? "No ratings yet"
              : `Avg ${average?.toFixed(1)} · ${presentRatings.length} ${
                  presentRatings.length === 1 ? "rating" : "ratings"
                }`}
          </span>
        </header>

        <MeetingRatingWidget
          teamId={teamId}
          meetingId={meetingId}
          myRating={myRating}
          readOnly={readOnly}
        />

        {(ratings.length > 0 || waitingOn.length > 0) && (
          <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800 pt-3 space-y-2">
            {ratings.length > 0 && (
              <ul className="space-y-1 text-sm">
                {ratings.map((r) => {
                  const member = members.find((m) => m.user_id === r.user_id);
                  return (
                    <li
                      key={r.user_id}
                      className="text-zinc-700 dark:text-zinc-300"
                    >
                      <span className="font-medium">
                        {member?.full_name ?? "Member"}
                      </span>{" "}
                      <span className="text-hpb-blue font-semibold">
                        {r.rating}
                      </span>
                      {absent.has(r.user_id) && (
                        <span className="ml-1 text-xs uppercase tracking-wide text-zinc-500">
                          absent
                        </span>
                      )}
                      {r.notes && (
                        <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                          — {r.notes}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {!readOnly && waitingOn.length > 0 && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Waiting on {waitingOn.map((m) => m.full_name).join(", ")}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Attendance
          </h2>
          {readOnly && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              as recorded at the meeting
            </span>
          )}
        </header>

        {peers.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No other teammates on this team.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {peers.map((peer) => (
              <AttendanceCard
                key={peer.user_id}
                teamId={teamId}
                meetingId={meetingId}
                peer={peer}
                isAbsent={absent.has(peer.user_id)}
                readOnly={readOnly}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MeetingRatingWidget({
  teamId,
  meetingId,
  myRating,
  readOnly,
}: {
  teamId: string;
  meetingId: string;
  myRating: MeetingRating | null;
  readOnly: boolean;
}) {
  const router = useRouter();

  // Concluded + already rated: the form is the hole (N32). First write
  // after Finish is still allowed so recap catch-up works.
  if (readOnly && myRating) {
    return (
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        Your rating:{" "}
        <span className="font-semibold text-hpb-blue">{myRating.rating}</span>
        {myRating.notes ? (
          <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
            — {myRating.notes}
          </span>
        ) : null}
        <span className="mt-1 block text-xs text-zinc-500">
          Final — ratings cannot be changed after the meeting ends.
        </span>
      </p>
    );
  }

  async function submit(score: number, notes: string) {
    const fd = new FormData();
    fd.set("rating", String(score));
    fd.set("notes", notes);
    await rateMeeting(teamId, meetingId, fd);
    router.refresh();
  }

  return (
    <RatingForm
      initialScore={myRating?.rating ?? null}
      initialNotes={myRating?.notes ?? ""}
      submitAction={submit}
    />
  );
}

// Debounce for notes autosave — long enough to not fire mid-sentence, short
// enough that clicking Finish right after typing can't lose more than this.
const NOTES_AUTOSAVE_MS = 1500;

function NotesCard({
  teamId,
  meetingId,
  initialNotes,
  readOnly = false,
}: {
  teamId: string;
  meetingId: string;
  initialNotes: string | null;
  readOnly?: boolean;
}) {
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  // Autosave: notes used to save only on an explicit button click, and the
  // natural end of a meeting — type notes, hit Finish — silently discarded
  // everything typed. Save after a pause and on blur; the button remains as
  // reassurance.
  const lastSaved = useRef(initialNotes ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function persist(value: string) {
    if (readOnly) return;
    if (value === lastSaved.current) return;
    const fd = new FormData();
    fd.set("notes", value);
    start(async () => {
      await saveMeetingNotes(teamId, meetingId, fd);
      lastSaved.current = value;
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  useEffect(() => {
    if (readOnly) return;
    if (notes === lastSaved.current) return;
    timer.current = setTimeout(() => persist(notes), NOTES_AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, readOnly]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    persist(notes);
  }

  if (readOnly) {
    return (
      <section className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Meeting notes
        </h2>
        {initialNotes?.trim() ? (
          <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
            {initialNotes}
          </p>
        ) : (
          <p className="text-sm text-zinc-500">No notes recorded.</p>
        )}
      </section>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3"
    >
      <div className="flex items-baseline justify-between">
        <label
          htmlFor="notes"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Meeting notes
        </label>
        {pending ? (
          <span className="text-xs text-zinc-500">Saving…</span>
        ) : saved ? (
          <span className="text-xs text-hpb-green">Saved</span>
        ) : null}
      </div>
      <textarea
        id="notes"
        name="notes"
        rows={6}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => persist(notes)}
        placeholder="Decisions, key discussions, anything to remember for the next L10…"
        className="block w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hpb-blue/30"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save notes"}
      </button>
    </form>
  );
}

function AttendanceCard({
  teamId,
  meetingId,
  peer,
  isAbsent,
  readOnly,
}: {
  teamId: string;
  meetingId: string;
  peer: Member;
  isAbsent: boolean;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pendingAbsence, startAbsence] = useTransition();

  const initials = peer.full_name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  function toggleAbsence() {
    startAbsence(async () => {
      await setAttendeeAbsence(teamId, meetingId, peer.user_id, !isAbsent);
      router.refresh();
    });
  }

  return (
    <div
      className={
        "flex items-center justify-between gap-2 rounded-lg border p-3 transition " +
        (isAbsent
          ? "border-zinc-300 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 opacity-70"
          : "border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900")
      }
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-hpb-blue/10 text-hpb-blue text-xs font-semibold ring-1 ring-inset ring-hpb-blue/30">
          {initials || "?"}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{peer.full_name}</div>
          {isAbsent && (
            <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
              Marked absent
            </div>
          )}
        </div>
      </div>
      {readOnly ? (
        <span className="text-[11px] font-medium text-zinc-500">
          {isAbsent ? "Absent" : "Present"}
        </span>
      ) : (
        <button
          type="button"
          onClick={toggleAbsence}
          disabled={pendingAbsence}
          className={
            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-50 " +
            (isAbsent
              ? "border-hpb-green/40 text-hpb-green hover:bg-hpb-green/10"
              : "border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800")
          }
          aria-label={isAbsent ? "Mark present" : "Mark absent"}
        >
          {isAbsent ? (
            <>
              <UserCheck className="h-3 w-3" /> Present
            </>
          ) : (
            <>
              <UserX className="h-3 w-3" /> Absent
            </>
          )}
        </button>
      )}
    </div>
  );
}
