import { redirect } from "next/navigation";
import {
  requireTeamAccess,
  getOrgTeams,
  getTeamMembers,
} from "@/lib/firebase/teams";
import { requireViewer } from "@/lib/firebase/viewer";
import { loadItem } from "@/lib/firebase/items";
import { todoCan } from "@/lib/firebase/todo-gate";
import { loadUserNames } from "@/lib/firebase/user-names";
import {
  isAssignedFromOtherTeam,
  listShowsTodo,
  outsideOwnerIds,
} from "@/lib/todo-lists";
import { reconcileSpeakingOrder } from "@/lib/l10/speaking-order";
import { getTasksStatus, pullCompletionsForOwner } from "@/lib/google/tasks";
import {
  TodosBoard,
  type RockBoardDoc,
  type TodoBoardDoc,
} from "./todos-board";
import { type TodoDoc } from "@/lib/firestore-types";

/** Admin-SDK Timestamp → millis, so the value can cross the RSC boundary. */
function toMillis(v: { toMillis?: () => number } | null | undefined) {
  return typeof v?.toMillis === "function" ? v.toMillis() : null;
}

/**
 * To-Dos tab. Fetches the first paint and hands off to `TodosBoard`, which
 * holds the live subscription — see its header for why realtime, not
 * more revalidation, is the fix.
 *
 * `?archived=` and `?owner=` stay server-read: they are navigational, the
 * controls that set them already push a URL, and keeping them here means the
 * board never has to guess at a filter the server has already validated
 * against the roster.
 *
 * `?todo=` is the deep link a notification carries (lib/notifications.ts
 * notificationHref). The row opens expanded and scrolled to; if it has since
 * been archived the Archived view is selected so the link still lands.
 */
