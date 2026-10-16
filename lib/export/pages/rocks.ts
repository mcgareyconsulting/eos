// Export definition: a team's Rocks page (app/(app)/teams/[teamId]/rocks),
// milestones included.
//
// Reads the page's URL state (`?archived=`, `?owner=`, plus `team`) and loads
// what page.tsx loads: the team's own rocks, the rocks it is in the audience
// of (Active only), each rock's milestones, and the members' blocks — their
// milestones on other teams' non-private rocks (spec §4, Active only).
// Full rocks are double-checked against the access module. Rows come out in
// the page's order, through the same rules (lib/rocks-view.ts
// buildRockSections, lib/rocks-share.ts): Company, Team, members A–Z, owners
// off the roster, then "Shared by {owner}".
//
// One row per rock. Milestones go in one cell, a line each, in due order —
// a rock and its checklist stay together on paper. A block is a row of its
// own ("Milestones on another team's rock"): the rock's headline and the
// member's milestones, nothing else, as the page shows it.
//
// Not in the file: each rock's status history (behind a click on the page).

import type { Firestore } from "firebase-admin/firestore";
import { accessFor, type Viewer } from "@/lib/access";
import { isAudienceTeam, isPrivateRock, rockSubjectOf } from "@/lib/access/rock";
import type { TodoDoc } from "@/lib/firestore-types";
import {
  loadAssignedRocks,
  loadMilestonesForRocks,
  loadTeamRocks,
} from "@/lib/firebase/queries";
import { loadUserNames } from "@/lib/firebase/user-names";
import { isTeamRock } from "@/lib/rock-bucket";
import { blockMilestones, groupSharedRocksByOwner, partitionSharedRocks } from "@/lib/rocks-share";
import { buildRockSections, mapFullRock, sortRocks, type FullRock } from "@/lib/rocks-view";
import { ownerLabel } from "@/lib/user-name";
import { STATUS_LABELS, type RockStatus } from "@/app/(app)/teams/[teamId]/rocks/status";
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
  type Member,
} from "./shared";

export type RocksExportParams = {
  teamId: string;
  archived: boolean;
  owner: string | null;
};

export type RockMilestone = {
  id: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  completed: boolean;
};

/** A member's block: another team's rock headline + their milestones on it. */
export type RockBlockInput = {
  rock: { id: string; title: string; owner_id: string | null; team_id: string };
  /** The block's member — the section it files under. */
  memberId: string;
  milestones: RockMilestone[];
};

export const ROCK_ENTRY = "Rock";
export const BLOCK_ENTRY = "Milestones on another team's rock";

export type RockExportRow = {
  entry: typeof ROCK_ENTRY | typeof BLOCK_ENTRY;
  section: string;
  id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  status: string;
  /** Individual / Team; blank on a block. */
  kind: string;
  is_company_rock: boolean;
  quarter: string;
  due_date: string | null;
  /** One line per milestone, already named. */
  milestones: string;
  milestones_done: string;
  /** Parent team's name when the rock is not this team's. */
  from_team: string;
  /** Audience team names, comma-joined. */
  shared_with: string;
  private: boolean;
  archived_at: number | null;
  assigned_by: string | null;
};

export function parseRocksParams(sp: URLSearchParams): RocksExportParams | ExportRefusal {
  const teamId = parseTeamParam(sp);
  if (isRefusal(teamId)) return teamId;
  return { teamId, archived: archivedParam(sp.get("archived")), owner: ownerParam(sp) };
}

const byDue = (a: { due_date: string | null }, b: { due_date: string | null }) => {
  if (!a.due_date && !b.due_date) return 0;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date.localeCompare(b.due_date);
};

/** `[done] Title — Owner — due 2026-10-20`, one line per milestone. */
export function milestoneLines(
  list: readonly RockMilestone[],
  ownerName: (id: string | null) => string,
): string {
  return [...list]
    .sort(byDue)
    .map((m) =>
      [
        `${m.completed ? "[done]" : "[open]"} ${m.title}`,
        ownerName(m.owner_id),
        m.due_date ? `due ${m.due_date}` : null,
      ]
        .filter(Boolean)
        .join(" — "),
    )
    .join("\n");
}

