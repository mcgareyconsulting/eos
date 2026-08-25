import { Archive, Megaphone, Trash2 } from "lucide-react";
import { ConfirmSubmitForm } from "@/components/confirm-submit-form";
import { EmptyState } from "@/components/empty-state";
import { EntityPageHeader } from "@/components/entity-page-header";
import { EntityViewTabs } from "@/components/entity-view-tabs";
import { OwnerFilter } from "@/components/owner-filter";
import { Timestamp } from "firebase-admin/firestore";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { normalizeDescription } from "@/lib/csv-import";
import { HeadlineBody } from "./headline-body";
import { groupByOwner, splitCascadingSection } from "@/lib/headlines";
import { deleteHeadline, setHeadlineArchived } from "./actions";
import { AddHeadlineModal } from "./add-headline-modal";
import { HeadlineDiscussedCheckbox } from "./headline-checkbox";
import { HeadlineEditButton } from "./headline-edit-modal";

type HeadlineDoc = {
  id: string;
  team_id: string;
  title: string;
  body: string | null;
  kind: "customer" | "employee" | "cascading" | "general";
  created_by: string | null;
  target_team_ids: string[];
  created_at: Timestamp | null;
  discussed?: boolean;
  archived_at?: Timestamp | null;
  /** Org-wide cascade from outside this team — show, don't delete. */
  broadcast?: boolean;
  from_label?: string | null;
  source_owner_name?: string | null;
};

const KIND_LABEL: Record<HeadlineDoc["kind"], string> = {
  customer: "Customer",
  employee: "Employee",
  cascading: "Cascading",
  general: "General / FYI",
};

function isArchived(h: HeadlineDoc): boolean {
  return h.archived_at != null;
}

