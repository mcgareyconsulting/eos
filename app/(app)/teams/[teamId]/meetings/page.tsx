import Link from "next/link";
import { Timestamp } from "firebase-admin/firestore";
import { requireTeamAccess } from "@/lib/firebase/teams";
import { SEGMENT_LABELS } from "@/lib/l10/segments";
import { startMeeting } from "./actions";
import { MeetingsList, type MeetingListDoc } from "./meetings-list";
import { StartMeetingButton } from "./start-meeting-button";

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
  const { db, isAdmin, membershipRole } = await requireTeamAccess(tid);
  // Pass 18 #9: starting the shared L10 room is a facilitator control —
  // startMeeting requires leader/admin server-side, so don't show members a
  // Start button that would 404. Join-live stays open to everyone.
  const isLeader = isAdmin || membershipRole === "leader";

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
      const ratings = r.docs
        .map((d) => (d.data() as { rating: number }).rating)
        // Same malformed-doc guard as the detail page — one bad rating
        // otherwise renders a NaN star badge.
        .filter((n) => Number.isFinite(n));
      if (ratings.length === 0) {
        ratingsByMeeting[m.id] = null;
        return;
      }
      ratingsByMeeting[m.id] =
        Math.round(
          (ratings.reduce((s, n) => s + n, 0) / ratings.length) * 10,
        ) / 10;
    }),
  );

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
        <HeaderAction
          teamId={tid}
          meetings={initialMeetings}
          isLeader={isLeader}
        />
      </header>

      <MeetingsList
        teamId={tid}
        initialMeetings={initialMeetings}
        ratingsByMeeting={ratingsByMeeting}
      />
    </div>
  );
}

// "Start meeting" — or, when the team already has a live meeting, a Resume
// link into it. The server action also guards against duplicate live
// meetings, but the button saying the right thing matters more for a
// latecomer scanning the page.
function HeaderAction({
  teamId,
  meetings,
  isLeader,
}: {
  teamId: string;
  meetings: MeetingListDoc[];
  isLeader: boolean;
}) {
  const liveMeeting = meetings.find((m) => m.ended_at == null);
  if (liveMeeting) {
    return (
      <Link
        href={`/teams/${teamId}/meetings/${liveMeeting.id}`}
        className="inline-flex items-center gap-1.5 rounded-md bg-hpb-green px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-green/40"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
        Join live meeting
      </Link>
    );
  }
  if (!isLeader) return null;
  async function action() {
    "use server";
    await startMeeting(teamId);
  }
  return <StartMeetingButton action={action} />;
}
