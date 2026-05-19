import Link from "next/link";
import { Play, Calendar } from "lucide-react";
import { requireTeamAccess } from "@/lib/teams";
import { startMeeting } from "./actions";
import { SEGMENT_LABELS, type Segment } from "@/lib/l10/segments";

export default async function MeetingsListPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const { supabase, team } = await requireTeamAccess(teamId);

  const { data: meetings } = await supabase
    .from("meetings")
    .select(
      "id, started_at, ended_at, current_segment, segment_started_at, notes",
    )
    .eq("team_id", teamId)
    .order("started_at", { ascending: false })
    .limit(20);

  const active = (meetings ?? []).find((m) => !m.ended_at);
  const past = (meetings ?? []).filter((m) => m.ended_at);

  async function start() {
    "use server";
    await startMeeting(teamId);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">L10 Meetings</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {team.name}
          </p>
        </div>
        {active ? (
          <Link
            href={`/teams/${teamId}/meetings/${active.id}`}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 dark:bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 dark:hover:bg-emerald-400"
          >
            <Play className="w-4 h-4" />
            Rejoin meeting in progress
          </Link>
        ) : (
          <form action={start}>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200"
            >
              <Play className="w-4 h-4" />
              Start L10
            </button>
          </form>
        )}
      </header>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
          Past meetings ({past.length})
        </h2>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
          {past.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No past meetings yet.
            </div>
          )}
          {past.map((m) => (
            <Link
              key={m.id}
              href={`/teams/${teamId}/meetings/${m.id}`}
              className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <Calendar className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
              <div className="flex-1">
                <div className="font-medium">
                  {new Date(m.started_at).toLocaleString()}
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Ended {m.ended_at
                    ? new Date(m.ended_at).toLocaleString()
                    : ""}
                  {" · "}
                  {durationMinutes(m.started_at, m.ended_at)} min
                </div>
              </div>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                {
                  SEGMENT_LABELS[
                    (m.current_segment as Segment) ?? "done"
                  ]
                }
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function durationMinutes(startedAt: string, endedAt: string | null): number {
  if (!endedAt) return 0;
  return Math.round(
    (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000,
  );
}