function doneCount(list: readonly RockMilestone[]): string {
  if (list.length === 0) return "";
  return `${list.filter((m) => m.completed).length}/${list.length}`;
}

type BlockEntry = {
  team_id: string;
  owner_id: string;
  status: "";
  quarter: "";
  due_date: null;
  rock_type: null;
  is_company_rock: false;
  block: RockBlockInput;
};

/**
 * The rows the Rocks page renders for this view, in its order. Pure:
 * `ownRocks` / `sharedRocks` are every rock the page's queries returned
 * (mapped with mapFullRock), `blocks` the members' blocks.
 */
export function rocksViewRows(input: {
  teamId: string;
  viewer: Viewer;
  archived: boolean;
  /** "all" or a roster user_id (resolveOwnerFilter). */
  ownerFilter: string;
  members: readonly Member[];
  ownRocks: readonly FullRock[];
  sharedRocks: readonly FullRock[];
  blocks: readonly RockBlockInput[];
  milestonesByRock: ReadonlyMap<string, RockMilestone[]>;
  nameOf: (uid: string) => string | null | undefined;
  teamNameOf: (teamId: string) => string | undefined;
}): RockExportRow[] {
  const { teamId, viewer, archived, ownerFilter: filter, members } = input;
  const rosterIds = new Set(members.map((m) => m.user_id));
  const ownerName = (id: string | null) => ownerLabel(id, input.nameOf);
  const canSee = (r: FullRock) => accessFor("rock").canSee(r, viewer);

  const own = input.ownRocks.filter(
    (r) => canSee(r) && (archived ? r.archived_at != null : r.archived_at == null),
  );
  // Audience rocks show on the Active list only — they archive on the parent.
  const shared = archived
    ? []
    : input.sharedRocks.filter(
        (r) => canSee(r) && isAudienceTeam(r, teamId) && r.archived_at == null,
      );
  const { ownerOnRoster, sharedBy } = partitionSharedRocks(shared, rosterIds);
  const blocks: BlockEntry[] = archived
    ? []
    : input.blocks.map((b) => ({
        team_id: b.rock.team_id,
        owner_id: b.memberId,
        status: "",
        quarter: "",
        due_date: null,
        rock_type: null,
        is_company_rock: false,
        block: b,
      }));

  const sections = buildRockSections<FullRock | BlockEntry>(
    [...own, ...ownerOnRoster, ...blocks],
    { teamId, filter, members, ownerName },
  );
  const sharedGroups = groupSharedRocksByOwner(
    filter === "all" ? sharedBy : sharedBy.filter((r) => r.owner_id === filter),
    ownerName,
  ).map((g) => ({ title: g.title, rocks: sortRocks(g.rocks) as (FullRock | BlockEntry)[] }));

  const toRow = (section: string, r: FullRock | BlockEntry): RockExportRow => {
    if ("block" in r) {
      const b = r.block;
      return {
        entry: BLOCK_ENTRY,
        section,
        id: b.rock.id,
        title: b.rock.title,
        description: null,
        owner_id: b.rock.owner_id,
        status: "",
        kind: "",
        is_company_rock: false,
        quarter: "",
        due_date: null,
        milestones: milestoneLines(b.milestones, ownerName),
        milestones_done: doneCount(b.milestones),
        from_team: input.teamNameOf(b.rock.team_id) ?? "another team",
        shared_with: "",
        private: false,
        archived_at: null,
        assigned_by: null,
      };
    }
    const ms = input.milestonesByRock.get(r.id) ?? [];
    return {
      entry: ROCK_ENTRY,
      section,
      id: r.id,
      title: r.title,
      description: r.description,
      owner_id: r.owner_id,
      status: STATUS_LABELS[r.status as RockStatus] ?? r.status ?? "",
      // rock-type.ts: department (and legacy company) render as Team.
      kind: isTeamRock(r) ? "Team" : "Individual",
      is_company_rock: r.is_company_rock,
      quarter: r.quarter ?? "",
      due_date: r.due_date,
      milestones: milestoneLines(ms, ownerName),
      milestones_done: doneCount(ms),
      from_team:
        r.team_id === teamId ? "" : (input.teamNameOf(r.team_id) ?? "another team"),
      shared_with: (r.audience_team_ids ?? [])
        .map((id) => input.teamNameOf(id) ?? "—")
        .join(", "),
      private: r.private,
      archived_at: r.archived_at,
      // lib/follow.ts assignerOf: legacy docs fall back to the creator.
      assigned_by: r.assigned_by ?? r.created_by ?? null,
    };
  };

  return [...sections, ...sharedGroups].flatMap((g) => g.rocks.map((r) => toRow(g.title, r)));
}

