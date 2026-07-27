import { Plus } from "lucide-react";
import { Timestamp } from "firebase-admin/firestore";
import { requireTeamAccess } from "@/lib/firebase/teams";
import { SEGMENT_LABELS } from "@/lib/l10/segments";
import { startMeeting } from "./actions";
import { MeetingsList, type MeetingListDoc } from "./meetings-list";

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

  // Serialize for the client component: Timestamps become millis (the list
  // subscribes for live updates and re-normalizes onSnapshot Timestamps).
  const initialMeetings: MeetingListDoc[] = snap.docs.map((d) => {
    const x = d.data() as MeetingDoc;
    return {
      id: d.id,
      team_id: x.team_id,
      started_at: x.started_at?.toMillis?.() ?? null,
      ended_at: x.ended_at?.toMillis?.() ?? null,
      current_segment: x.current_segment,
    };
  });

  // Average meeting-effectiveness rating across all attendees, per meeting.
  // Bounded by team meeting history (a year of weekly L10s is ~52 reads).
  // Static: ratings only render on completed meetings, so the live list
  // doesn't need them to update in realtime.
  const ratingsByMeeting: Record<string, number | null> = {};
  await Promise.all(
    initialMeetings.map(async (m) => {
      const r = await db
        .collection("meetings")
        .doc(m.id)
        .collection("effectiveness_scores")
        .get();
      if (r.empty) {
        ratingsByMeeting[m.id] = null;
        return;
      }
      const ratings = r.docs.map(
        (d) => (d.data() as { rating: number }).rating,
      );
      ratingsByMeeting[m.id] =
        Math.round(
          (ratings.reduce((s, n) => s + n, 0) / ratings.length) * 10,
        ) / 10;
    }),
  );

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

      <MeetingsList
        teamId={tid}
        initialMeetings={initialMeetings}
        ratingsByMeeting={ratingsByMeeting}
      />
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
