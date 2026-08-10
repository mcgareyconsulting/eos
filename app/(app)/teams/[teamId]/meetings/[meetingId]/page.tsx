import Link from "next/link";
import { FileText, Video } from "lucide-react";
import { notFound } from "next/navigation";
import { Timestamp } from "firebase-admin/firestore";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import {
  type Segment,
  isSegment,
  normalizeSegment,
  SEGMENT_LABELS,
} from "@/lib/l10/segments";
import { reconcileSpeakingOrder } from "@/lib/l10/speaking-order";
import { parseWeekRange, type WeekRange } from "@/lib/scorecard";
import { loadScorecardEntries } from "@/lib/scorecard-entries";
import {
  oldestPeriodStart,
  parseScorecardPeriod,
  type ScorecardPeriod,
} from "@/lib/scorecard-periods";
import { endOfQuarter, toDateString } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { MeetingRail } from "./meeting-rail";
import { SegmentSegue } from "./segment-segue";
import { SegmentScorecard } from "./segment-scorecard";
import { SegmentRocks } from "./segment-rocks";
import { SegmentHeadlines } from "./segment-headlines";
import { SegmentTodos } from "./segment-todos";
import { SegmentIssues } from "./segment-issues";
import { ConcludeReview, type MeetingRating } from "./conclude-review";
import {
  RecapModal,
  type RecapItem,
  type RecapMeetingRating,
  type RecapStats,
} from "./recap-modal";

type MeetingDoc = {
  team_id: string;
  started_at: Timestamp | null;
  ended_at: Timestamp | null;
  current_segment: Segment;
  segment_started_at: Timestamp | null;
  current_issue_id?: string | null;
  notes: string | null;
  absent_user_ids?: string[];
  speaking_order?: string[];
  speaking_index?: number;
};