export const ROCKS_COLUMNS: readonly ExportColumn<RockExportRow>[] = [
  { key: "section", header: "Section", kind: "text", value: (r) => r.section, width: 20 },
  { key: "entry", header: "Entry", kind: "text", value: (r) => r.entry, width: 14 },
  { key: "title", header: "Rock", kind: "text", value: (r) => r.title, width: 44 },
  {
    key: "description",
    header: "Description",
    kind: "richtext",
    value: (r) => r.description,
    width: 50,
  },
  { key: "owner", header: "Owner", kind: "user", value: (r) => r.owner_id, width: 22 },
  { key: "status", header: "Status", kind: "text", value: (r) => r.status, width: 11 },
  { key: "rock_type", header: "Kind", kind: "text", value: (r) => r.kind, width: 11 },
  {
    key: "is_company_rock",
    header: "Company",
    kind: "boolean",
    value: (r) => r.is_company_rock,
    width: 9,
  },
  { key: "quarter", header: "Quarter", kind: "text", value: (r) => r.quarter, width: 10 },
  { key: "due_date", header: "Due", kind: "date", value: (r) => r.due_date, width: 12 },
  { key: "milestones", header: "Milestones", kind: "text", value: (r) => r.milestones, width: 60 },
  {
    key: "milestones_done",
    header: "Milestones done",
    kind: "text",
    value: (r) => r.milestones_done,
    width: 10,
  },
  { key: "from_team", header: "From team", kind: "text", value: (r) => r.from_team, width: 18 },
  {
    key: "audience_team_ids",
    header: "Shared with",
    kind: "text",
    value: (r) => r.shared_with,
    width: 24,
  },
  { key: "private", header: "Private", kind: "boolean", value: (r) => r.private, width: 8 },
  {
    key: "archived_at",
    header: "Archived",
    kind: "datetime",
    value: (r) => r.archived_at,
    width: 20,
  },
  { key: "assigned_by", header: "Assigned by", kind: "user", value: (r) => r.assigned_by, width: 22 },
  { key: "id", header: "Rock ID", kind: "text", value: (r) => r.id, width: 24 },
];

function milestoneOf(id: string, t: TodoDoc): RockMilestone {
  return {
    id,
    title: t.title,
    owner_id: t.owner_id,
    due_date: t.due_date,
    completed: !!t.completed_at,
  };
}

