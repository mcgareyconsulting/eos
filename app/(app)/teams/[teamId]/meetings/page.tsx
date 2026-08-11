import Link from "next/link";
import { Timestamp } from "firebase-admin/firestore";
import { requireTeamAccess } from "@/lib/firebase/teams";
import { normalizeAgendaItems, type AgendaItem } from "@/lib/l10/agenda";
import { SEGMENT_LABELS } from "@/lib/l10/segments";
import { ensureDefaultAgendas } from "./actions";
import { AgendasPanel, type AgendaListItem } from "./agendas-panel";
import { MeetingsList, type MeetingListDoc } from "./meetings-list";
import { StartMeetingPicker } from "./start-meeting-picker";

type MeetingDoc = {
  team_id: string;
  started_at: Timestamp | null;
  ended_at: Timestamp | null;
  current_segment: keyof typeof SEGMENT_LABELS;
  notes: string | null;
  agenda_name?: string | null;
  agenda_items?: AgendaItem[];
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

  // Seed Level 10 + L10 Condensed the first time a team opens Meetings.
  await ensureDefaultAgendas(tid);

  const [snap, agendasSnap] = await Promise.all([
    db.collection("meetings").where("team_id", "==", tid).get(),
    db.collection("agendas").where("team_id", "==", tid).get(),
  ]);

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
      agenda_name: x.agenda_name ?? null,
      agenda_items: normalizeAgendaItems(x.agenda_items) ?? null,
    };
  });

  const agendas: AgendaListItem[] = agendasSnap.docs
    .map((d) => {
      const x = d.data();
      const items = normalizeAgendaItems(x.items) ?? [];
      return {
        id: d.id,
        name: String(x.name ?? "Agenda").trim() || "Agenda",
        items,
        is_default: !!x.is_default,
      };
    })
    .filter((a) => a.items.length > 0)
    .sort((a, b) => {
      // Default first, then name.
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      return a.name.localeCompare(b.name);
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
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
        <HeaderAction
          teamId={tid}
          meetings={initialMeetings}
          isLeader={isLeader}
          agendas={agendas}
        />
      </header>

      <AgendasPanel teamId={tid} agendas={agendas} canEdit={isLeader} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">History</h2>
        <MeetingsList
          teamId={tid}
          initialMeetings={initialMeetings}
          ratingsByMeeting={ratingsByMeeting}
        />
      </section>
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
  agendas,
}: {
  teamId: string;
  meetings: MeetingListDoc[];
  isLeader: boolean;
  agendas: AgendaListItem[];
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
  return <StartMeetingPicker teamId={teamId} agendas={agendas} />;
}