export default async function TodosPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ archived?: string; owner?: string; todo?: string }>;
}) {
  const { teamId: tid } = await params;
  const {
    archived: archivedParam,
    owner: ownerParam,
    todo: todoParam,
  } = await searchParams;
  let showArchived = archivedParam === "1" || archivedParam === "true";

  // Open by id (P8a, D1): a notification links an off-team assignee to the
  // to-do's own team page, which they cannot open. Send them to one of
  // their own teams' To-Dos, where the row sits under "Assigned to me from
  // other teams" — or Home if they are on no team.
  const { viewer, db: viewerDb } = await requireViewer();
  if (todoParam && !viewer.isAdmin && !viewer.teamIds.has(tid)) {
    const item = await loadItem(viewerDb, { type: "todo", id: todoParam });
    if (item && todoCan(item, viewer, "see")) {
      const home = [...viewer.teamIds].sort()[0];
      redirect(
        home
          ? `/teams/${home}/todos?todo=${encodeURIComponent(todoParam)}`
          : "/home",
      );
    }
  }
  const { uid, db, team } = await requireTeamAccess(tid);

  let focusTodoId: string | null = null;
  let focusExtra: TodoBoardDoc | null = null;
  if (todoParam) {
    const item = await loadItem(db, { type: "todo", id: todoParam });
    if (item && todoCan(item, viewer, "see")) {
      const f = item.data as TodoDoc;
      const onPage =
        item.teamId === tid ||
        isAssignedFromOtherTeam(f, uid, viewer.teamIds) ||
        (!!f.source_rock_id && f.owner_id === uid);
      if (onPage) {
        focusTodoId = item.ref.id;
        // Seen, but in no list here (an admin's private to-dos are in the
        // list now, so this is the rare leftover). It renders in its own
        // box on the Active view.
        if (item.teamId === tid && !listShowsTodo(f, uid, viewer.isAdmin)) {
          focusExtra = toBoardDoc(item.ref.id, f);
        } else if (f.archived_at != null) {
          showArchived = true;
        }
      }
    }
  }
  // Best-effort Google → EOS completion pull for the signed-in user so
  // Tasks completed outside the app show up when opening To-Dos.
  // Soft-fail at the call site too so a Google outage never blanks the list.
  try {
    await pullCompletionsForOwner(uid);
  } catch (e) {
    console.error("[todos] google pull on load failed:", e);
  }
  const tasksStatus = await getTasksStatus(uid);
  const members = await getTeamMembers(tid);
  const speakingOrder = reconcileSpeakingOrder(team.speakingOrder, members);

  const [snap, rocksSnap, mineSnap] = await Promise.all([
    db.collection("todos").where("team_id", "==", tid).get(),
    db.collection("rocks").where("team_id", "==", tid).get(),
    // Milestones assigned to the viewer on other teams' rocks
    // (docs/ROCK_SHARING_RULES.md): the To-Dos page carries every
    // milestone that is yours, wherever its rock lives.
    db
      .collection("todos")
      .where("owner_id", "==", uid)
      .where("completed_at", "==", null)
      .get(),
  ]);

  // Project plain fields — Timestamps can't cross the RSC boundary — and drop
  // other people's private rows here rather than in the client. The client's
  // own subscription is already scoped that way by the todos rule; matching it
  // on the server keeps private titles out of the serialized page payload,
  // where view-source would reach them even though the UI hid them.
  // Private rows: the creator's, the assignee's and admins' (spec §3.2) —
  // not leaders' or other members' (lib/todo-lists.ts listShowsTodo).
  const initialTodos: TodoBoardDoc[] = [];
  for (const d of snap.docs) {
    const t = d.data() as TodoDoc;
    if (!listShowsTodo(t, uid, viewer.isAdmin)) continue;
    initialTodos.push(toBoardDoc(d.id, t));
  }

  const teamTodoIds = new Set(snap.docs.map((d) => d.id));
  // Mine on other teams: milestones on other teams' rocks, and (D1) plain
  // to-dos assigned to me on teams I'm not on.
  const myElsewhere = mineSnap.docs.filter((d) => {
    const t = d.data() as TodoDoc;
    if (teamTodoIds.has(d.id) || t.archived_at != null) return false;
    return !!t.source_rock_id || isAssignedFromOtherTeam(t, uid, viewer.teamIds);
  });
  for (const d of myElsewhere) {
    const t = d.data() as TodoDoc;
    initialTodos.push({
      ...toBoardDoc(d.id, t),
      team_id: t.team_id,
      // A milestone row renders as a team row; a plain to-do keeps its own.
      ...(t.source_rock_id ? { visibility: "team" as const, weekly_focus: false } : {}),
    });
  }

  // Names the roster can't give: outside assignees of this team's to-dos,
  // assigners of mine from other teams. Team names for the pill.
  const rosterIdSet = new Set(members.map((m) => m.user_id));
  const offRosterIds = [
    ...outsideOwnerIds(initialTodos.filter((t) => !t.team_id), rosterIdSet),
    ...initialTodos
      .filter((t) => t.team_id && t.team_id !== tid)
      .map((t) => t.assigned_by ?? t.created_by ?? "")
      .filter((id) => id && !rosterIdSet.has(id)),
    ...(focusExtra?.owner_id && !rosterIdSet.has(focusExtra.owner_id)
      ? [focusExtra.owner_id]
      : []),
  ];
  const [personNameMap, orgTeams] = await Promise.all([
    loadUserNames(db, offRosterIds),
    getOrgTeams(),
  ]);
  const personNames = Object.fromEntries(personNameMap);
  const teamNames = Object.fromEntries(orgTeams.map((t) => [t.id, t.name]));

  const toRockBoardDoc = (id: string, x: FirebaseFirestore.DocumentData) => ({
    id,
    title: String(x.title ?? "Rock"),
    status: String(x.status ?? ""),
    archived_at: toMillis(x.archived_at),
  });
  const initialRocks: RockBoardDoc[] = rocksSnap.docs.map((d) =>
    toRockBoardDoc(d.id, d.data()),
  );
  // Parent rocks of those milestones, so the rows can name their rock.
  const extraRockIds = [
    ...new Set(myElsewhere.map((d) => d.data().source_rock_id as string)),
  ].filter((id) => !rocksSnap.docs.some((d) => d.id === id));
  const extraRocks: RockBoardDoc[] =
    extraRockIds.length === 0
      ? []
      : (
          await db.getAll(
            ...extraRockIds.map((id) => db.collection("rocks").doc(id)),
          )
        )
          .filter((d) => d.exists)
          .map((d) => toRockBoardDoc(d.id, d.data() ?? {}));

  const rosterIds = new Set(members.map((m) => m.user_id));
  const filterRaw = ownerParam || "all";
  const legacyMapped =
    filterRaw === "self" || filterRaw === "mine"
      ? uid
      : filterRaw === "team" || filterRaw === "others"
        ? "all"
        : filterRaw;
  const ownerFilter = rosterIds.has(legacyMapped) ? legacyMapped : "all";

  return (
    <TodosBoard
      teamId={tid}
      userId={uid}
      showArchived={showArchived}
      ownerFilter={ownerFilter}
      members={members}
      speakingOrder={speakingOrder}
      tasksStatus={tasksStatus}
      initialTodos={initialTodos}
      initialRocks={initialRocks}
      extraRocks={extraRocks}
      focusTodoId={focusTodoId}
      focusExtra={focusExtra}
      isAdmin={viewer.isAdmin}
      myTeamIds={[...viewer.teamIds]}
      personNames={personNames}
      teamNames={teamNames}
    />
  );
}

/** A stored to-do as the board's plain, serializable row. */
function toBoardDoc(id: string, t: TodoDoc): TodoBoardDoc {
  return {
    id,
    title: t.title,
    description: t.description ?? null,
    owner_id: t.owner_id ?? null,
    due_date: t.due_date ?? null,
    completed_at: toMillis(t.completed_at),
    archived_at: toMillis(t.archived_at),
    visibility: t.visibility === "private" ? "private" : "team",
    weekly_focus: t.weekly_focus === true,
    source_rock_id: t.source_rock_id ?? null,
    follower_ids: t.follower_ids ?? null,
    assigned_by: t.assigned_by ?? null,
    created_by: t.created_by ?? null,
  };
}