/** page.tsx's queries for this view: rocks, milestones and (Active) blocks. */
async function loadRocksData(
  db: Firestore,
  teamId: string,
  archived: boolean,
  rosterIds: readonly string[],
) {
  const [teamRocks, todosSnap] = await Promise.all([
    loadTeamRocks(db, teamId),
    db.collection("todos").where("team_id", "==", teamId).get(),
  ]);
  const ownRocks = teamRocks.own.map((d) => mapFullRock(d.id, d.data()));
  const sharedRocks = teamRocks.shared.map((d) => mapFullRock(d.id, d.data()));

  const milestonesByRock = new Map<string, RockMilestone[]>();
  const addMilestone = (id: string, t: TodoDoc) => {
    if (!t.source_rock_id) return;
    const list = milestonesByRock.get(t.source_rock_id) ?? [];
    list.push(milestoneOf(id, t));
    milestonesByRock.set(t.source_rock_id, list);
  };
  for (const d of todosSnap.docs) addMilestone(d.id, d.data() as TodoDoc);
  const liveShared = archived
    ? []
    : sharedRocks.filter((r) => isAudienceTeam(r, teamId) && r.archived_at == null);
  for (const d of await loadMilestonesForRocks(db, liveShared.map((r) => r.id))) {
    addMilestone(d.id, d.data() as TodoDoc);
  }

  const blocks: RockBlockInput[] = [];
  if (!archived) {
    const assigned = await loadAssignedRocks(
      db,
      [...rosterIds],
      new Set(teamRocks.own.map((d) => d.id)),
    );
    const msByRock = new Map<string, (TodoDoc & { id: string })[]>();
    for (const d of assigned.milestones) {
      const t = d.data() as TodoDoc;
      if (!t.source_rock_id) continue;
      const list = msByRock.get(t.source_rock_id) ?? [];
      list.push({ ...t, id: d.id });
      msByRock.set(t.source_rock_id, list);
    }
    const roster = new Set(rosterIds);
    for (const d of assigned.rocks) {
      const x = d.data() ?? {};
      const subject = rockSubjectOf(x);
      if (isPrivateRock(subject)) continue;
      const rock = {
        id: d.id,
        title: String(x.title ?? "Rock"),
        owner_id: subject.owner_id,
        team_id: subject.team_id,
      };
      const ms = msByRock.get(d.id) ?? [];
      for (const [memberId, list] of blockMilestones(subject, teamId, roster, ms)) {
        blocks.push({ rock, memberId, milestones: list.map((m) => milestoneOf(m.id, m)) });
      }
    }
  }
  return { ownRocks, sharedRocks, milestonesByRock, blocks };
}

export const rocksExport: ExportDefinition<RockExportRow, RocksExportParams> = {
  id: "rocks",
  title: "Rocks",
  parseParams: parseRocksParams,
  columns: ROCKS_COLUMNS,
  async load({ db, uid, viewer }, p): Promise<LoadedView<RockExportRow> | ExportRefusal> {
    const teamDoc = await loadTeamOr404(db, p.teamId, viewer);
    if (isRefusal(teamDoc)) return teamDoc;
    const teamName = teamDoc.name;

    const [members, teamsSnap] = await Promise.all([
      loadRoster(db, p.teamId),
      db.collection("teams").get(),
    ]);
    const rosterIds = members.map((m) => m.user_id);
    const teamNames = new Map(
      teamsSnap.docs.map((d) => [d.id, (d.data()?.name as string) ?? "Team"]),
    );
    const data = await loadRocksData(db, p.teamId, p.archived, rosterIds);

    // Names for everyone the rows mention, roster first (as the page does).
    const names = new Map(members.map((m) => [m.user_id, m.full_name]));
    const mentioned = [
      ...[...data.ownRocks, ...data.sharedRocks].map((r) => r.owner_id),
      ...data.blocks.map((b) => b.rock.owner_id),
      ...[...data.milestonesByRock.values()].flat().map((m) => m.owner_id),
      ...data.blocks.flatMap((b) => b.milestones.map((m) => m.owner_id)),
    ].filter((id): id is string => !!id && !names.has(id));
    for (const [id, name] of await loadUserNames(db, mentioned)) names.set(id, name);

    const ownerFilter = resolveOwnerFilter(p.owner, uid, new Set(rosterIds));
    const rows = rocksViewRows({
      teamId: p.teamId,
      viewer,
      archived: p.archived,
      ownerFilter,
      members,
      ...data,
      nameOf: (id) => names.get(id),
      teamNameOf: (id) => teamNames.get(id),
    });

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
