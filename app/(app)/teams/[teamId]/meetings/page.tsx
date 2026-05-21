import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Timestamp } from "firebase-admin/firestore";
import { requireTeamAccess } from "@/lib/firebase/teams";
import { SEGMENT_LABELS } from "@/lib/l10/segments";
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

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {team.name} · Level 10 weekly meetings
          </p>
        </div>
        <StartMeetingButton teamId={tid} />
      </header>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
        {meetings.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No meetings yet. Click &quot;Start meeting&quot; to begin.
          </div>
        )}
        {meetings.map((m) => {
          const started = m.started_at?.toDate?.();
          const ended = m.ended_at?.toDate?.();
          const live = !ended;
          const remove = deleteMeeting.bind(null, tid, m.id);

          const duration =
            started && ended
              ? durationMinutes(started.toISOString(), ended.toISOString())
              : null;

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
                <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {live
                    ? `In progress · ${SEGMENT_LABELS[m.current_segment] ?? m.current_segment}`
                    : `Completed · ${duration ?? "—"} min`}
                </div>
              </Link>

              {live && (
                <span className="rounded-full bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-200">
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
        className="rounded-md bg-zinc-900 dark:bg-zinc-100 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Start meeting
      </button>
    </form>
  );
}
