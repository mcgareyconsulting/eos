"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Star, Trash2, Calendar } from "lucide-react";
import { collection, query as fsQuery, where } from "firebase/firestore";
import { EmptyState } from "@/components/empty-state";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import { LocalTime } from "@/components/local-time";
import type { AgendaItem } from "@/lib/l10/agenda";
import {
  meetingSummary,
  sortMeetingsNewestFirst,
  type TsLike,
} from "@/lib/l10/meeting-summary";
import { deleteMeeting } from "./actions";
import { Card } from "@/components/ui/card";

export type MeetingListDoc = {
  id: string;
  team_id: string;
  started_at: TsLike;
  ended_at: TsLike;
  /** `segment_started_at` (or `started_at`), for the abandoned-meeting cutoff
   *  on the Meetings page. See lib/l10/driver.ts. */
  last_activity_at?: TsLike;
  current_segment: string;
  agenda_name?: string | null;
  agenda_items?: AgendaItem[] | null;
};

// Live meetings list. The one-shot server render used to be the whole page,
// which meant a meeting started by someone else never appeared until you
// reloaded — "users not seeing a live meeting when on the meeting pane"
// (client bug report, L10 backlog 2026-07-27). Subscribing fixes join-late:
// the Live row shows up the moment the driver starts the meeting.
//
// Ratings are static server data: they're subcollection aggregates, only
// shown on completed meetings, so a meeting concluded while you watch simply
// shows its rating on the next full load.
export function MeetingsList({
  teamId,
  initialMeetings,
  ratingsByMeeting,
  canDelete,
}: {
  teamId: string;
  initialMeetings: MeetingListDoc[];
  ratingsByMeeting: Record<string, number | null>;
  /** Leader/admin. Starting a meeting is everyone's; deleting the team's
   *  meeting history is not, and `deleteMeeting` enforces that server-side. */
  canDelete: boolean;
}) {
  const db = getClientDb();
  const meetingsQuery = useMemo(
    () => fsQuery(collection(db, "meetings"), where("team_id", "==", teamId)),
    [db, teamId],
  );
  const meetings = useCollection<MeetingListDoc>(
    meetingsQuery,
    initialMeetings,
    "meetings-list",
  );

  const sorted = sortMeetingsNewestFirst(meetings);

  return (
    <Card divided>
      {sorted.length === 0 && (
        <EmptyState
          icon={Calendar}
          title="No meetings yet"
          hint="Click “Start meeting” and pick an agenda to run your first timed meeting."
        />
      )}
      {sorted.map((m) => {
        // Live / duration / agenda / progress: lib/l10/meeting-summary.ts,
        // shared with the export.
        const { startedMs, live, progressLabel } = meetingSummary(m);
        const avg = ratingsByMeeting[m.id] ?? null;

        return (
          <div
            key={m.id}
            className="group flex items-center gap-4 px-4 py-3 text-sm"
          >
            <Link
              href={`/teams/${teamId}/meetings/${m.id}`}
              className="flex-1 min-w-0"
            >
              <div className="font-medium">
                <LocalTime
                  ms={startedMs}
                  options={{
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }}
                />
              </div>
              <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                {progressLabel}
              </div>
            </Link>

            {!live && avg != null && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-hpb-gold/15 px-2 py-0.5 text-xs font-medium text-hpb-brown dark:text-hpb-gold ring-1 ring-inset ring-hpb-gold/40"
                title="Team average rating"
              >
                <Star className="h-3 w-3 fill-current" />
                {avg.toFixed(1)}
              </span>
            )}

            {live && (
              // The pill is the thing a latecomer's eye lands on — make it
              // the join affordance, not just a status light.
              <Link
                href={`/teams/${teamId}/meetings/${m.id}`}
                className="inline-flex items-center gap-1 rounded-full bg-hpb-green/10 px-2 py-0.5 text-xs font-medium text-hpb-green ring-1 ring-inset ring-hpb-green/30 hover:bg-hpb-green/20"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-hpb-green animate-pulse" />
                Live — join
              </Link>
            )}

            {canDelete && (
            <form
              action={deleteMeeting.bind(null, teamId, m.id)}
              onSubmit={(e) => {
                // A hover-revealed trash icon next to the row link is one
                // stray click from destroying a meeting (and its ratings) —
                // including the one the team is currently in.
                if (
                  !window.confirm(
                    live
                      ? "Delete this LIVE meeting for the whole team? This can't be undone."
                      : "Delete this meeting and its ratings? This can't be undone.",
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              <button
                type="submit"
                className="text-zinc-300 dark:text-zinc-600 hover:text-red-600 opacity-0 group-hover:opacity-100"
                aria-label="Delete meeting"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </form>
            )}
          </div>
        );
      })}
    </Card>
  );
}
