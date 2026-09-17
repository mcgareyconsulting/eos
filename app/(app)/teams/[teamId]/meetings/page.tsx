import Link from "next/link";
import { Video } from "lucide-react";
import { entityHeaderControlBase } from "@/components/entity-page-header";
import { cn } from "@/lib/utils";
import { Timestamp } from "firebase-admin/firestore";
import { getTeamMembers, requireTeamAccess } from "@/lib/firebase/teams";
import {
  normalizeAgendaItems,
  type AgendaItem,
  type AgendaOption,
} from "@/lib/l10/agenda";
import { SEGMENT_LABELS } from "@/lib/l10/segments";
import { isStaleLiveMeeting } from "@/lib/l10/driver";
import { AgendasPanel, StartMeetingPicker } from "./agendas";
import { MeetingsList, type MeetingListDoc } from "./meetings-list";
import { setMeetLink } from "./actions";
import { SpeakingOrderEditor } from "./speaking-order-editor";
import { Eyebrow } from "@/components/ui/text";

type MeetingDoc = {
  team_id: string;
  started_at: Timestamp | null;
  ended_at: Timestamp | null;
  current_segment: keyof typeof SEGMENT_LABELS;
  segment_started_at?: Timestamp | null;
  notes: string | null;
  agenda_name?: string | null;
  agenda_items?: AgendaItem[];
};

// Not a component: reading the clock inside one is render-impure (and the
// React Compiler lint says so). Per-request is exactly the right resolution
// here — this page is server-rendered on demand.
function resolveLiveMeeting(
  meetings: MeetingListDoc[],
): MeetingListDoc | null {
  const nowMs = Date.now();
  return (
    meetings.find(
      (m) =>
        m.ended_at == null &&
        !isStaleLiveMeeting({
          lastActivityMs:
            typeof m.last_activity_at === "number" ? m.last_activity_at : null,
          nowMs,
        }),
    ) ?? null
  );
}

export default async function MeetingsPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId: tid } = await params;
  const { db, team, isAdmin, membershipRole } = await requireTeamAccess(tid);
  // Starting a meeting is open to everyone on the team — whoever starts it
  // drives it (lib/l10/driver.ts). Leader/admin still gates *authoring*
  // agenda templates and deleting meeting history, which are not the same
  // kind of act as running today's L10.
  const isLeader = isAdmin || membershipRole === "leader";

  const snap = await db.collection("meetings").where("team_id", "==", tid).get();

  // The team's custom agendas (built-ins are in code — no seed). Read by
  // everyone now, not just leaders: a member who can start a meeting but can
  // only pick the built-in Level 10 would be starting the wrong meeting for
  // any team that wrote its own agenda. Editing them is still leader-only
  // (AgendasPanel below, and the server actions).
  // Skip legacy auto-seeded docs (`${teamId}__l10`) so they don't duplicate
  // the built-in Level 10 / L10 Condensed rows.
  const customs: AgendaOption[] = (
    await db.collection("agendas").where("team_id", "==", tid).get()
  ).docs
    .filter((d) => d.id !== `${tid}__l10` && d.id !== `${tid}__l10-condensed`)
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
    .sort((a, b) => a.name.localeCompare(b.name));

  const initialMeetings: MeetingListDoc[] = snap.docs.map((d) => {
    const x = d.data() as MeetingDoc;
    return {
      id: d.id,
      team_id: x.team_id,
      started_at: x.started_at?.toMillis?.() ?? null,
      ended_at: x.ended_at?.toMillis?.() ?? null,
      last_activity_at:
        x.segment_started_at?.toMillis?.() ?? x.started_at?.toMillis?.() ?? null,
      current_segment: x.current_segment,
      agenda_name: x.agenda_name ?? null,
      agenda_items: normalizeAgendaItems(x.agenda_items) ?? null,
    };
  });

  // Which room (if any) the header should offer to join. See HeaderAction.
  const liveMeeting = resolveLiveMeeting(initialMeetings);

  // Roster for the speaking-order editor; leaders only need it.
  const members = isLeader ? await getTeamMembers(tid) : [];

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
          liveMeeting={liveMeeting}
          customs={customs}
        />
      </header>

      {isLeader && <AgendasPanel teamId={tid} customs={customs} />}

      {isLeader && (
        <section className="space-y-2">
          <Eyebrow as="h2" size="md">
            Meeting settings
          </Eyebrow>
          <div className="space-y-4 rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <form action={setMeetLink.bind(null, tid)}>
              <label
                htmlFor="meet_link"
                className="flex items-center gap-1.5 text-sm font-medium"
              >
                <Video className="h-4 w-4 text-hpb-green" />
                Google Meet link
              </label>
              <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                The standing Meet room for this team&rsquo;s L10. Members join it
                from the live meeting.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id="meet_link"
                  name="meet_link"
                  type="url"
                  inputMode="url"
                  placeholder="https://meet.google.com/abc-defg-hij"
                  defaultValue={team.meetLink ?? ""}
                  className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-green/40"
                />
                <button
                  type="submit"
                  className="rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
                >
                  Save
                </button>
              </div>
            </form>

            <SpeakingOrderEditor
              teamId={tid}
              members={members}
              storedOrder={team.speakingOrder}
              canEdit
            />
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">History</h2>
        <MeetingsList
          teamId={tid}
          initialMeetings={initialMeetings}
          ratingsByMeeting={ratingsByMeeting}
          canDelete={isLeader}
        />
      </section>
    </div>
  );
}

function HeaderAction({
  teamId,
  liveMeeting,
  customs,
}: {
  teamId: string;
  /** The room to join, or null to offer Start. A meeting nobody pressed
   *  Finish on stays `ended_at == null` forever, so the page resolves this
   *  against the abandoned-meeting cutoff (lib/l10/driver.ts) rather than on
   *  `ended_at` alone — otherwise the team is offered "Join live meeting"
   *  into last week's room and never sees the Start button, which is the
   *  click that reaps it. */
  liveMeeting: MeetingListDoc | null;
  customs: AgendaOption[];
}) {
  if (liveMeeting) {
    return (
      <Link
        href={`/teams/${teamId}/meetings/${liveMeeting.id}`}
        // Green rather than brand blue on purpose — a live meeting is a
        // state, not an action — but the geometry is the shared one so it
        // lines up with Start meeting, which occupies the same slot.
        className={cn(
          entityHeaderControlBase,
          "min-w-[11rem] bg-hpb-green text-white hover:brightness-110 focus-visible:ring-hpb-green/40",
        )}
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
        Join live meeting
      </Link>
    );
  }
  return <StartMeetingPicker teamId={teamId} customs={customs} />;
}
