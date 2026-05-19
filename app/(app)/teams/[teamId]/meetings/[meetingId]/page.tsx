import { notFound } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Circle, Target, Users, UserCircle2 } from "lucide-react";

import { requireTeamAccess, getTeamMembers, onTrack } from "@/lib/teams";
import { SEGMENT_HINTS, type Segment } from "@/lib/l10/segments";
import { lastNMondays, mondayOf, toDateString } from "@/lib/dates";

import { AgendaTimer } from "@/components/l10/agenda-timer";
import { SegmentNav } from "@/components/l10/segment-nav";
import { AdvanceButton } from "@/components/l10/advance-button";
import { DropToIssuesButton } from "@/components/l10/drop-to-issues-button";
import { RatingForm } from "@/components/l10/rating-form";

import {
  setSegment,
  advanceSegment,
  endMeeting,
  submitRating,
  dropToIssues,
} from "../actions";
import { SolveButton } from "../../issues/solve-button";
import { PrioritySelect } from "../../issues/priority-select";
import { VoteButton } from "../../issues/vote-button";
import { ValueCell } from "../../scorecard/value-cell";
import { TodoToggle } from "./todo-toggle";

export default async function L10Page({
  params,
}: {
  params: Promise<{ teamId: string; meetingId: string }>;
}) {
  const { teamId, meetingId } = await params;
  const { user, supabase, team } = await requireTeamAccess(teamId);

  const { data: meeting } = await supabase
    .from("meetings")
    .select(
      "id, team_id, started_at, ended_at, current_segment, segment_started_at, notes",
    )
    .eq("id", meetingId)
    .single();
  if (!meeting) notFound();

  const segment = (meeting.current_segment as Segment) ?? "segue";
  const members = await getTeamMembers(teamId);
  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  // Bound server actions for this meeting.
  const advanceFn = advanceSegment.bind(null, teamId, meetingId, segment);
  const endFn = endMeeting.bind(null, teamId, meetingId);
  const setSegmentFn = async (s: Segment) => {
    "use server";
    await setSegment(teamId, meetingId, s);
  };
  const dropFn = async (title: string, description?: string) => {
    "use server";
    await dropToIssues(teamId, meetingId, title, description);
  };
  const rateFn = async (score: number) => {
    "use server";
    await submitRating(teamId, meetingId, score);
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <Link
            href={`/teams/${teamId}/meetings`}
            className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline"
          >
            ← Meetings
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {team.name} · L10
          </h1>
        </div>
        <AdvanceButton
          current={segment}
          advanceAction={advanceFn}
          endAction={endFn}
        />
      </header>

      {segment !== "done" && (
        <AgendaTimer
          segment={segment}
          segmentStartedAt={meeting.segment_started_at}
          meetingStartedAt={meeting.started_at}
        />
      )}

      <div className="grid grid-cols-12 gap-6">
        <aside className="col-span-3">
          <SegmentNav current={segment} setSegmentAction={setSegmentFn} />
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400 leading-snug">
            {SEGMENT_HINTS[segment]}
          </p>
        </aside>

        <section className="col-span-9 space-y-4">
          {segment === "segue" && (
            <SegueSegment members={members} />
          )}
          {segment === "scorecard" && (
            <ScorecardSegment
              teamId={teamId}
              meetingId={meetingId}
              dropFn={dropFn}
            />
          )}
          {segment === "rocks" && (
            <RocksSegment
              teamId={teamId}
              meetingId={meetingId}
              dropFn={dropFn}
              ownerName={ownerName}
            />
          )}
          {segment === "headlines" && (
            <HeadlinesSegment teamId={teamId} ownerName={ownerName} />
          )}
          {segment === "todos" && (
            <TodosReviewSegment
              teamId={teamId}
              meetingId={meetingId}
              dropFn={dropFn}
              ownerName={ownerName}
            />
          )}
          {segment === "ids" && (
            <IDSSegment
              teamId={teamId}
              meetingId={meetingId}
              members={members}
              ownerName={ownerName}
              currentUserId={user.id}
            />
          )}
          {segment === "conclude" && (
            <ConcludeSegment
              meetingId={meetingId}
              teamId={teamId}
              userId={user.id}
              rateFn={rateFn}
              ownerName={ownerName}
              members={members}
            />
          )}
          {segment === "done" && (
            <DoneSegment teamId={teamId} meetingId={meetingId} members={members} />
          )}
        </section>
      </div>
    </div>
  );
}

