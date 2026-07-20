import Link from "next/link";
import { FileText, Video } from "lucide-react";
import { notFound } from "next/navigation";
import { Timestamp } from "firebase-admin/firestore";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { type Segment, isSegment } from "@/lib/l10/segments";
import {
  currentQuarter,
  endOfQuarter,
  lastNMondays,
  toDateString,
} from "@/lib/dates";
import { endMeeting } from "../actions";
import { MeetingPresence } from "@/components/meeting-presence";
import { MeetingLive } from "./meeting-live";
import { SegmentScorecard } from "./segment-scorecard";
import { SegmentRocks } from "./segment-rocks";
import { SegmentHeadlines } from "./segment-headlines";
import { SegmentTodos } from "./segment-todos";
import { SegmentIDS } from "./segment-ids";
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
};

const SCORECARD_WEEKS = 13;

export default async function MeetingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string; meetingId: string }>;
  searchParams: Promise<{ recap?: string; view?: string }>;
}) {
  const { teamId: tid, meetingId: mid } = await params;
  const { recap, view } = await searchParams;
  const { uid, db, team } = await requireTeamAccess(tid);
  const { name, email } = await requireFirebaseUser();
  const displayName = (name ?? email ?? "Member").trim();

  const meetingSnap = await db.collection("meetings").doc(mid).get();
  if (!meetingSnap.exists || meetingSnap.data()?.team_id !== tid) notFound();
  const m = meetingSnap.data() as MeetingDoc;

  const members = await getTeamMembers(tid);
  const absentUserIds = m.absent_user_ids ?? [];

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

  const live = !m.ended_at;
  const segmentStartedAtMs = m.segment_started_at?.toMillis?.() ?? null;

  // Which stage THIS client is showing. With no ?view we follow the shared
  // active stage; a valid ?view lets the user peek elsewhere without moving
  // the group. The live active stage is reconciled client-side in MeetingLive.
  const viewParam = isSegment(view) && view !== "done" ? view : null;
  const viewSegment: Segment = viewParam ?? m.current_segment;
  const following = viewParam === null;
  const showConclude = (live && viewSegment === "conclude") || !live;

  // Recap modal data: items created in the meeting window. Only fetched when
  // the recap modal is requested AND the meeting has actually ended.
  const meetingMinutes =
    m.started_at && m.ended_at
      ? Math.max(
          1,
          Math.round(
            (m.ended_at.toMillis() - m.started_at.toMillis()) / 60000,
          ),
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
      id ? members.find((mm) => mm.user_id === id)?.full_name ?? null : null;
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
          x.status === "solved" &&
          inWindow(x.resolved_at as Timestamp | null),
      )
      .map(({ id, x }) => ({
        id,
        title: x.title,
        owner_name: memberName(x.owner_id),
      }));

    // Short-term issue health snapshot. "Total tracked" = currently open,
    // short-term. Solve rate = solved-today / (open-at-start + solved-today).
    const shortTerm = allIssues.filter(
      ({ x }) => (x.type ?? "short") === "short",
    );
    const openNow = shortTerm.filter(({ x }) => x.status === "open").length;
    const solvedToday = issuesSolved.length;
    const denominator = openNow + solvedToday;
    recapStats = {
      totalTrackedIssues: openNow,
      issuesSolvedToday: solvedToday,
      solveRatePercent:
        denominator > 0
          ? Math.round((solvedToday / denominator) * 100)
          : null,
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
    overallAverageRating =
      ratings.length === 0
        ? null
        : Math.round(
            (ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length) *
              10,
          ) / 10;
  }

  return (
    <div className="space-y-6">
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
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Started{" "}
            {m.started_at?.toDate?.()?.toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }) ?? "—"}
            {live ? " · in progress" : " · completed"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {live && (
            <MeetingPresence
              meetingId={mid}
              userId={uid}
              displayName={displayName}
            />
          )}
          {/* Join the team's Google Meet room. DEMO: opens the standing team
              Meet link a leader set in Members → Meeting settings. In the real
              integration this href would be a per-meeting URL minted by the
              Meet REST API (spaces.create) at meeting start. */}
          {live && team.meetLink && (
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
          {live && (
            <form action={endMeeting.bind(null, tid, mid)}>
              <button
                type="submit"
                className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                End meeting
              </button>
            </form>
          )}
          {!live && (
            <Link
              href={`/teams/${tid}/meetings/${mid}?recap=1`}
              className="inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
            >
              <FileText className="h-4 w-4" />
              View recap
            </Link>
          )}
        </div>
      </header>

      <MeetingLive
        teamId={tid}
        meetingId={mid}
        viewSegment={viewSegment}
        following={following}
        initialSegment={m.current_segment}
        initialStartedAtMs={segmentStartedAtMs}
        initialEnded={!live}
        driverName={driverName}
      />

      {/* Segment content follows the locally-viewed stage (peek-aware). */}
      {live && viewSegment !== "done" && viewSegment !== "segue" && (
        <section>
          <SegmentContent
            teamId={tid}
            userId={uid}
            meetingId={mid}
            segment={viewSegment}
            currentIssueId={m.current_issue_id ?? null}
            members={members}
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
        />
      )}

      <RecapModal
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
        autoOpen={recap === "1"}
      />
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
}: {
  teamId: string;
  userId: string;
  meetingId: string;
  segment: Segment;
  currentIssueId: string | null;
  members: { user_id: string; full_name: string }[];
}) {
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
        sort_order: x.sort_order ?? 0,
      };
    });
    const weeks = lastNMondays(SCORECARD_WEEKS).map(toDateString);
    const oldest = weeks[weeks.length - 1];
    const entrySnap = initialMetrics.length
      ? await db
          .collection("scorecard_entries")
          .where(
            "metric_id",
            "in",
            initialMetrics.map((m) => m.id).slice(0, 30),
          )
          .where("week_start_date", ">=", oldest)
          .get()
      : null;
    const initialEntries =
      entrySnap?.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          metric_id: x.metric_id,
          week_start_date: x.week_start_date,
          value: x.value ?? null,
        };
      }) ?? [];
    return (
      <SegmentScorecard
        teamId={teamId}
        weeks={weeks}
        initialMetrics={initialMetrics}
        initialEntries={initialEntries}
        members={members}
      />
    );
  }

  if (segment === "rocks") {
    const [rocksSnap, todosSnap] = await Promise.all([
      db.collection("rocks").where("team_id", "==", teamId).get(),
      db.collection("todos").where("team_id", "==", teamId).get(),
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
        quarter={currentQuarter()}
        defaultDue={toDateString(endOfQuarter())}
        initialRocks={initialRocks}
        initialTodos={initialTodos}
        members={members}
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
      return {
        id: d.id,
        team_id: x.team_id,
        title: x.title,
        body: x.body ?? null,
        kind: x.kind,
        created_by: x.created_by ?? null,
        created_at: t?.toMillis?.() ?? null,
      };
    });
    return (
      <SegmentHeadlines
        teamId={teamId}
        userId={userId}
        initialHeadlines={initialHeadlines}
        members={members}
      />
    );
  }

  if (segment === "todos") {
    const snap = await db
      .collection("todos")
      .where("team_id", "==", teamId)
      .get();
    const initialTodos = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        team_id: x.team_id,
        title: x.title,
        owner_id: x.owner_id ?? null,
        due_date: x.due_date ?? null,
        completed_at: x.completed_at ? true : null,
        visibility: x.visibility ?? "team",
        source_rock_id: x.source_rock_id ?? null,
      };
    });
    return (
      <SegmentTodos
        teamId={teamId}
        userId={userId}
        initialTodos={initialTodos}
        members={members}
      />
    );
  }

  if (segment === "ids") {
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
      <SegmentIDS
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
