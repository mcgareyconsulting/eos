import Link from "next/link";
import { Plus, Star, Trash2, Calendar } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Timestamp } from "firebase-admin/firestore";
import { requireTeamAccess } from "@/lib/firebase/teams";
import { SEGMENT_LABELS, SEGMENTS } from "@/lib/l10/segments";
import { durationMinutes } from "@/lib/dates";
import { deleteMeeting, startMeeting } from "./actions";

type MeetingDoc = {
  team_id: string;
  started_at: Timestamp | null;
  ended_at: Timestamp | null;
  current_segment: keyof typeof SEGMENT_LABELS;
  notes: string | null;
};

export default async function MeetingsPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId: tid } = await params;
  const { db, team } = await requireTeamAccess(tid);

  const snap = await db.collection("meetings").where("team_id", "==", tid).get();

  const meetings = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as MeetingDoc) }))
    .sort((a, b) => {
      const at = a.started_at?.toMillis?.() ?? 0;
      const bt = b.started_at?.toMillis?.() ?? 0;
      return bt - at;
    });

  // Average meeting-effectiveness rating across all attendees, per meeting.
  // Bounded by team meeting history (a year of weekly L10s is ~52 reads).
  const ratingsByMeeting = new Map<string, number | null>();
  await Promise.all(
    meetings.map(async (m) => {
      const r = await db
        .collection("meetings")
        .doc(m.id)
        .collection("effectiveness_scores")
        .get();
      if (r.empty) {
        ratingsByMeeting.set(m.id, null);
        return;
      }
      const ratings = r.docs.map(
        (d) => (d.data() as { rating: number }).rating,
      );
      const avg =
        Math.round(
          (ratings.reduce((s, n) => s + n, 0) / ratings.length) * 10,
        ) / 10;
      ratingsByMeeting.set(m.id, avg);
    }),
  );

  const segmentCount = SEGMENTS.length - 1; // exclude "done"

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {team.name} · Level 10 weekly meetings
          </p>
        </div>
        <StartMeetingButton teamId={tid} />
      </header>

      <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
        {meetings.length === 0 && (
          <EmptyState
            icon={Calendar}
            title="No meetings yet"
            hint="Click “Start meeting” to run your first timed Level 10."
          />
        )}
        {meetings.map((m) => {
          const started = m.started_at?.toDate?.();
          const ended = m.ended_at?.toDate?.();
          const live = !ended;
          const remove = deleteMeeting.bind(null, tid, m.id);
          const avg = ratingsByMeeting.get(m.id);

          const duration =
            started && ended
              ? durationMinutes(started.toISOString(), ended.toISOString())
              : null;

          const segIdx = SEGMENTS.indexOf(m.current_segment);
          const stepNumber =
            live && segIdx >= 0 ? Math.min(segIdx + 1, segmentCount) : null;

          return (
            <div
              key={m.id}
              className="group flex items-center gap-4 px-4 py-3 text-sm"
            >
              <Link
                href={`/teams/${tid}/meetings/${m.id}`}
                className="flex-1 min-w-0"
              >
                <div className="font-medium">
                  {started?.toLocaleString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }) ?? "—"}
                </div>
                <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                  {live
                    ? `In progress · Step ${stepNumber} of ${segmentCount} · ${SEGMENT_LABELS[m.current_segment] ?? m.current_segment}`
                    : `Completed · ${duration ?? "—"} min`}
                </div>
              </Link>

              {!live && avg != null && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-hpb-gold/15 px-2 py-0.5 text-xs font-medium text-hpb-brown dark:text-hpb-gold ring-1 ring-inset ring-hpb-gold/40"
                  title={`Team average rating`}
                >
                  <Star className="h-3 w-3 fill-current" />
                  {avg.toFixed(1)}
                </span>
              )}

              {live && (
                <span className="inline-flex items-center gap-1 rounded-full bg-hpb-green/10 px-2 py-0.5 text-xs font-medium text-hpb-green ring-1 ring-inset ring-hpb-green/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-hpb-green animate-pulse" />
                  Live
                </span>
              )}

              <form action={remove}>
                <button
                  type="submit"
                  className="text-zinc-300 dark:text-zinc-600 hover:text-red-600 opacity-0 group-hover:opacity-100"
                  aria-label="Delete meeting"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </form>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StartMeetingButton({ teamId }: { teamId: string }) {
  async function action() {
    "use server";
    await startMeeting(teamId);
  }
  return (
    <form action={action}>
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
      >
        <Plus className="h-4 w-4" />
        Start meeting
      </button>
    </form>
  );
}