export default async function HeadlinesPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ archived?: string; owner?: string }>;
}) {
  const { teamId } = await params;
  const { archived: archivedParam, owner: ownerParam } = await searchParams;
  const showArchived = archivedParam === "1" || archivedParam === "true";
  const { uid, db } = await requireTeamAccess(teamId);
  const members = await getTeamMembers(teamId);

  const snap = await db
    .collection("headlines")
    .where("team_id", "==", teamId)
    .get();

  const all = snap.docs
    .map((d) => ({ ...(d.data() as HeadlineDoc), id: d.id }))
    .sort((a, b) => {
      const at = a.created_at?.toMillis?.() ?? 0;
      const bt = b.created_at?.toMillis?.() ?? 0;
      return bt - at;
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

  const matchesOwner = (h: HeadlineDoc) =>
    ownerFilter === "all" || h.created_by === ownerFilter;

  const active = all.filter((h) => !isArchived(h));
  const archived = all.filter((h) => isArchived(h));
  const headlines = (showArchived ? archived : active).filter(matchesOwner);

  const creatorName = (h: HeadlineDoc) => {
    if (h.created_by === uid) return "You";
    if (h.created_by) {
      return (
        members.find((m) => m.user_id === h.created_by)?.full_name ?? "—"
      );
    }
    return h.source_owner_name || h.from_label || "—";
  };

  function renderRow(h: HeadlineDoc) {
    const kindLabel = KIND_LABEL[h.kind] ?? KIND_LABEL.customer;
    const remove = deleteHeadline.bind(null, teamId, h.id);
    const when =
      h.created_at?.toDate?.()?.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }) ?? "—";
    const body = normalizeDescription(h.body);
    const readOnly = !!h.broadcast;
    const discussed = h.discussed === true;
    const archivedRow = isArchived(h);
    const toggleArchive = setHeadlineArchived.bind(
      null,
      teamId,
      h.id,
      !archivedRow,
    );

    const closedOn =
      archivedRow && h.archived_at?.toDate
        ? (() => {
            const d = h.archived_at.toDate();
            return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
          })()
        : null;

    return (
      <div
        key={h.id}
        className={`group flex items-start gap-3 px-4 py-3 text-sm ${
          discussed && !archivedRow
            ? "bg-zinc-50/90 text-zinc-500 dark:bg-zinc-950/40 dark:text-zinc-400"
            : ""
        }`}
      >
        {!archivedRow && (
          <HeadlineDiscussedCheckbox
            teamId={teamId}
            headlineId={h.id}
            discussed={discussed}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div
              className={`font-medium ${
                discussed && !archivedRow
                  ? "text-zinc-500 dark:text-zinc-400"
                  : ""
              }`}
            >
              {h.title}
            </div>
            {discussed && !archivedRow && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400">
                Discussed · closes Monday
              </span>
            )}
            {readOnly && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700">
                Org-wide · text is read-only
              </span>
            )}
          </div>
          {archivedRow && closedOn && (
            <div className="mt-0.5 text-xs tabular-nums text-zinc-500">
              Closed On: {closedOn}
            </div>
          )}
          {body && <HeadlineBody body={body} />}
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
            {kindLabel}
            {h.from_label ? ` · ${h.from_label}` : ""} ·{" "}
            {creatorName(h)} · {when}
          </div>
        </div>
        {/* Archive stays available on a broadcast copy — closing this team's
            own copy is a per-team act and leaves every other team's queue
            alone. Edit and delete do not: those would rewrite the org's
            message for whoever cascaded it. */}
        <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
          {!readOnly && (
            <HeadlineEditButton
              teamId={teamId}
              headline={{
                id: h.id,
                title: h.title,
                body: h.body,
                kind: h.kind,
              }}
            />
          )}
          <form action={toggleArchive}>
            <button
              type="submit"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label={archivedRow ? "Restore headline" : "Archive headline"}
              title={archivedRow ? "Restore" : "Archive now"}
            >
              <Archive className="h-4 w-4" />
            </button>
          </form>
          {!archivedRow && !readOnly && (
            <ConfirmSubmitForm
              action={remove}
              confirmMessage="Delete this headline? This can't be undone."
            >
              <button
                type="submit"
                className="rounded p-1 text-zinc-300 hover:bg-red-50 hover:text-red-600 dark:text-zinc-600 dark:hover:bg-red-950/40"
                aria-label="Delete headline"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </ConfirmSubmitForm>
          )}
        </div>
      </div>
    );
  }

  // Active view: team's own headlines (grouped by owner) separated from
  // cascading — cascading-kind headlines this team posted plus incoming
  // broadcast copies from elsewhere in the org. Archived view stays flat;
  // there's no "owner" story once something's closed out.
  const { team: teamHeadlines, cascading: cascadingHeadlines } =
    splitCascadingSection(active.filter(matchesOwner));
  const ownerGroups = groupByOwner(teamHeadlines, creatorName);

  return (
    <div className="space-y-6">
      <EntityPageHeader
        title="Headlines"
        filter={<OwnerFilter members={members} currentUserId={uid} />}
        tabs={
          <EntityViewTabs
            basePath={`/teams/${teamId}/headlines`}
            showArchived={showArchived}
            activeCount={active.length}
            archivedCount={archived.length}
            owner={ownerFilter !== "all" ? ownerFilter : undefined}
          />
        }
        add={<AddHeadlineModal teamId={teamId} />}
      />

      {showArchived ? (
        <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {headlines.length === 0 && (
            <EmptyState
              icon={Archive}
              title="No archived headlines"
              hint="Headlines marked discussed are archived when an L10 ends."
            />
          )}
          {headlines.map(renderRow)}
        </div>
      ) : ownerGroups.length === 0 && cascadingHeadlines.length === 0 ? (
        <div className="rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <EmptyState
            icon={Megaphone}
            title="No headlines yet"
            hint="Share customer wins, employee news, and cascading messages."
          />
        </div>
      ) : (
        <>
          {ownerGroups.length > 0 && (
            <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {ownerGroups.map((group) => (
                <div key={group.name}>
                  <div className="bg-zinc-50 px-4 py-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-500">
                    {group.name}
                  </div>
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {group.headlines.map(renderRow)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {cascadingHeadlines.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                Cascading
              </h2>
              <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
                {cascadingHeadlines.map(renderRow)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
