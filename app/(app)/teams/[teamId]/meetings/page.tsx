import Link from "next/link";
import { Timestamp } from "firebase-admin/firestore";
import { requireTeamAccess } from "@/lib/firebase/teams";
import {
  normalizeAgendaItems,
  type AgendaItem,
  type AgendaOption,
} from "@/lib/l10/agenda";
import { SEGMENT_LABELS } from "@/lib/l10/segments";
import { AgendasPanel, StartMeetingPicker } from "./agendas";
import { MeetingsList, type MeetingListDoc } from "./meetings-list";

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
  // Start meeting + agenda management: leader/admin only.
  // Join-live stays open to everyone.
  const isLeader = isAdmin || membershipRole === "leader";

  const snap = await db.collection("meetings").where("team_id", "==", tid).get();

  // Custom agendas only for leaders (built-ins are in code — no seed).
  // Skip legacy auto-seeded docs (`${teamId}__l10`) so they don't duplicate
  // the built-in Level 10 / L10 Condensed rows.
  const customs: AgendaOption[] = isLeader
    ? (
        await db.collection("agendas").where("team_id", "==", tid).get()
      ).docs
        .filter(
          (d) =>
            d.id !== `${tid}__l10` && d.id !== `${tid}__l10-condensed`,
        )
        .map((d) => {
          const x = d.data();
          const items = normalizeAgendaItems(x.items) ?? [];
          return {
            id: d.id,
            name: String(x.name ?? "Agenda").trim() || "Agenda",
            items,
          };
        })
        .filter((a) => a.items.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

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
          customs={customs}
        />
      </header>

      {isLeader && <AgendasPanel teamId={tid} customs={customs} />}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">
          {isLeader ? "History" : "Meetings"}
        </h2>
        <MeetingsList
          teamId={tid}
          initialMeetings={initialMeetings}
          ratingsByMeeting={ratingsByMeeting}
        />
      </section>
    </div>
  );
}

function HeaderAction({
  teamId,
  meetings,
  isLeader,
  customs,
}: {
  teamId: string;
  meetings: MeetingListDoc[];
  isLeader: boolean;
  customs: AgendaOption[];
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
  return <StartMeetingPicker teamId={teamId} customs={customs} />;
}
