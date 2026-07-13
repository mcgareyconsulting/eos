"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserX, UserCheck } from "lucide-react";
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
  ratings,
  notes,
}: {
  teamId: string;
  meetingId: string;
  currentUserId: string;
  members: Member[];
  absentUserIds: string[];
  ratings: MeetingRating[];
  notes: string | null;
}) {
  // Peers = everyone on the team other than me — used for attendance only.
  const peers = members.filter((m) => m.user_id !== currentUserId);
  const myRating = ratings.find((r) => r.user_id === currentUserId) ?? null;
  const average =
    ratings.length === 0
      ? null
      : Math.round(
          (ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length) *
            10,
        ) / 10;

  return (
    <div className="space-y-6">
      <NotesCard teamId={teamId} meetingId={meetingId} initialNotes={notes} />

      <section className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Rate this meeting
          </h2>
          <span className="text-xs text-zinc-600 dark:text-zinc-400">
            {ratings.length === 0
              ? "No ratings yet"
              : `Avg ${average?.toFixed(1)} · ${ratings.length} ${
                  ratings.length === 1 ? "rating" : "ratings"
                }`}
          </span>
        </header>

        <MeetingRatingWidget
          teamId={teamId}
          meetingId={meetingId}
          myRating={myRating}
        />

        {ratings.length > 0 && (
          <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800 pt-3">
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              {ratings.map((r) => {
                const member = members.find((m) => m.user_id === r.user_id);
                return (
                  <li
                    key={r.user_id}
                    className="text-zinc-700 dark:text-zinc-300"
                    title={r.notes ?? undefined}
                  >
                    <span className="font-medium">
                      {member?.full_name ?? "Member"}
                    </span>{" "}
                    <span className="text-hpb-blue font-semibold">
                      {r.rating}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <header className="mb-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Attendance
          </h2>
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
                isAbsent={absentUserIds.includes(peer.user_id)}
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
}: {
  teamId: string;
  meetingId: string;
  myRating: MeetingRating | null;
}) {
  const router = useRouter();

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

function NotesCard({
  teamId,
  meetingId,
  initialNotes,
}: {
  teamId: string;
  meetingId: string;
  initialNotes: string | null;
}) {
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("notes", notes);
    start(async () => {
      await saveMeetingNotes(teamId, meetingId, fd);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
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
        {saved && (
          <span className="text-xs text-hpb-green">Saved</span>
        )}
      </div>
      <textarea
        id="notes"
        name="notes"
        rows={6}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
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
}: {
  teamId: string;
  meetingId: string;
  peer: Member;
  isAbsent: boolean;
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
    </div>
  );
}
