// Export definition: a team's Headlines page (app/(app)/teams/[teamId]/headlines).
//
// Reads the page's URL state (`?archived=`, `?owner=`, plus `team`) and loads
// with its own query (`headlines where team_id ==`, newest first), archive
// rule and owner filter (the creator), double-checked against the access
// module. Rows come out as the page renders them (lib/headlines.ts): Active
// is the team's own headlines grouped by owner, then the Cascading section;
// Archived is the flat newest-first list.
//
// The Owner column is the creator's name. The page says "You" on the
// viewer's own rows; a file handed to someone else names the person instead.
// Names come from the team roster, as on the page, so a creator who has left
// the team reads "—" and groups under "No owner" exactly as it renders.

import { accessFor, type Viewer } from "@/lib/access";
import type { HeadlineDoc } from "@/lib/firestore-types";
import {
  groupByOwner,
  headlineCreatorLabel,
  isArchivedHeadline,
  splitCascadingSection,
} from "@/lib/headlines";
import { headlineKind } from "@/app/(app)/teams/[teamId]/headlines/headline-kind";
import {
  isRefusal,
  type ExportColumn,
  type ExportDefinition,
  type ExportRefusal,
  type LoadedView,
} from "../types";
import { checkRowCap } from "../cap";
import {
  archivedParam,
  loadRoster,
  loadTeamOr404,
  ownerFilterLine,
  ownerParam,
  parseTeamParam,
  resolveOwnerFilter,
} from "./shared";

export type HeadlinesExportParams = {
  teamId: string;
  archived: boolean;
  owner: string | null;
};

export type HeadlineExportRow = HeadlineDoc & {
  id: string;
  /** Owner group heading, "Cascading", or "Archived" — where the row renders. */
  section: string;
  /** Creator's name (never "You"). */
  owner_label: string;
};

/**
 * headlineCreatorLabel says "You" when `created_by` matches the viewer. No
 * uid is the NUL character, so passing it names everyone.
 */
const NO_VIEWER = "\u0000";

export const CASCADING_SECTION = "Cascading";
export const ARCHIVED_SECTION = "Archived";

export function parseHeadlinesParams(
  sp: URLSearchParams,
): HeadlinesExportParams | ExportRefusal {
  const teamId = parseTeamParam(sp);
  if (isRefusal(teamId)) return teamId;
  return { teamId, archived: archivedParam(sp.get("archived")), owner: ownerParam(sp) };
}

type Doc = HeadlineDoc & { id: string };

/** The rows the Headlines page renders for this view, in its order. Pure. */
export function headlinesViewRows(input: {
  headlines: readonly Doc[];
  viewer: Viewer;
  archived: boolean;
  ownerFilter: string;
  nameOf: (uid: string) => string | null | undefined;
}): HeadlineExportRow[] {
  const ownerOf = (h: Doc) => headlineCreatorLabel(h, NO_VIEWER, input.nameOf);
  // page.tsx: newest first, before any split.
  const inView = [...input.headlines]
    .filter(
      (h) =>
        accessFor("headline").canSee(h, input.viewer) &&
        isArchivedHeadline(h) === input.archived &&
        (input.ownerFilter === "all" || h.created_by === input.ownerFilter),
    )
    .sort((a, b) => (b.created_at?.toMillis?.() ?? 0) - (a.created_at?.toMillis?.() ?? 0));

  const row = (h: Doc, section: string): HeadlineExportRow => ({
    ...h,
    section,
    owner_label: ownerOf(h),
  });

  if (input.archived) return inView.map((h) => row(h, ARCHIVED_SECTION));

  const { team, cascading } = splitCascadingSection(inView);
  return [
    ...groupByOwner(team, ownerOf).flatMap((g) => g.headlines.map((h) => row(h, g.name))),
    ...cascading.map((h) => row(h, CASCADING_SECTION)),
  ];
}

export const HEADLINES_COLUMNS: readonly ExportColumn<HeadlineExportRow>[] = [
  { key: "section", header: "Section", kind: "text", value: (h) => h.section, width: 20 },
  { key: "title", header: "Headline", kind: "text", value: (h) => h.title, width: 48 },
  { key: "body", header: "Details", kind: "richtext", value: (h) => h.body, width: 60 },
  {
    key: "kind",
    header: "Category",
    kind: "text",
    value: (h) => headlineKind(h.kind).label,
    width: 12,
  },
  { key: "owner", header: "Owner", kind: "text", value: (h) => h.owner_label, width: 22 },
  { key: "from_label", header: "From", kind: "text", value: (h) => h.from_label, width: 20 },
  {
    key: "broadcast",
    header: "Org-wide copy",
    kind: "boolean",
    value: (h) => h.broadcast === true,
    width: 12,
  },
  {
    key: "discussed",
    header: "Discussed",
    kind: "boolean",
    value: (h) => h.discussed === true,
    width: 10,
  },
  { key: "created_at", header: "Created", kind: "datetime", value: (h) => h.created_at, width: 20 },
  {
    key: "archived_at",
    header: "Archived",
    kind: "datetime",
    value: (h) => h.archived_at,
    width: 20,
  },
  { key: "id", header: "Headline ID", kind: "text", value: (h) => h.id, width: 24 },
];

export const headlinesExport: ExportDefinition<HeadlineExportRow, HeadlinesExportParams> = {
  id: "headlines",
  title: "Headlines",
  parseParams: parseHeadlinesParams,
  columns: HEADLINES_COLUMNS,
  async load({ db, uid, viewer }, p): Promise<LoadedView<HeadlineExportRow> | ExportRefusal> {
    const teamDoc = await loadTeamOr404(db, p.teamId, viewer);
    if (isRefusal(teamDoc)) return teamDoc;
    const teamName = teamDoc.name;

    const [members, snap] = await Promise.all([
      loadRoster(db, p.teamId),
      db.collection("headlines").where("team_id", "==", p.teamId).get(),
    ]);
    const names = new Map(members.map((m) => [m.user_id, m.full_name]));
    const ownerFilter = resolveOwnerFilter(p.owner, uid, new Set(names.keys()));

    const rows = headlinesViewRows({
      headlines: snap.docs.map((d) => ({ ...(d.data() as HeadlineDoc), id: d.id })),
      viewer,
      archived: p.archived,
      ownerFilter,
      nameOf: (id) => names.get(id),
    });
    // Row cap (lib/export/cap.ts): the view is the query's docs filtered in
    // memory (archive, owner, visibility), as on the page, so the query
    // can't carry a limit. Check the filtered count before the core resolves
    // any names.
    const overCap = checkRowCap(rows.length);
    if (overCap) return overCap;

    return {
      ok: true,
      rows,
      teamId: p.teamId,
      names,
      filters: [
        { label: "Team", value: teamName },
        { label: "View", value: p.archived ? "Archived" : "Active" },
        ownerFilterLine(ownerFilter, names),
      ],
      fileNameParts: [teamName, p.archived ? "archived" : "active"],
    };
  },
};
