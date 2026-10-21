"use client";

import { useMemo } from "react";
import { collection, doc, query as fsQuery, where } from "firebase/firestore";
import { Building2, Users } from "lucide-react";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection, useDoc } from "@/lib/firebase/use-collection";
import {
  currentSpeakerUid,
  reconcileSpeakingOrder,
} from "@/lib/l10/speaking-order";
import { groupRocksForL10 } from "@/lib/l10/rock-order";
import {
  groupSharedRocksByOwner,
  partitionSharedRocks,
} from "@/lib/rocks-share";
import {
  isAudienceTeam,
  rockAccess,
  type RockHeadline,
} from "@/lib/access/rock";
import { viewerOf } from "@/lib/access/types";
import {
  COMPANY_SECTION_TITLE,
  DEPARTMENT_SECTION_TITLE,
  rockBucket,
} from "../../rocks/rock-type";
import { RockBlockRow, RockRow } from "../../rocks/rock-row";
import { type MilestoneSerialized } from "../../rocks/milestone-checklist";
import { type StatusUpdateSerialized } from "../../rocks/status-history";
import { EntityViewToggle } from "@/components/entity-view-tabs";
import { CaptureButton } from "./meeting-capture-modal";
import { useArchivedToggle } from "@/lib/l10/use-archived-toggle";
import { initials, ownerLabel } from "@/lib/user-name";
import {
  type RockDoc as RockDocRecord,
  type TodoDoc as TodoDocRecord,
  type WithId,
} from "@/lib/firestore-types";
import { SectionTitle } from "@/components/ui/text";

type RockDoc = WithId<RockDocRecord>;

// completed_at is a Firestore Timestamp from onSnapshot but a plain boolean
// when pre-rendered on the server (Timestamps can't cross the RSC boundary).
// We only ever read it as truthy/falsy here, so either works.
type TodoDoc = WithId<
  Pick<
    TodoDocRecord,
    | "team_id"
    | "title"
    | "owner_id"
    | "due_date"
    | "source_rock_id"
    | "description"
  >
> & {
  completed_at: TodoDocRecord["completed_at"] | boolean;
};

/** One entry in a member's block (spec §4; lib/rocks-share.ts
 *  blockMilestones): another team's rock headline and that member's
 *  milestones on it. Never more of the rock than the headline. */
export type BlockRow = {
  headline: RockHeadline;
  carrierId: string;
  milestones: TodoDoc[];
};

type BlockEntry = {
  id: string;
  team_id: string;
  owner_id: string;
  status: "";
  quarter: "";
  due_date: null;
  __block: BlockRow;
};

// created_at is a Firestore Timestamp over onSnapshot; toMillis() is the only
// thing we read off it.
type StatusUpdateDoc = {
  id: string;
  team_id: string;
  rock_id: string;
  status: string;
  comment: string | null;
  user_id: string | null;
  created_at: { toMillis?: () => number } | null;
};

type Member = { user_id: string; full_name: string };