export default async function MeetingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string; meetingId: string }>;
  searchParams: Promise<{
    recap?: string;
    view?: string;
    weeks?: string;
    period?: string;
  }>;
}) {
  const { teamId: tid, meetingId: mid } = await params;
  const { recap, view, weeks: weeksParam, period: periodParam } =
    await searchParams;
  // Scorecard range + interval tabs (?weeks=, ?period=) — same params as the
  // standalone Scorecard page so L10 filters match.
  const scorecardWeekRange = parseWeekRange(weeksParam);
  const scorecardPeriod = parseScorecardPeriod(periodParam);
  const { uid, db, team, isAdmin, membershipRole } = await requireTeamAccess(tid);
  // Pass 18 #9: only a team leader (or org admin, god-mode bypass) may drive
  // the shared L10 transport — advance/rewind segments, Finish. Members keep
  // peeking + catch-up; MeetingRail hides the transport controls when this
  // is false. Mirrors the server-side gate in meetings/actions.ts.
  const isLeader = isAdmin || membershipRole === "leader";

  const meetingSnap = await db.collection("meetings").doc(mid).get();
  if (!meetingSnap.exists || meetingSnap.data()?.team_id !== tid) notFound();
  const m = meetingSnap.data() as MeetingDoc;

  const members = await getTeamMembers(tid);
  const absentUserIds = m.absent_user_ids ?? [];

  // Meetings started before the speaking order shipped have no stored order;
  // reconciling against the roster gives them the alphabetical fallback rather
  // than an empty rail, so no backfill is needed.
  const speakingOrder = reconcileSpeakingOrder(m.speaking_order, members);
  const speakerIndex = m.speaking_index ?? 0;

  // Designated facilitator (label-only) for the live control bar.
  const driverName =
    members.find((mm) => mm.user_id === team.meetingDriverId)?.full_name ??
    null;

  const ratingsSnap = await db
    .collection("meetings")
    .doc(mid)
    .collection("effectiveness_scores")
    .get();
  const ratings: MeetingRating[] = ratingsSnap.docs
    .map((d) => {
      const x = d.data();
      return {
        user_id: x.user_id ?? d.id,
        rating: x.rating,
        notes: x.notes ?? null,
      };
    })
    // Guard against legacy/malformed docs without a numeric rating — an
    // entry here would otherwise poison the averages (below, and in
    // ConcludeReview) into NaN.
    .filter((r): r is MeetingRating => Number.isFinite(r.rating));

  // The current viewer's own rating, if any — passed to the recap so it can
  // offer a "Rate this meeting" prompt when the post-Finish redirect opens
  // the recap over an unsubmitted rating (see RecapModal below).
  const myRating = ratings.find((r) => r.user_id === uid) ?? null;

  const live = !m.ended_at;
  // Normalize what's stored before rendering from it: an unknown/legacy
  // segment falls back to Segue rather than rendering an empty header, and
  // "done" on a meeting that never got ended_at (legacy stuck state — the
  // server no longer writes that combination) renders as Conclude so the
  // room can actually finish.
  const storedSegment: Segment = (() => {
    const n = normalizeSegment(m.current_segment) ?? "segue";
    return n === "done" && live ? "conclude" : n;
  })();
  const segmentStartedAtMs = m.segment_started_at?.toMillis?.() ?? null;
  const meetingStartedAtMs = m.started_at?.toMillis?.() ?? null;
  // Server-formatted so the rail can render it verbatim (no locale drift
  // between server and client → no hydration mismatch).
  const startedAtLabel =
    m.started_at?.toDate?.()?.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) ?? null;

  // Which stage THIS client is showing. With no ?view we follow the shared
  // active stage; a valid ?view lets the user peek elsewhere without moving
  // the group. The live active stage is reconciled client-side in MeetingRail.
  const viewParam = isSegment(view) && view !== "done" ? view : null;
  const viewSegment: Segment = viewParam ?? storedSegment;
  const following = viewParam === null;
  const showConclude = (live && viewSegment === "conclude") || !live;

  // Recap modal data: items created in the meeting window. Only fetched when
  // the recap modal is requested AND the meeting has actually ended.
  const meetingMinutes =
    m.started_at && m.ended_at
      ? Math.max(
          1,
          Math.round((m.ended_at.toMillis() - m.started_at.toMillis()) / 60000),
        )
      : null;

  const showRecap = (recap === "1" || !live) && !!m.ended_at;
  let newRocks: RecapItem[] = [];
  let newTodos: RecapItem[] = [];
  let newIssues: RecapItem[] = [];
  let issuesSolved: RecapItem[] = [];
  let newHeadlines: RecapItem[] = [];
  let attendeeRatings: RecapMeetingRating[] = [];
  let overallAverageRating: number | null = null;
  let recapStats: RecapStats = {
    totalTrackedIssues: 0,
    issuesSolvedToday: 0,
    solveRatePercent: null,
  };
  if (showRecap && m.started_at && m.ended_at) {
    const startedMs = m.started_at.toMillis();
    const endedMs = m.ended_at.toMillis();
    const memberName = (id: string | null | undefined) =>
      id ? (members.find((mm) => mm.user_id === id)?.full_name ?? null) : null;
    const inWindow = (ts: Timestamp | null | undefined) => {
      const ms = ts?.toMillis?.() ?? 0;
      return ms >= startedMs && ms <= endedMs;
    };

    // Single team-scoped fetch each, filter in memory.
    const [rocksSnap, todosSnap, issuesSnap, headlinesSnap] = await Promise.all(
      [
        db.collection("rocks").where("team_id", "==", tid).get(),
        db.collection("todos").where("team_id", "==", tid).get(),
        db.collection("issues").where("team_id", "==", tid).get(),
        db.collection("headlines").where("team_id", "==", tid).get(),
      ],
    );

    newRocks = rocksSnap.docs
      .map((d) => ({ id: d.id, x: d.data() }))
      .filter(({ x }) => inWindow(x.created_at as Timestamp | null))
      .map(({ id, x }) => ({
        id,
        title: x.title,
        owner_name: memberName(x.owner_id),
      }));

    // Exclude milestone-style todos (those tied to a rock); recap should show
    // standalone to-dos created during the meeting.
    newTodos = todosSnap.docs
      .map((d) => ({ id: d.id, x: d.data() }))
      .filter(
        ({ x }) =>
          inWindow(x.created_at as Timestamp | null) && !x.source_rock_id,
      )
      .map(({ id, x }) => ({
        id,
        title: x.title,
        owner_name: memberName(x.owner_id),
      }));

    const allIssues = issuesSnap.docs.map((d) => ({ id: d.id, x: d.data() }));
    newIssues = allIssues
      .filter(({ x }) => inWindow(x.created_at as Timestamp | null))
      .map(({ id, x }) => ({
        id,
        title: x.title,
        owner_name: memberName(x.owner_id),
      }));
    issuesSolved = allIssues
      .filter(
        ({ x }) =>
          x.status === "solved" && inWindow(x.resolved_at as Timestamp | null),
      )
      .map(({ id, x }) => ({
        id,
        title: x.title,
        owner_name: memberName(x.owner_id),
      }));

    // Short-term issue health snapshot. "Total tracked" = currently open,
    // short-term. Solve rate = solved-today / (open-at-start + solved-today).
    // Both terms are short-term only — the issuesSolved *list* above shows
    // everything solved, but mixing long-term solves into a short-term
    // denominator produced >100%-flavored nonsense.
    const shortTerm = allIssues.filter(
      ({ x }) => (x.type ?? "short") === "short",
    );
    const openNow = shortTerm.filter(({ x }) => x.status === "open").length;
    const solvedToday = shortTerm.filter(
      ({ x }) =>
        x.status === "solved" && inWindow(x.resolved_at as Timestamp | null),
    ).length;
    const denominator = openNow + solvedToday;
    recapStats = {
      totalTrackedIssues: openNow,
      issuesSolvedToday: solvedToday,
      solveRatePercent:
        denominator > 0 ? Math.round((solvedToday / denominator) * 100) : null,
    };

    newHeadlines = headlinesSnap.docs
      .map((d) => ({ id: d.id, x: d.data() }))
      .filter(({ x }) => inWindow(x.created_at as Timestamp | null))
      .map(({ id, x }) => ({
        id,
        title: x.title,
        owner_name: memberName(x.created_by),
      }));

    // Each attendee's own rating of the meeting (not a peer average).
    const ratingByUser = new Map<string, number>();
    ratings.forEach((r) => ratingByUser.set(r.user_id, r.rating));
    attendeeRatings = members.map((mm) => ({
      user_id: mm.user_id,
      full_name: mm.full_name,
      rating: ratingByUser.get(mm.user_id) ?? null,
      absent: absentUserIds.includes(mm.user_id),
    }));
    // Average over present attendees only — a rating from someone marked
    // absent renders as "Absent" in the list, so it must not silently move
    // the number next to it.
    const presentRatings = ratings.filter(
      (r) => !absentUserIds.includes(r.user_id),
    );
    overallAverageRating =
      presentRatings.length === 0
        ? null
        : Math.round(
            (presentRatings.reduce((sum, r) => sum + r.rating, 0) /
              presentRatings.length) *
              10,
          ) / 10;
  }

  return (
    // Two columns during a live meeting: the timing/agenda rail is pinned on
    // the left while the segment content scrolls beside it. Completed
    // meetings render the rail-less single column (the rail has nothing to
    // drive), which the `live &&` below handles on its own.
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Focus mode, read by AppShell via :has() — a running L10 is a
          full-screen tool, and the global nav next to the meeting's own rail
          cost enough width that the Scorecard clipped its week columns. Only
          while live: a finished meeting is an ordinary page you browse to. */}
      {live && <div data-meeting-focus hidden />}

      {live && (
        <MeetingRail
          teamId={tid}
          meetingId={mid}
          viewSegment={viewSegment}
          following={following}
          initialSegment={storedSegment}
          initialStartedAtMs={segmentStartedAtMs}
          meetingStartedAtMs={meetingStartedAtMs}
          startedAtLabel={startedAtLabel}
          initialEnded={!live}
          driverName={driverName}
          members={members}
          initialSpeakingOrder={speakingOrder}
          initialSpeakerIndex={speakerIndex}
          initialAbsentUserIds={absentUserIds}
          isLeader={isLeader}
        />
      )}

      {/* pb-24 while live: the rail's "Catch up" pill is `fixed` at
          bottom-6 and floats over this column, so the last row of a segment
          needs room to scroll clear of it instead of sitting underneath. */}
      <div className={cn("min-w-0 flex-1 space-y-6", live && "pb-24")}>
        {/* Live: one compact header line — the stage is the headline, the
            team L10 is context. Everything static (start time, back link)
            lives in the rail, so content starts ~150px higher than when this
            page stacked breadcrumb + h1 + started-at + stage + hint. */}
        {live && viewSegment !== "done" && (
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {SEGMENT_LABELS[viewSegment]}
                </h1>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {team.name} L10
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {/* Join the team's Google Meet room. DEMO: opens the standing
                team Meet link a leader set in Members → Meeting settings. In
                the real integration this href would be a per-meeting URL
                minted by the Meet REST API (spaces.create) at meeting start. */}
              {team.meetLink && (
                <a
                  href={team.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-hpb-green px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-green/40"
                >
                  <Video className="h-4 w-4" />
                  Join Google Meet
                </a>
              )}
            </div>
          </header>
        )}

        {/* Completed: an ordinary page with the ordinary chrome. */}
        {!live && (
          <>
            <div className="text-xs">
              <Link
                href={`/teams/${tid}/meetings`}
                className="text-hpb-blue hover:underline"
              >
                ← Meetings
              </Link>
            </div>
            <header className="flex items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  {team.name} L10
                </h1>
              </div>
              <Link
                href={`/teams/${tid}/meetings/${mid}?recap=1`}
                className="inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
              >
                <FileText className="h-4 w-4" />
                View recap
              </Link>
            </header>
          </>
        )}

        {/* Segment content follows the locally-viewed stage (peek-aware). */}
        {live && viewSegment !== "done" && (
          <section>
            <SegmentContent
              teamId={tid}
              userId={uid}
              meetingId={mid}
              segment={viewSegment}
              currentIssueId={m.current_issue_id ?? null}
              members={members}
              absentUserIds={absentUserIds}
              speakingOrder={speakingOrder}
              speakerIndex={speakerIndex}
              scorecardWeekRange={scorecardWeekRange}
              scorecardPeriod={scorecardPeriod}
            />
          </section>
        )}

        {/* Meeting review — notes + end-of-meeting meeting rating.
          Only surfaced in the Conclude segment (live) or on the completed
          meeting page. Hidden during Segue/Scorecard/Rocks/etc. */}
        {showConclude && (
          <ConcludeReview
            teamId={tid}
            meetingId={mid}
            currentUserId={uid}
            members={members}
            absentUserIds={absentUserIds}
            ratings={ratings}
            notes={m.notes ?? null}
            readOnly={!live}
          />
        )}

        <RecapModal
          teamId={tid}
          meetingId={mid}
          myRating={myRating}
          meetingMinutes={meetingMinutes}
          notes={m.notes ?? null}
          newRocks={newRocks}
          newTodos={newTodos}
          newIssues={newIssues}
          issuesSolved={issuesSolved}
          newHeadlines={newHeadlines}
          stats={recapStats}
          attendeeRatings={attendeeRatings}
          overallAverageRating={overallAverageRating}
          // Never auto-open on a live meeting: the data above is only
          // fetched once ended_at exists, so a shared/stale ?recap=1 link
          // would open an all-empty recap over the running L10.
          autoOpen={recap === "1" && !live}
        />
      </div>
    </div>
  );
}