// ---------- Segue ----------
function SegueSegment({
  members,
}: {
  members: { user_id: string; full_name: string }[];
}) {
  return (
    <Card>
      <CardHeader>Segue — go around the room</CardHeader>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {members.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <UserCircle2 className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
            {m.full_name}
          </li>
        ))}
        {members.length === 0 && <Empty>No team members yet.</Empty>}
      </ul>
    </Card>
  );
}

// ---------- Scorecard ----------
async function ScorecardSegment({
  teamId,
  meetingId,
  dropFn,
}: {
  teamId: string;
  meetingId: string;
  dropFn: (title: string, description?: string) => Promise<unknown>;
}) {
  const { supabase } = await requireTeamAccess(teamId);
  const weeks = lastNMondays(4).map(toDateString); // newest first
  const thisWeek = weeks[0];

  const { data: metrics } = await supabase
    .from("scorecard_metrics")
    .select("id, name, unit, goal, direction, owner_id, sort_order")
    .eq("team_id", teamId)
    .order("sort_order", { ascending: true });

  const ids = (metrics ?? []).map((m) => m.id);
  const { data: entries } = await supabase
    .from("scorecard_entries")
    .select("metric_id, week_start_date, value")
    .in("metric_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
    .gte("week_start_date", weeks[weeks.length - 1]);
  const byKey = new Map<string, number>();
  for (const e of entries ?? []) {
    byKey.set(`${e.metric_id}|${e.week_start_date}`, Number(e.value));
  }

  return (
    <Card>
      <CardHeader>Scorecard — week of {formatWeek(thisWeek)}</CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
              <th className="text-left font-medium text-zinc-600 dark:text-zinc-400 px-4 py-2">
                Metric
              </th>
              <th className="text-right font-medium text-zinc-600 dark:text-zinc-400 px-3 py-2">
                Goal
              </th>
              {weeks.map((w) => (
                <th
                  key={w}
                  className="text-right font-medium text-zinc-500 dark:text-zinc-400 px-2 py-2 whitespace-nowrap"
                >
                  {formatWeek(w)}
                </th>
              ))}
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {(metrics ?? []).map((m) => {
              const thisWeekValue = byKey.get(`${m.id}|${thisWeek}`) ?? null;
              const ok = onTrack(
                thisWeekValue,
                m.goal,
                m.direction as "gte" | "lte" | "eq",
              );
              return (
                <tr
                  key={m.id}
                  className="border-b border-zinc-100 dark:border-zinc-800 last:border-0"
                >
                  <td className="px-4 py-2 font-medium">{m.name}</td>
                  <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400 tabular-nums">
                    {formatGoal(m.goal, m.direction, m.unit)}
                  </td>
                  {weeks.map((w, i) => {
                    const val = byKey.get(`${m.id}|${w}`) ?? null;
                    const ok = onTrack(
                      val,
                      m.goal,
                      m.direction as "gte" | "lte" | "eq",
                    );
                    return (
                      <td key={w} className="px-1 py-1 min-w-20">
                        <ValueCell
                          teamId={teamId}
                          metricId={m.id}
                          weekStart={w}
                          initialValue={val}
                          onTrack={ok}
                          unit={m.unit}
                          readOnly={i > 0}
                        />
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-right">
                    {ok === false && (
                      <DropToIssuesButton
                        compact
                        title={`Scorecard off-track: ${m.name}`}
                        description={`This week: ${
                          thisWeekValue ?? "—"
                        } (goal ${formatGoal(m.goal, m.direction, m.unit)})`}
                        dropAction={dropFn}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
            {(metrics ?? []).length === 0 && (
              <tr>
                <td colSpan={weeks.length + 3} className="px-4 py-6">
                  <Empty>No scorecard metrics defined yet.</Empty>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------- Rocks ----------
async function RocksSegment({
  teamId,
  dropFn,
  ownerName,
}: {
  teamId: string;
  meetingId: string;
  dropFn: (title: string, description?: string) => Promise<unknown>;
  ownerName: (id: string | null) => string;
}) {
  const { supabase } = await requireTeamAccess(teamId);
  const { data: rocksRaw } = await supabase
    .from("rocks")
    .select("id, title, status, owner_id, due_date, quarter")
    .eq("team_id", teamId)
    .neq("status", "done")
    .neq("status", "cancelled")
    .order("due_date", { ascending: true, nullsFirst: false });

  const order = ["on_track", "off_track", "done", "cancelled"];
  const rocks = (rocksRaw ?? []).slice().sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status),
  );

  return (
    <Card>
      <CardHeader>Rocks — current quarter</CardHeader>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {rocks.length === 0 && <Empty>No active rocks.</Empty>}
        {rocks.map((r) => (
          <li
            key={r.id}
            className="grid grid-cols-12 gap-3 px-4 py-3 items-center text-sm"
          >
            <div className="col-span-7">
              <div className="font-medium flex items-center gap-2">
                <Target className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                {r.title}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {r.quarter} · {ownerName(r.owner_id)}
              </div>
            </div>
            <div className="col-span-2 text-xs text-zinc-500 dark:text-zinc-400">
              {r.due_date
                ? new Date(r.due_date).toLocaleDateString()
                : "—"}
            </div>
            <div className="col-span-3 justify-self-end">
              <StatusBadge status={r.status} />
              {r.status === "off_track" && (
                <span className="ml-2">
                  <DropToIssuesButton
                    compact
                    title={`Rock off-track: ${r.title}`}
                    dropAction={dropFn}
                  />
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------- Headlines ----------
async function HeadlinesSegment({
  teamId,
  ownerName,
}: {
  teamId: string;
  ownerName: (id: string | null) => string;
}) {
  const { supabase } = await requireTeamAccess(teamId);
  const sinceMonday = toDateString(mondayOf());
  const { data: headlines } = await supabase
    .from("headlines")
    .select("id, title, body, kind, created_by, created_at")
    .eq("team_id", teamId)
    .gte("created_at", sinceMonday)
    .order("created_at", { ascending: false });

  return (
    <Card>
      <CardHeader>Headlines — this week</CardHeader>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {(headlines ?? []).length === 0 && <Empty>No headlines this week.</Empty>}
        {(headlines ?? []).map((h) => (
          <li key={h.id} className="flex items-start gap-3 px-4 py-3 text-sm">
            <span
              className={
                "mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full " +
                (h.kind === "customer"
                  ? "text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-950"
                  : "text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-950")
              }
            >
              {h.kind === "customer" ? (
                <Users className="w-3.5 h-3.5" />
              ) : (
                <UserCircle2 className="w-3.5 h-3.5" />
              )}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-medium">{h.title}</div>
              {h.body && (
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-0.5">
                  {h.body}
                </div>
              )}
              <div className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                {ownerName(h.created_by)} ·{" "}
                {new Date(h.created_at).toLocaleString()}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------- To-Dos review ----------
async function TodosReviewSegment({
  teamId,
  meetingId,
  dropFn,
  ownerName,
}: {
  teamId: string;
  meetingId: string;
  dropFn: (title: string, description?: string) => Promise<unknown>;
  ownerName: (id: string | null) => string;
}) {
  const { supabase } = await requireTeamAccess(teamId);

  // Last 7 days' open + recently-completed to-dos, excluding ones created
  // earlier in THIS meeting (they show up in Conclude instead).
  const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const { data: todos } = await supabase
    .from("todos")
    .select(
      "id, title, owner_id, due_date, completed_at, visibility, source_meeting_id",
    )
    .eq("team_id", teamId)
    .or(`source_meeting_id.is.null,source_meeting_id.neq.${meetingId}`)
    .gte("created_at", since)
    .order("completed_at", { ascending: true, nullsFirst: true });

  return (
    <Card>
      <CardHeader>To-Dos — prior week review</CardHeader>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {(todos ?? []).length === 0 && (
          <Empty>No to-dos from last week. Move on.</Empty>
        )}
        {(todos ?? []).map((t) => (
          <li
            key={t.id}
            className="flex items-center gap-3 px-4 py-2.5 text-sm"
          >
            <TodoToggle
              teamId={teamId}
              todoId={t.id}
              completed={!!t.completed_at}
            />
            <div className={"flex-1 min-w-0 truncate " + (t.completed_at ? "text-zinc-400 dark:text-zinc-500 line-through" : "")}>
              {t.title}
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
              {ownerName(t.owner_id)}
            </span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500 w-24 text-right">
              {t.due_date
                ? new Date(t.due_date).toLocaleDateString()
                : "—"}
            </span>
            {!t.completed_at && (
              <DropToIssuesButton
                compact
                title={`Stuck to-do: ${t.title}`}
                description="Wasn't completed in a week. Needs IDS."
                dropAction={dropFn}
              />
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------- IDS ----------
async function IDSSegment({
  teamId,
  meetingId,
  members,
  ownerName,
  currentUserId,
}: {
  teamId: string;
  meetingId: string;
  members: { user_id: string; full_name: string }[];
  ownerName: (id: string | null) => string;
  currentUserId: string;
}) {
  const { user, supabase } = await requireTeamAccess(teamId);

  const { data: issues } = await supabase
    .from("issues")
    .select(
      "id, title, description, owner_id, priority, votes, type, status, created_at",
    )
    .eq("team_id", teamId)
    .neq("status", "solved")
    .order("priority", { ascending: false })
    .order("votes", { ascending: false })
    .order("created_at", { ascending: true });

  const issueIds = (issues ?? []).map((i) => i.id);
  const { data: myVotes } =
    issueIds.length === 0
      ? { data: [] as { issue_id: string }[] }
      : await supabase
          .from("issue_votes")
          .select("issue_id")
          .eq("user_id", user.id)
          .in("issue_id", issueIds);
  const votedSet = new Set((myVotes ?? []).map((v) => v.issue_id));

  return (
    <Card>
      <CardHeader>
        IDS — {(issues ?? []).length} open · sorted by priority, votes
      </CardHeader>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {(issues ?? []).length === 0 && (
          <Empty>
            Nothing to solve. Drop off-track items from earlier segments here.
          </Empty>
        )}
        {(issues ?? []).map((i) => (
          <li
            key={i.id}
            className="grid grid-cols-12 gap-3 px-4 py-3 items-start text-sm"
          >
            <div className="col-span-6">
              <div className="font-medium">{i.title}</div>
              {i.description && (
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {i.description}
                </div>
              )}
            </div>
            <div className="col-span-2 text-xs text-zinc-500 dark:text-zinc-400">
              {ownerName(i.owner_id)}
            </div>
            <div className="col-span-1">
              <PrioritySelect
                teamId={teamId}
                issueId={i.id}
                priority={i.priority}
              />
            </div>
            <div className="col-span-1">
              <VoteButton
                teamId={teamId}
                issueId={i.id}
                votes={i.votes}
                voted={votedSet.has(i.id)}
              />
            </div>
            <div className="col-span-2 justify-self-end">
              <SolveButton
                teamId={teamId}
                issueId={i.id}
                defaultTitle={i.title}
                members={members}
                currentUserId={currentUserId}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------- Conclude ----------
async function ConcludeSegment({
  meetingId,
  teamId,
  userId,
  rateFn,
  ownerName,
  members,
}: {
  meetingId: string;
  teamId: string;
  userId: string;
  rateFn: (score: number) => Promise<unknown>;
  ownerName: (id: string | null) => string;
  members: { user_id: string; full_name: string }[];
}) {
  const { supabase } = await requireTeamAccess(teamId);

  const { data: newTodos } = await supabase
    .from("todos")
    .select("id, title, owner_id, due_date")
    .eq("team_id", teamId)
    .eq("source_meeting_id", meetingId)
    .order("created_at", { ascending: true });

  const { data: ratings } = await supabase
    .from("meeting_ratings")
    .select("user_id, score")
    .eq("meeting_id", meetingId);

  const myRating =
    (ratings ?? []).find((r) => r.user_id === userId)?.score ?? null;
  const avg =
    (ratings ?? []).length > 0
      ? (
          (ratings ?? []).reduce((sum, r) => sum + r.score, 0) /
          (ratings ?? []).length
        ).toFixed(1)
      : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          New to-dos from this meeting ({(newTodos ?? []).length})
        </CardHeader>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {(newTodos ?? []).length === 0 && (
            <Empty>No new to-dos. Either we&apos;re really efficient or we didn&apos;t solve much.</Empty>
          )}
          {(newTodos ?? []).map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 px-4 py-2.5 text-sm"
            >
              <Circle className="w-4 h-4 text-zinc-300 dark:text-zinc-600" />
              <div className="flex-1 truncate">{t.title}</div>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {ownerName(t.owner_id)}
              </span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500 w-24 text-right">
                {t.due_date
                  ? new Date(t.due_date).toLocaleDateString()
                  : "—"}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader>Ratings</CardHeader>
        <div className="px-4 py-4 space-y-4">
          <RatingForm initialScore={myRating} submitAction={rateFn} />
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            {(ratings ?? []).length} of {members.length} rated
            {avg && (
              <span className="ml-2">
                · avg <span className="font-medium">{avg}</span>/10
              </span>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ---------- Done ----------
async function DoneSegment({
  teamId,
  meetingId,
  members,
}: {
  teamId: string;
  meetingId: string;
  members: { user_id: string; full_name: string }[];
}) {
  const { supabase } = await requireTeamAccess(teamId);
  const { data: ratings } = await supabase
    .from("meeting_ratings")
    .select("user_id, score")
    .eq("meeting_id", meetingId);
  const { data: newTodos } = await supabase
    .from("todos")
    .select("id, title")
    .eq("team_id", teamId)
    .eq("source_meeting_id", meetingId);

  const avg =
    (ratings ?? []).length > 0
      ? (
          (ratings ?? []).reduce((sum, r) => sum + r.score, 0) /
          (ratings ?? []).length
        ).toFixed(1)
      : "—";

  return (
    <Card>
      <CardHeader>Meeting complete</CardHeader>
      <div className="px-4 py-6 space-y-3 text-sm">
        <div>
          Average rating:{" "}
          <span className="text-lg font-semibold">{avg}</span>
          /10 ({(ratings ?? []).length} of {members.length})
        </div>
        <div>
          New to-dos created:{" "}
          <span className="font-medium">{(newTodos ?? []).length}</span>
        </div>
      </div>
    </Card>
  );
}

// ---------- Shared ----------
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      {children}
    </div>
  );
}

function CardHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs uppercase tracking-wide font-medium text-zinc-600 dark:text-zinc-400">
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
      {children}
    </li>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    on_track: "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800",
    off_track: "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-800",
    done: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 ring-zinc-200 dark:ring-zinc-700",
    cancelled: "bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 ring-zinc-200 dark:ring-zinc-700",
  };
  const label = status.replace("_", " ");
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${
        styles[status] ?? styles.on_track
      }`}
    >
      {status === "done" && <CheckCircle2 className="w-3 h-3" />}
      {label}
    </span>
  );
}

function formatWeek(d: string): string {
  const date = new Date(d + "T00:00:00");
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatGoal(
  goal: number | null,
  direction: string,
  unit: string,
): string {
  if (goal == null) return "—";
  const arrow = direction === "gte" ? "≥" : direction === "lte" ? "≤" : "=";
  if (unit === "currency") return `${arrow} $${goal.toLocaleString()}`;
  if (unit === "percent") return `${arrow} ${goal}%`;
  return `${arrow} ${goal.toLocaleString()}`;
}
