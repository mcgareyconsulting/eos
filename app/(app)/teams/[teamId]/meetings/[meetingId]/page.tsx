import Link from "next/link";
import { notFound } from "next/navigation";
import { Timestamp } from "firebase-admin/firestore";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import {
  SEGMENTS,
  SEGMENT_LABELS,
  SEGMENT_HINTS,
  type Segment,
} from "@/lib/l10/segments";
import {
  currentQuarter,
  endOfQuarter,
  lastNMondays,
  toDateString,
} from "@/lib/dates";
import {
  advanceSegment,
  endMeeting,
  rateMeeting,
  saveMeetingNotes,
} from "../actions";
import { MeetingPresence } from "@/components/meeting-presence";
import { SegmentTimer } from "./segment-timer";
import { SegmentScorecard } from "./segment-scorecard";
import { SegmentRocks } from "./segment-rocks";
import { SegmentHeadlines } from "./segment-headlines";
import { SegmentTodos } from "./segment-todos";
import { SegmentIDS } from "./segment-ids";

type MeetingDoc = {
  team_id: string;
  started_at: Timestamp | null;
  ended_at: Timestamp | null;
  current_segment: Segment;
  segment_started_at: Timestamp | null;
  notes: string | null;
};

const SCORECARD_WEEKS = 8;

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ teamId: string; meetingId: string }>;
}) {
  const { teamId: tid, meetingId: mid } = await params;
  const { uid, db, team } = await requireTeamAccess(tid);
  const { name, email } = await requireFirebaseUser();
  const displayName = (name ?? email ?? "Member").trim();

  const meetingSnap = await db.collection("meetings").doc(mid).get();
  if (!meetingSnap.exists || meetingSnap.data()?.team_id !== tid) notFound();
  const m = meetingSnap.data() as MeetingDoc;

  const members = await getTeamMembers(tid);

  const ratingsSnap = await db
    .collection("meetings")
    .doc(mid)
    .collection("ratings")
    .get();
  const ratings = ratingsSnap.docs.map(
    (d) => d.data() as { user_id: string; score: number },
  );
  const myRating = ratings.find((r) => r.user_id === uid)?.score ?? null;
  const avgRating =
    ratings.length === 0
      ? null
      : Math.round(
          (ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length) * 10,
        ) / 10;

  const live = !m.ended_at;
  const segmentIndex = SEGMENTS.indexOf(m.current_segment);
  const segmentStartedAtMs = m.segment_started_at?.toMillis?.() ?? null;

  return (
    <div className="space-y-6">
      <div className="text-xs text-zinc-500">
        <Link
          href={`/teams/${tid}/meetings`}
          className="text-blue-600 underline"
        >
          ← Meetings
        </Link>
      </div>

      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {team.name} L10
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
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
        </div>
      </header>

      {/* Segment progress */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {SEGMENTS.filter((s) => s !== "done").map((s, idx) => {
            const isCurrent = s === m.current_segment;
            const isPast = idx < segmentIndex;
            return (
              <div
                key={s}
                className={
                  "rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap " +
                  (isCurrent
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : isPast
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400")
                }
              >
                {SEGMENT_LABELS[s]}
              </div>
            );
          })}
        </div>

        {live && m.current_segment !== "done" && (
          <div className="mt-3 flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <div className="text-lg font-semibold">
                  {SEGMENT_LABELS[m.current_segment]}
                </div>
                <SegmentTimer
                  segment={m.current_segment}
                  startedAtMs={segmentStartedAtMs}
                />
              </div>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {SEGMENT_HINTS[m.current_segment]}
              </p>
            </div>
            <div className="flex gap-2">
              <form action={advanceSegment.bind(null, tid, mid, "prev")}>
                <button
                  type="submit"
                  className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  ← Back
                </button>
              </form>
              <form action={advanceSegment.bind(null, tid, mid, "next")}>
                <button
                  type="submit"
                  className="rounded-md bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Next →
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Segment content — live, team-filtered */}
      {live && m.current_segment !== "done" && m.current_segment !== "segue" && (
        <section>
          <SegmentContent
            teamId={tid}
            userId={uid}
            segment={m.current_segment}
            members={members}
          />
        </section>
      )}

      {/* Notes */}
      <form
        action={saveMeetingNotes.bind(null, tid, mid)}
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3"
      >
        <label
          htmlFor="notes"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Meeting notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={6}
          defaultValue={m.notes ?? ""}
          placeholder="Decisions, key discussions, anything to remember for the next L10…"
          className="block w-full rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Save notes
        </button>
      </form>

      {/* Rating */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Rate this meeting (1–10)
        </h2>
        <form
          action={rateMeeting.bind(null, tid, mid)}
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <label
              key={n}
              className={
                "flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border text-sm " +
                (myRating === n
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800")
              }
            >
              <input
                type="radio"
                name="score"
                value={n}
                defaultChecked={myRating === n}
                className="sr-only"
              />
              {n}
            </label>
          ))}
          <button
            type="submit"
            className="ml-auto rounded-md bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Save rating
          </button>
        </form>
        {avgRating != null && (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Team average: <span className="font-medium">{avgRating}</span>{" "}
            across {ratings.length} {ratings.length === 1 ? "rating" : "ratings"}.
          </p>
        )}
      </div>
    </div>
  );
}

// Server-side initial fetch + dispatch to the right live segment component.
async function SegmentContent({
  teamId,
  userId,
  segment,
  members,
}: {
  teamId: string;
  userId: string;
  segment: Segment;
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
        priority: x.priority ?? 3,
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
        userId={userId}
        initialIssues={initialIssues}
        initialVotes={initialVotes}
        members={members}
      />
    );
  }

  // conclude / others — no embedded content.
  return null;
}
