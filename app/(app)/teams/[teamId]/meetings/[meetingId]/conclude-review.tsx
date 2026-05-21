"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserX, UserCheck } from "lucide-react";
import { saveMeetingNotes, scoreAttendee, setAttendeeAbsence } from "../actions";

type Member = { user_id: string; full_name: string };

export type AttendeeScore = {
  rater_user_id: string;
  rated_user_id: string;
  score: number;
  notes: string | null;
};

export function ConcludeReview({
  teamId,
  meetingId,
  currentUserId,
  members,
  absentUserIds,
  scores,
  notes,
}: {
  teamId: string;
  meetingId: string;
  currentUserId: string;
  members: Member[];
  absentUserIds: string[];
  scores: AttendeeScore[];
  notes: string | null;
}) {
  // Peers = everyone on the team other than me.
  const peers = members.filter((m) => m.user_id !== currentUserId);

  return (
    <div className="space-y-6">
      <NotesCard teamId={teamId} meetingId={meetingId} initialNotes={notes} />

      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Score teammates (1–10)
          </h2>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Peer effectiveness · your scores stay attributed to you
          </span>
        </header>

        {peers.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No teammates to score on this team.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {peers.map((peer) => {
              const isAbsent = absentUserIds.includes(peer.user_id);
              const peerScores = scores.filter(
                (s) => s.rated_user_id === peer.user_id,
              );
              const mine = peerScores.find(
                (s) => s.rater_user_id === currentUserId,
              );
              const peerAvg =
                peerScores.length === 0
                  ? null
                  : Math.round(
                      (peerScores.reduce((sum, s) => sum + s.score, 0) /
                        peerScores.length) *
                        10,
                    ) / 10;

              return (
                <AttendeeCard
                  key={peer.user_id}
                  teamId={teamId}
                  meetingId={meetingId}
                  peer={peer}
                  isAbsent={isAbsent}
                  myScore={mine?.score ?? null}
                  myNotes={mine?.notes ?? ""}
                  teamAvg={peerAvg}
                  ratingCount={peerScores.length}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
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
      className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3"
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

function AttendeeCard({
  teamId,
  meetingId,
  peer,
  isAbsent,
  myScore,
  myNotes,
  teamAvg,
  ratingCount,
}: {
  teamId: string;
  meetingId: string;
  peer: Member;
  isAbsent: boolean;
  myScore: number | null;
  myNotes: string;
  teamAvg: number | null;
  ratingCount: number;
}) {
  const router = useRouter();
  const [score, setScore] = useState<number | null>(myScore);
  const [notes, setNotes] = useState(myNotes);
  const [pendingScore, startScore] = useTransition();
  const [pendingAbsence, startAbsence] = useTransition();
  const [saved, setSaved] = useState(false);

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

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (score == null) return;
    const fd = new FormData();
    fd.set("score", String(score));
    fd.set("notes", notes);
    startScore(async () => {
      await scoreAttendee(teamId, meetingId, peer.user_id, fd);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  return (
    <div
      className={
        "rounded-lg border p-3 transition " +
        (isAbsent
          ? "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 opacity-70"
          : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900")
      }
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-hpb-blue/10 text-hpb-blue text-xs font-semibold ring-1 ring-inset ring-hpb-blue/30">
            {initials || "?"}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{peer.full_name}</div>
            {teamAvg != null && !isAbsent && (
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Team avg {teamAvg.toFixed(1)} · {ratingCount}{" "}
                {ratingCount === 1 ? "score" : "scores"}
              </div>
            )}
            {isAbsent && (
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
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
      </header>

      {!isAbsent && (
        <form onSubmit={save} className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-1">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScore(n)}
                className={
                  "h-7 w-7 rounded-md border text-xs font-medium transition " +
                  (score === n
                    ? "border-hpb-blue bg-hpb-blue text-white"
                    : "border-zinc-300 hover:border-hpb-blue/40 hover:bg-hpb-blue/5 dark:border-zinc-700 dark:hover:bg-hpb-blue/10")
                }
              >
                {n}
              </button>
            ))}
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Notes (optional)"
            className="block w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-hpb-blue/30"
          />
          <div className="flex items-center justify-end gap-2">
            {saved && (
              <span className="text-[11px] text-hpb-green">Saved</span>
            )}
            <button
              type="submit"
              disabled={pendingScore || score == null}
              className="rounded-md bg-hpb-blue px-2.5 py-1 text-xs font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40 disabled:opacity-50"
            >
              {pendingScore ? "Saving…" : myScore != null ? "Update" : "Save"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
