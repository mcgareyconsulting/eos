// Export definition: a team's meeting history (the History list on
// app/(app)/teams/[teamId]/meetings).
//
// The page has no filters, so the view is `team` alone. Loads with the page's
// own query (`meetings where team_id ==`) and the team gate, and each
// meeting's average effectiveness rating from `effectiveness_scores`, as the
// page does. Rows are newest first and read as the list reads them
// (lib/l10/meeting-summary.ts). The page shows a live meeting's rating only
// once it ends; the file does the same.
//
// Not in the file: the meeting settings (agendas, Meet link, speaking order),
// which are configuration rather than history, and each meeting's recap,
// which is its own page.

import type { Timestamp } from "firebase-admin/firestore";
import { normalizeAgendaItems, type AgendaItem } from "@/lib/l10/agenda";
import {
  averageRating,
  meetingSummary,
  sortMeetingsNewestFirst,
} from "@/lib/l10/meeting-summary";
import {
  isRefusal,
  type ExportColumn,
  type ExportDefinition,
  type ExportRefusal,
  type LoadedView,
} from "../types";
import { loadTeamOr404, parseTeamParam } from "./shared";

export type MeetingsExportParams = { teamId: string };

export type MeetingExportInput = {
  id: string;
  started_at: Timestamp | number | null;
  ended_at: Timestamp | number | null;
  current_segment: string;
  agenda_name: string | null;
  agenda_items: AgendaItem[] | null;
};

export type MeetingExportRow = {
  id: string;
  started_ms: number | null;
  ended_ms: number | null;
  status: "Live" | "Completed";
  duration_min: number | null;
  agenda: string;
  progress: string;
  rating: number | null;
};

export function parseMeetingsParams(sp: URLSearchParams): MeetingsExportParams | ExportRefusal {
  const teamId = parseTeamParam(sp);
  if (isRefusal(teamId)) return teamId;
  return { teamId };
}

/** The History list's rows, newest first. Pure. */
export function meetingsViewRows(
  meetings: readonly MeetingExportInput[],
  ratingsByMeeting: ReadonlyMap<string, number | null>,
): MeetingExportRow[] {
  return sortMeetingsNewestFirst(meetings).map((m) => {
    const s = meetingSummary(m);
    return {
      id: m.id,
      started_ms: s.startedMs,
      ended_ms: s.endedMs,
      status: s.live ? "Live" : "Completed",
      duration_min: s.durationMin,
      agenda: s.agendaName ?? "",
      progress: s.progressLabel,
      // meetings-list.tsx: the rating pill shows on completed meetings only.
      rating: s.live ? null : (ratingsByMeeting.get(m.id) ?? null),
    };
  });
}

export const MEETINGS_COLUMNS: readonly ExportColumn<MeetingExportRow>[] = [
  { key: "started_at", header: "Started", kind: "datetime", value: (m) => m.started_ms, width: 20 },
  { key: "ended_at", header: "Ended", kind: "datetime", value: (m) => m.ended_ms, width: 20 },
  { key: "status", header: "Status", kind: "text", value: (m) => m.status, width: 11 },
  {
    key: "duration_min",
    header: "Duration (min)",
    kind: "number",
    value: (m) => m.duration_min,
    width: 12,
  },
  { key: "agenda_name", header: "Agenda", kind: "text", value: (m) => m.agenda, width: 22 },
  { key: "progress", header: "Summary", kind: "text", value: (m) => m.progress, width: 44 },
  { key: "rating", header: "Average rating", kind: "number", value: (m) => m.rating, width: 12 },
  { key: "id", header: "Meeting ID", kind: "text", value: (m) => m.id, width: 24 },
];

export const meetingsExport: ExportDefinition<MeetingExportRow, MeetingsExportParams> = {
  id: "meetings",
  title: "Meetings",
  parseParams: parseMeetingsParams,
  columns: MEETINGS_COLUMNS,
  async load({ db, viewer }, p): Promise<LoadedView<MeetingExportRow> | ExportRefusal> {
    const teamDoc = await loadTeamOr404(db, p.teamId, viewer);
    if (isRefusal(teamDoc)) return teamDoc;
    const teamName = teamDoc.name;

    const snap = await db.collection("meetings").where("team_id", "==", p.teamId).get();
    const meetings: MeetingExportInput[] = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        started_at: (x.started_at as Timestamp | null) ?? null,
        ended_at: (x.ended_at as Timestamp | null) ?? null,
        current_segment: String(x.current_segment ?? ""),
        agenda_name: (x.agenda_name as string | null) ?? null,
        agenda_items: normalizeAgendaItems(x.agenda_items) ?? null,
      };
    });

    const ratings = new Map<string, number | null>();
    await Promise.all(
      meetings.map(async (m) => {
        const r = await db.collection("meetings").doc(m.id).collection("effectiveness_scores").get();
        ratings.set(m.id, averageRating(r.docs.map((d) => d.data().rating)));
      }),
    );

    return {
      ok: true,
      rows: meetingsViewRows(meetings, ratings),
      teamId: p.teamId,
      filters: [
        { label: "Team", value: teamName },
        { label: "View", value: "Meeting history (all)" },
      ],
      fileNameParts: [teamName, "history"],
    };
  },
};