// Server-side initial fetch + dispatch to the right live segment component.
async function SegmentContent({
  teamId,
  userId,
  meetingId,
  segment,
  currentIssueId,
  members,
  absentUserIds,
  speakingOrder,
  speakerIndex,
  scorecardWeekRange,
  scorecardPeriod,
}: {
  teamId: string;
  userId: string;
  meetingId: string;
  segment: Segment;
  currentIssueId: string | null;
  members: { user_id: string; full_name: string }[];
  absentUserIds: string[];
  speakingOrder: string[];
  speakerIndex: number;
  scorecardWeekRange: WeekRange;
  scorecardPeriod: ScorecardPeriod;
}) {
  // The roster is already in scope from the page's getTeamMembers call, so
  // Segue needs no fetch of its own.
  if (segment === "segue") {
    return (
      <SegmentSegue
        teamId={teamId}
        meetingId={meetingId}
        userId={userId}
        members={members}
        initialSpeakingOrder={speakingOrder}
        initialSpeakerIndex={speakerIndex}
        initialAbsentUserIds={absentUserIds}
      />
    );
  }

  const { db } = await requireTeamAccess(teamId);

  if (segment === "scorecard") {
    const metricsSnap = await db
      .collection("scorecard_metrics")
      .where("team_id", "==", teamId)
      .get();
    const initialMetrics = metricsSnap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        team_id: x.team_id,
        name: x.name,
        unit: x.unit,
        goal: x.goal ?? null,
        direction: x.direction,
        owner_id: x.owner_id ?? null,
        group: x.group ?? null,
        interval: (x.interval as string | null | undefined) ?? "weekly",
        sort_order: x.sort_order ?? 0,
      };
    });
    const oldest = oldestPeriodStart(scorecardPeriod, scorecardWeekRange);
    const initialEntries = await loadScorecardEntries(
      db,
      initialMetrics.map((m) => m.id),
      oldest,
    );
    return (
      <SegmentScorecard
        teamId={teamId}
        meetingId={meetingId}
        weekRange={scorecardWeekRange}
        period={scorecardPeriod}
        initialMetrics={initialMetrics}
        initialEntries={initialEntries}
        members={members}
        speakingOrder={speakingOrder}
        absentUserIds={absentUserIds}
      />
    );
  }

  if (segment === "rocks") {
    // Milestones are team-visible todos only — matching the client
    // subscription's visibility filter, and keeping other members' private
    // todo titles out of the serialized page payload.
    const [rocksSnap, todosSnap] = await Promise.all([
      db.collection("rocks").where("team_id", "==", teamId).get(),
      db
        .collection("todos")
        .where("team_id", "==", teamId)
        .where("visibility", "==", "team")
        .get(),
    ]);
    const initialRocks = rocksSnap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        team_id: x.team_id,
        title: x.title,
        owner_id: x.owner_id ?? null,
        quarter: x.quarter,
        due_date: x.due_date ?? null,
        status: x.status,
        description: x.description ?? null,
        rock_type: x.rock_type ?? null,
      };
    });
    const initialTodos = todosSnap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        team_id: x.team_id,
        title: x.title,
        owner_id: x.owner_id ?? null,
        due_date: x.due_date ?? null,
        completed_at: x.completed_at ? true : null,
        source_rock_id: x.source_rock_id ?? null,
        description: x.description ?? null,
      };
    });
    return (
      <SegmentRocks
        teamId={teamId}
        meetingId={meetingId}
        userId={userId}
        defaultDue={toDateString(endOfQuarter())}
        initialRocks={initialRocks}
        initialTodos={initialTodos}
        members={members}
        initialAbsentUserIds={absentUserIds}
        initialSpeakingOrder={speakingOrder}
        initialSpeakerIndex={speakerIndex}
      />
    );
  }

  if (segment === "headlines") {
    const snap = await db
      .collection("headlines")
      .where("team_id", "==", teamId)
      .get();
    const initialHeadlines = snap.docs.map((d) => {
      const x = d.data();
      const t = x.created_at as Timestamp | null;
      const archived = x.archived_at as Timestamp | null | undefined;
      return {
        id: d.id,
        team_id: x.team_id,
        title: x.title,
        body: x.body ?? null,
        kind: x.kind,
        created_by: x.created_by ?? null,
        created_at: t?.toMillis?.() ?? null,
        discussed: x.discussed === true,
        archived_at: archived?.toMillis?.() ?? null,
        broadcast: !!x.broadcast,
        from_label: x.from_label ?? null,
        source_owner_name: x.source_owner_name ?? null,
      };
    });
    return (
      <SegmentHeadlines
        teamId={teamId}
        meetingId={meetingId}
        userId={userId}
        initialHeadlines={initialHeadlines}
        members={members}
      />
    );
  }

  if (segment === "todos") {
    // Team-visible only: the client subscription filters the same way, and
    // an unfiltered fetch serialized other members' PRIVATE todo titles into
    // the page payload (view-source visible) even though the UI hid them.
    const snap = await db
      .collection("todos")
      .where("team_id", "==", teamId)
      .where("visibility", "==", "team")
      .get();
    const initialTodos = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        team_id: x.team_id,
        title: x.title,
        description: x.description ?? null,
        owner_id: x.owner_id ?? null,
        due_date: x.due_date ?? null,
        completed_at: x.completed_at ? true : null,
        archived_at: x.archived_at ? true : null,
        visibility: x.visibility ?? "team",
        source_rock_id: x.source_rock_id ?? null,
      };
    });
    return (
      <SegmentTodos
        teamId={teamId}
        meetingId={meetingId}
        userId={userId}
        initialTodos={initialTodos}
        members={members}
        initialSpeakingOrder={speakingOrder}
        initialAbsentUserIds={absentUserIds}
        initialSpeakerIndex={speakerIndex}
      />
    );
  }

  if (segment === "issues") {
    const [issuesSnap, votesSnap] = await Promise.all([
      db.collection("issues").where("team_id", "==", teamId).get(),
      db
        .collection("issue_votes")
        .where("user_id", "==", userId)
        .where("team_id", "==", teamId)
        .get(),
    ]);
    const initialIssues = issuesSnap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        team_id: x.team_id,
        title: x.title,
        description: x.description ?? null,
        owner_id: x.owner_id ?? null,
        priority: x.priority ?? null,
        votes: x.votes ?? 0,
        type: x.type ?? "short",
        status: x.status ?? "open",
        archived_at: x.archived_at ? true : null,
      };
    });
    const initialVotes = votesSnap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        issue_id: x.issue_id,
        user_id: x.user_id,
        team_id: x.team_id,
        count: typeof x.count === "number" ? x.count : 1,
      };
    });
    return (
      <SegmentIssues
        teamId={teamId}
        meetingId={meetingId}
        userId={userId}
        initialIssues={initialIssues}
        initialVotes={initialVotes}
        initialCurrentIssueId={currentIssueId}
        members={members}
      />
    );
  }

  // conclude / others — no embedded content.
  return null;
}