export function SegmentRocks({
  teamId,
  meetingId,
  userId,
  defaultDue,
  initialRocks,
  initialTodos,
  initialBlocks = [],
  members,
  initialAbsentUserIds,
  initialSpeakingOrder,
  initialSpeakerIndex,
  initialDriverId = null,
  teamName,
  shareTeams,
  allTeams = [],
  extraOwnerNames = [],
  canFlagCompany = false,
  isAdmin = false,
  viewerTeamIds = [],
  viewerLeaderTeamIds = [],
  parentRosters = {},
}: {
  teamId: string;
  meetingId: string;
  userId: string;
  defaultDue: string;
  initialRocks: RockDoc[];
  initialTodos: TodoDoc[];
  initialBlocks?: BlockRow[];
  members: Member[];
  initialAbsentUserIds: string[];
  initialSpeakingOrder: string[];
  initialSpeakerIndex: number;
  /** Who holds the wheel at render (meeting doc `driver_id`). */
  initialDriverId?: string | null;
  teamName: string;
  shareTeams: { id: string; name: string }[];
  allTeams?: { id: string; name: string }[];
  extraOwnerNames?: { user_id: string; full_name: string }[];
  /** Org admin — may set the Company flag from the in-meeting edit modal. */
  canFlagCompany?: boolean;
  isAdmin?: boolean;
  /** Every team the viewer is rostered on — rock access follows these. */
  viewerTeamIds?: string[];
  /** Teams the viewer leads — audience and Private follow these. */
  viewerLeaderTeamIds?: string[];
  /**
   * Parent rosters of audience rocks, keyed by team id, for editing the
   * rock against its parent team. A parent that arrives live without a
   * roster here falls back to this team's members.
   */
  parentRosters?: Record<string, Member[]>;
}) {
  const db = getClientDb();

  const rocksQuery = useMemo(
    () => fsQuery(collection(db, "rocks"), where("team_id", "==", teamId)),
    [db, teamId],
  );
  // Audience rocks: the new field, and the legacy one until P13 migrates
  // every rock. Each keeps its server-rendered rows if the rules refuse it.
  const audienceRocksQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "rocks"),
        where("audience_team_ids", "array-contains", teamId),
      ),
    [db, teamId],
  );
  const legacySharedRocksQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "rocks"),
        where("shared_team_ids", "array-contains", teamId),
      ),
    [db, teamId],
  );
  // Milestones are todos with source_rock_id set and visibility="team".
  // We must filter by visibility to satisfy the per-doc rule (otherwise
  // Firestore rejects the whole subscription if any private todo matches).
  const todosQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "todos"),
        where("team_id", "==", teamId),
        where("visibility", "==", "team"),
      ),
    [db, teamId],
  );

  // Status notes power the "latest status note" line in the expanded row, so
  // the meeting sees the same context the Rocks tab does. Append-only and
  // client-readable by team members (firestore.rules).
  const statusQuery = useMemo(
    () =>
      fsQuery(
        collection(db, "rock_status_updates"),
        where("team_id", "==", teamId),
      ),
    [db, teamId],
  );

  const initialHome = useMemo(
    () => initialRocks.filter((r) => r.team_id === teamId),
    [initialRocks, teamId],
  );
  const initialShared = useMemo(
    () => initialRocks.filter((r) => isAudienceTeam(r, teamId)),
    [initialRocks, teamId],
  );
  const homeRocks = useCollection<RockDoc>(rocksQuery, initialHome);
  const audienceRocksLive = useCollection<RockDoc>(
    audienceRocksQuery,
    initialShared,
    "audience-rocks",
  );
  const legacyRocksLive = useCollection<RockDoc>(
    legacySharedRocksQuery,
    initialShared,
    "legacy-shared-rocks",
  );
  const sharedRocksLive = useMemo(() => {
    const byId = new Map<string, RockDoc>();
    for (const r of [...legacyRocksLive, ...audienceRocksLive]) byId.set(r.id, r);
    return [...byId.values()];
  }, [audienceRocksLive, legacyRocksLive]);
  const liveTodos = useCollection<TodoDoc>(todosQuery, initialTodos);
  const statusUpdates = useCollection<StatusUpdateDoc>(statusQuery, []);
  const extraTodos = useMemo(
    () => initialTodos.filter((t) => t.team_id !== teamId),
    [initialTodos, teamId],
  );
  const todos = useMemo(() => {
    const seen = new Set(liveTodos.map((t) => t.id));
    return [
      ...liveTodos,
      ...extraTodos.filter((t) => !seen.has(t.id)),
    ];
  }, [liveTodos, extraTodos]);

  // Active and archived as two lists, not one filtered by a flag: the speaking
  // order, department grouping and counts below all read `rocks`, and only the
  // active set belongs in them. Archived rocks are reachable in-meeting via
  // the toggle, which retired the old "archived belongs to the Rocks tab"
  // rule.
  const dedupe = (home: RockDoc[], shared: RockDoc[]) => {
    const seen = new Set(home.map((r) => r.id));
    return [...home, ...shared.filter((r) => !seen.has(r.id))];
  };
  const rocks = useMemo(
    () =>
      dedupe(
        homeRocks.filter((r) => r.archived_at == null),
        sharedRocksLive.filter(
          (r) => r.archived_at == null && isAudienceTeam(r, teamId),
        ),
      ),
    [homeRocks, sharedRocksLive, teamId],
  );
  const archivedRocks = useMemo(
    () =>
      dedupe(
        homeRocks.filter((r) => r.archived_at != null),
        sharedRocksLive.filter(
          (r) => r.archived_at != null && isAudienceTeam(r, teamId),
        ),
      ),
    [homeRocks, sharedRocksLive, teamId],
  );
  const [showArchived, setShowArchived] = useArchivedToggle();

  // Attendance + speaking rotation live on the meeting doc. Subscribe so
  // marking someone absent / advancing the floor reorders/dims sections live.
  const meetingRef = useMemo(
    () => doc(db, "meetings", meetingId),
    [db, meetingId],
  );
  const meeting = useDoc<{
    absent_user_ids?: string[];
    speaking_order?: string[];
    speaking_index?: number;
    driver_id?: string | null;
  }>(
    meetingRef,
    {
      absent_user_ids: initialAbsentUserIds,
      speaking_order: initialSpeakingOrder,
      speaking_index: initialSpeakerIndex,
      driver_id: initialDriverId,
    },
    "segment-rocks",
  );
  const absent = new Set(meeting.absent_user_ids ?? []);
  const speakingOrder = reconcileSpeakingOrder(meeting.speaking_order, members);
  const speakerIndex = meeting.speaking_index ?? 0;
  const currentSpeaker = currentSpeakerUid(
    speakingOrder,
    speakerIndex,
    meeting.absent_user_ids ?? [],
  );

  const nameById = new Map(members.map((m) => [m.user_id, m.full_name]));
  for (const n of extraOwnerNames) nameById.set(n.user_id, n.full_name);
  const teamNameById = new Map(allTeams.map((t) => [t.id, t.name]));
  const rosterIds = new Set(members.map((m) => m.user_id));
  const viewer = viewerOf(userId, isAdmin, viewerTeamIds, viewerLeaderTeamIds);

  const toMilestone = (t: TodoDoc): MilestoneSerialized => ({
    id: t.id,
    title: t.title,
    owner_id: t.owner_id,
    due_date: t.due_date,
    completed: !!t.completed_at,
    description: t.description ?? null,
    // Always carry the name: an audience rock edited as its parent team
    // renders with the parent's roster, which may not hold this owner.
    owner_label: t.owner_id ? (nameById.get(t.owner_id) ?? null) : null,
  });
  const milestonesByRock = new Map<string, MilestoneSerialized[]>();
  for (const t of todos) {
    if (!t.source_rock_id) continue;
    const list = milestonesByRock.get(t.source_rock_id) ?? [];
    list.push(toMilestone(t));
    milestonesByRock.set(t.source_rock_id, list);
  }
  for (const list of milestonesByRock.values()) {
    list.sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    });
  }

  const statusByRock = new Map<string, StatusUpdateSerialized[]>();
  for (const u of statusUpdates) {
    if (!u.rock_id) continue;
    const list = statusByRock.get(u.rock_id) ?? [];
    list.push({
      id: u.id,
      status: String(u.status ?? ""),
      comment: u.comment ?? null,
      user_id: u.user_id ?? null,
      created_at_ms: u.created_at?.toMillis?.() ?? null,
      author_name: u.user_id ? (nameById.get(u.user_id) ?? "—") : "—",
    });
    statusByRock.set(u.rock_id, list);
  }
  for (const list of statusByRock.values()) {
    list.sort((a, b) => (b.created_at_ms ?? 0) - (a.created_at_ms ?? 0));
  }

  // Show every non-cancelled rock. This used to filter on
  // r.quarter === currentQuarter(), but `quarter` is a free-text label —
  // imported rocks carry the client's own fiscal wording ("Q2 FY 2026"),
  // which never string-matches "2026-Q3", so the segment rendered empty
  // while the Rocks tab (which doesn't filter) looked fine. The meeting
  // reviews the rocks the team actually has; cancelled ones stay out.
  // Archived view shows them as they are — a cancelled rock that was archived
  // is exactly the kind of thing someone opens this view to find.
  const visible = showArchived
    ? archivedRocks
    : rocks.filter((r) => r.status !== "cancelled");
  const homeVisible = visible.filter((r) => r.team_id === teamId);
  const sharedVisible = visible.filter((r) => isAudienceTeam(r, teamId));
  // Same placement rule as the Rocks tab (lib/rocks-share.ts): a shared-in
  // rock whose owner is in this room walks with that owner's turn; anyone
  // else's sits below under "Shared by". Shared-in rocks skip the Company /
  // Department ladder — they are not this team's shared priorities.
  const { ownerOnRoster: sharedIntoSections, sharedBy: sharedRocksBelow } =
    partitionSharedRocks(sharedVisible, rosterIds);
  // Block entries walk with their member's turn. Grouping reads owner_id,
  // so each enters keyed to its member; it renders as a headline only.
  const blockEntries: BlockEntry[] = showArchived
    ? []
    : initialBlocks
        .filter((b) => b.milestones.length > 0)
        .map((b) => ({
          id: b.headline.id,
          team_id: b.headline.team_id,
          owner_id: b.carrierId,
          status: "",
          quarter: "",
          due_date: null,
          __block: b,
        }));
  const groups = groupRocksForL10<RockDoc | BlockEntry>(
    [...homeVisible, ...sharedIntoSections, ...blockEntries],
    (r) => (r.team_id === teamId && !("__block" in r) ? rockBucket(r) : "owner"),
    members,
    speakingOrder,
    absent,
    currentSpeaker,
    { company: COMPANY_SECTION_TITLE, department: DEPARTMENT_SECTION_TITLE },
  );
  const sharedGroups = groupSharedRocksByOwner(sharedRocksBelow, (id) =>
    id ? (nameById.get(id) ?? "—") : "—",
  );

  // Mirrors the Rocks tab's rowProps: everyone who sees a full rock here
  // may edit it; rock actions run against its parent team, ticks and the
  // thread from this team (lib/access/rock.ts).
  function rowProps(r: RockDoc) {
    const own = r.team_id === teamId;
    const fromTeamName = own
      ? undefined
      : (teamNameById.get(r.team_id) ?? "another team");
    return {
      teamId: r.team_id,
      viewTeamId: teamId,
      members: own ? members : (parentRosters[r.team_id] ?? members),
      teamName: own ? teamName : fromTeamName,
      shareTeams: own ? shareTeams : allTeams.filter((t) => t.id !== r.team_id),
      canFlagCompany,
      canEdit: rockAccess.canEdit(r, viewer),
      canDelete: rockAccess.canDelete(r, viewer),
      canManageAudience: rockAccess.canChangeAudience(r, viewer),
      fromTeamName,
    };
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          {homeVisible.length + sharedVisible.length} rock
          {homeVisible.length + sharedVisible.length === 1 ? "" : "s"}
        </div>
        <div className="flex items-center gap-2">
          <EntityViewToggle
            showArchived={showArchived}
            onChange={setShowArchived}
            activeCount={rocks.filter((r) => r.status !== "cancelled").length}
            archivedCount={archivedRocks.length}
          />
          <CaptureButton />
        </div>
      </div>

      {groups.length === 0 && sharedGroups.length === 0 && (
        <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
          {showArchived
            ? "No archived rocks."
            : "No rocks yet — add them on the Rocks tab."}
        </div>
      )}

      {/* One card per section, owner in the card header — the header row
          carries the speaker state (green header + chip) instead of ringing
          the whole card, which shouted over the content. */}
      {groups.map((g) => (
        <section
          key={g.key}
          className={
            "overflow-hidden rounded-xl border bg-white dark:bg-zinc-900 " +
            (g.isCurrentSpeaker
              ? "border-hpb-green/50"
              : "border-zinc-300 dark:border-zinc-800") +
            (g.absent ? " opacity-60" : "")
          }
        >
          <header
            className={
              "flex items-center gap-2 border-b px-4 py-2 " +
              (g.isCurrentSpeaker
                ? "border-hpb-green/30 bg-hpb-green/5 dark:bg-hpb-green/10"
                : "border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-950/50")
            }
          >
            <span
              className={
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold " +
                (g.isCurrentSpeaker
                  ? "bg-hpb-green text-white"
                  : "bg-hpb-blue/10 text-hpb-blue dark:bg-hpb-gold/15 dark:text-hpb-gold")
              }
            >
              {g.bucket === "company" ? (
                <Building2 className="h-3.5 w-3.5" />
              ) : g.bucket === "department" ? (
                <Users className="h-3.5 w-3.5" />
              ) : (
                initials(g.title) || "?"
              )}
            </span>
            <SectionTitle as="h3">{g.title}</SectionTitle>
            <span className="text-xs text-zinc-500">{g.rocks.length}</span>
            {g.isCurrentSpeaker && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-hpb-green/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-hpb-green ring-1 ring-inset ring-hpb-green/30">
                <span className="h-1.5 w-1.5 rounded-full bg-hpb-green" />
                Now speaking
              </span>
            )}
            {g.absent && !g.isCurrentSpeaker && (
              <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Absent
              </span>
            )}
          </header>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {g.rocks.map((r) => {
              if ("__block" in r) {
                const b = r.__block;
                return (
                  <RockBlockRow
                    key={`${b.headline.id}:${b.carrierId}`}
                    viewTeamId={teamId}
                    headline={b.headline}
                    ownerName={ownerLabel(b.headline.owner_id, (id) =>
                      nameById.get(id),
                    )}
                    fromTeamName={
                      teamNameById.get(b.headline.team_id) ?? "another team"
                    }
                    milestones={b.milestones.map(toMilestone)}
                    currentUserId={userId}
                  />
                );
              }
              return (
                <RockRow
                  key={r.id}
                  {...rowProps(r)}
                  userId={userId}
                  rock={r}
                  ownerName={
                    ownerLabel(r.owner_id, (id) => nameById.get(id))
                  }
                  milestones={milestonesByRock.get(r.id) ?? []}
                  defaultDue={defaultDue}
                  statusHistory={statusByRock.get(r.id) ?? []}
                  currentUserId={userId}
                />
              );
            })}
          </div>
        </section>
      ))}

      {sharedGroups.map((g) => (
        <section
          key={`shared-${g.ownerId ?? "none"}`}
          className="overflow-hidden rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900"
        >
          <header className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50/80 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950/50">
            <SectionTitle as="h3">{g.title}</SectionTitle>
            <span className="text-xs text-zinc-500">{g.rocks.length}</span>
          </header>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {g.rocks.map((r) => (
              <RockRow
                key={r.id}
                {...rowProps(r)}
                userId={userId}
                rock={r}
                ownerName={
                  ownerLabel(r.owner_id, (id) => nameById.get(id))
                }
                milestones={milestonesByRock.get(r.id) ?? []}
                defaultDue={defaultDue}
                statusHistory={statusByRock.get(r.id) ?? []}
                currentUserId={userId}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

