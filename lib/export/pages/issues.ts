// Export definition: a team's Issues page (app/(app)/teams/[teamId]/issues).
//
// Reads the page's URL state (`?archived=`, `?owner=`, plus `team`) and the
// Short-term / Long-term toggle (`term`), which is client state on the page
// (issues-list.tsx), so the Export control there passes it along. Loads with
// the page's own query (`issues where team_id ==`), its archive rule
// (lib/issues isArchivedIssue) and its owner filter, double-checked against
// the access module. Rows come out in the list's order: short-term by
// status then votes (rankShortTerm), long-term by priority then status
// (rankLongTerm) — the same functions issues-list.tsx renders with.

import { accessFor, type Viewer } from "@/lib/access";
import type { IssueDoc } from "@/lib/firestore-types";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  isArchivedIssue,
  rankLongTerm,
  rankShortTerm,
  splitIssuesByTerm,
} from "@/lib/issues";
import {
  isRefusal,
  type ExportColumn,
  type ExportDefinition,
  type ExportRefusal,
  type LoadedView,
} from "../types";
import {
  archivedParam,
  loadRoster,
  loadTeamOr404,
  ownerFilterLine,
  ownerParam,
  parseTeamParam,
  resolveOwnerFilter,
} from "./shared";

export type IssueTerm = "short" | "long";

export type IssuesExportParams = {
  teamId: string;
  archived: boolean;
  owner: string | null;
  term: IssueTerm;
};

export type IssueExportRow = IssueDoc & { id: string; created_at?: unknown };

export const ISSUE_TERM_LABEL: Record<IssueTerm, string> = {
  short: "Short-term",
  long: "Long-term",
};

export function parseIssuesParams(sp: URLSearchParams): IssuesExportParams | ExportRefusal {
  const teamId = parseTeamParam(sp);
  if (isRefusal(teamId)) return teamId;
  return {
    teamId,
    archived: archivedParam(sp.get("archived")),
    owner: ownerParam(sp),
    // The list opens on Short-term; anything else reads as that.
    term: sp.get("term") === "long" ? "long" : "short",
  };
}

/** The rows issues-list.tsx renders for this view, in its order. Pure. */
export function issuesViewRows(input: {
  issues: readonly IssueExportRow[];
  viewer: Viewer;
  archived: boolean;
  ownerFilter: string;
  term: IssueTerm;
}): IssueExportRow[] {
  const inView = input.issues.filter(
    (i) =>
      accessFor("issue").canSee(i, input.viewer) &&
      isArchivedIssue(i) === input.archived &&
      (input.ownerFilter === "all" || i.owner_id === input.ownerFilter),
  );
  const { short, long } = splitIssuesByTerm(inView);
  return input.term === "short" ? rankShortTerm(short) : rankLongTerm(long);
}

export const ISSUES_COLUMNS: readonly ExportColumn<IssueExportRow>[] = [
  { key: "title", header: "Issue", kind: "text", value: (i) => i.title, width: 48 },
  {
    key: "description",
    header: "Description",
    kind: "richtext",
    value: (i) => i.description,
    width: 60,
  },
  { key: "owner", header: "Owner", kind: "user", value: (i) => i.owner_id, width: 22 },
  {
    key: "status",
    header: "Status",
    kind: "text",
    value: (i) => STATUS_LABEL[i.status] ?? i.status,
    width: 10,
  },
  {
    key: "priority",
    header: "Priority",
    kind: "text",
    value: (i) => (i.priority ? PRIORITY_LABEL[i.priority] : ""),
    width: 10,
  },
  { key: "votes", header: "Votes", kind: "number", value: (i) => Number(i.votes ?? 0), width: 8 },
  {
    key: "type",
    header: "Term",
    kind: "text",
    // splitIssuesByTerm: no type recorded counts as short-term.
    value: (i) => ISSUE_TERM_LABEL[i.type === "long" ? "long" : "short"],
    width: 12,
  },
  { key: "created_at", header: "Created", kind: "datetime", value: (i) => i.created_at, width: 20 },
  {
    key: "archived_at",
    header: "Archived",
    kind: "datetime",
    value: (i) => i.archived_at,
    width: 20,
  },
  { key: "id", header: "Issue ID", kind: "text", value: (i) => i.id, width: 24 },
];

export const issuesExport: ExportDefinition<IssueExportRow, IssuesExportParams> = {
  id: "issues",
  title: "Issues",
  parseParams: parseIssuesParams,
  columns: ISSUES_COLUMNS,
  async load({ db, uid, viewer }, p): Promise<LoadedView<IssueExportRow> | ExportRefusal> {
    const teamDoc = await loadTeamOr404(db, p.teamId, viewer);
    if (isRefusal(teamDoc)) return teamDoc;
    const teamName = teamDoc.name;

    const [members, snap] = await Promise.all([
      loadRoster(db, p.teamId),
      db.collection("issues").where("team_id", "==", p.teamId).get(),
    ]);
    const names = new Map(members.map((m) => [m.user_id, m.full_name]));
    const ownerFilter = resolveOwnerFilter(p.owner, uid, new Set(names.keys()));

    const rows = issuesViewRows({
      issues: snap.docs.map((d) => ({ ...(d.data() as IssueDoc), id: d.id })),
      viewer,
      archived: p.archived,
      ownerFilter,
      term: p.term,
    });

    return {
      ok: true,
      rows,
      teamId: p.teamId,
      names,
      filters: [
        { label: "Team", value: teamName },
        { label: "View", value: p.archived ? "Archived" : "Active" },
        { label: "Term", value: ISSUE_TERM_LABEL[p.term] },
        ownerFilterLine(ownerFilter, names),
      ],
      fileNameParts: [teamName, p.term, p.archived ? "archived" : "active"],
    };
  },
};
