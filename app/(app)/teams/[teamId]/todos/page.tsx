import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { reconcileSpeakingOrder } from "@/lib/l10/speaking-order";
import { getTasksStatus, pullCompletionsForOwner } from "@/lib/google/tasks";
import {
  TodosBoard,
  type RockBoardDoc,
  type TodoBoardDoc,
} from "./todos-board";

type TodoDoc = {
  team_id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  due_date: string | null;
  completed_at: { toMillis?: () => number } | null;
  archived_at?: { toMillis?: () => number } | null;
  visibility: "team" | "private";
  weekly_focus?: boolean;
  source_issue_id: string | null;
  source_meeting_id: string | null;
  source_rock_id: string | null;
};

/** Admin-SDK Timestamp → millis, so the value can cross the RSC boundary. */
function toMillis(v: { toMillis?: () => number } | null | undefined) {
  return typeof v?.toMillis === "function" ? v.toMillis() : null;
}

/**
 * To-Dos tab. Fetches the first paint and hands off to `TodosBoard`, which
 * holds the live subscription (N51) — see its header for why realtime, not
 * more revalidation, is the fix.
 *
 * `?archived=` and `?owner=` stay server-read: they are navigational, the
 * controls that set them already push a URL, and keeping them here means the
 * board never has to guess at a filter the server has already validated
 * against the roster.
 */
export default async function TodosPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ archived?: string; owner?: string }>;
}) {
  const { teamId: tid } = await params;
  const { archived: archivedParam, owner: ownerParam } = await searchParams;
  const showArchived = archivedParam === "1" || archivedParam === "true";
  const { uid, db, team } = await requireTeamAccess(tid);
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

  const [snap, rocksSnap] = await Promise.all([
    db.collection("todos").where("team_id", "==", tid).get(),
    db.collection("rocks").where("team_id", "==", tid).get(),
  ]);

  // Project plain fields — Timestamps can't cross the RSC boundary — and drop
  // other people's private rows here rather than in the client. The client's
  // own subscription is already scoped that way by the todos rule; matching it
  // on the server keeps private titles out of the serialized page payload,
  // where view-source would reach them even though the UI hid them.
  const initialTodos: TodoBoardDoc[] = [];
  for (const d of snap.docs) {
    const t = d.data() as TodoDoc;
    const visibility = t.visibility === "private" ? "private" : "team";
    // String-compare so a type quirk can never hide the viewer's own rows.
    if (visibility === "private" && String(t.owner_id ?? "") !== String(uid)) {
      continue;
    }
    initialTodos.push({
      id: d.id,
      title: t.title,
      description: t.description ?? null,
      owner_id: t.owner_id ?? null,
      due_date: t.due_date ?? null,
      completed_at: toMillis(t.completed_at),
      archived_at: toMillis(t.archived_at),
      visibility,
      weekly_focus: t.weekly_focus === true,
      source_rock_id: t.source_rock_id ?? null,
    });
  }

  const initialRocks: RockBoardDoc[] = rocksSnap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      title: String(x.title ?? "Rock"),
      status: String(x.status ?? ""),
      archived_at: toMillis(x.archived_at),
    };
  });

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
    />
  );
}
