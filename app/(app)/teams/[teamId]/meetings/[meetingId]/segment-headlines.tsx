"use client";

import { useMemo, useState } from "react";
import { Archive, Megaphone, Trash2 } from "lucide-react";
import {
  collection,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import { groupByOwner, splitCascadingSection } from "@/lib/headlines";
import { normalizeDescription } from "@/lib/csv-import";
import { RichText } from "@/components/rich-text";
import { ConfirmSubmitForm } from "@/components/confirm-submit-form";
import { EmptyState } from "@/components/empty-state";
import { EntityViewToggle } from "@/components/entity-view-toggle";
import { deleteHeadline, setHeadlineArchived } from "../../headlines/actions";
import { AddHeadlineModal } from "../../headlines/add-headline-modal";
import { HeadlineDiscussedCheckbox } from "../../headlines/headline-checkbox";
import { HeadlineEditButton } from "../../headlines/headline-edit-modal";
import { LocalTime } from "@/components/local-time";
import { QuickAddIssue } from "@/components/quick-add-issue";

// created_at arrives as a Firestore Timestamp from onSnapshot, but as a
// plain millis number when pre-rendered on the server (RSC boundary can't
// carry Timestamp class instances). Accept either.
type MaybeTimestamp =
  | { toMillis: () => number; toDate: () => Date }
  | number
  | null;

function tsMs(t: MaybeTimestamp): number | null {
  if (t == null) return null;
  if (typeof t === "number") return t;
  return typeof t.toMillis === "function" ? t.toMillis() : null;
}

export type HeadlineDoc = {
  id: string;
  team_id: string;
  title: string;
  body: string | null;
  kind: "customer" | "employee" | "cascading" | "general";
  created_by: string | null;
  created_at: MaybeTimestamp;
  discussed?: boolean;
  archived_at?: MaybeTimestamp;
  broadcast?: boolean;
  from_label?: string | null;
  source_owner_name?: string | null;
};

type Member = { user_id: string; full_name: string };

const KIND_LABEL: Record<HeadlineDoc["kind"], string> = {
  customer: "Customer",
  employee: "Employee",
  cascading: "Cascading",
  general: "General / FYI",
};

function isArchived(h: HeadlineDoc): boolean {
  return h.archived_at != null;
}

export function SegmentHeadlines({
  teamId,
  meetingId,
  userId,
  initialHeadlines,
  members,
}: {
  teamId: string;
  meetingId: string;
  userId: string;
  initialHeadlines: HeadlineDoc[];
  members: Member[];
}) {
  const db = getClientDb();

  const q = useMemo(
    () =>
      fsQuery(collection(db, "headlines"), where("team_id", "==", teamId)),
    [db, teamId],
  );
  const headlines = useCollection<HeadlineDoc>(q, initialHeadlines);
  const [showArchived, setShowArchived] = useState(false);

  // Active only — archived drop out of the live L10 list (selective archive).
  const active = headlines.filter((h) => !isArchived(h));
  const archived = headlines.filter((h) => isArchived(h));
  // Undiscussed first (still need airtime), then discussed, then by recency.
  const byDiscussedThenRecency = (a: HeadlineDoc, b: HeadlineDoc) => {
    const ad = a.discussed === true ? 1 : 0;
    const bd = b.discussed === true ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return (tsMs(b.created_at) ?? 0) - (tsMs(a.created_at) ?? 0);
  };

  const creatorName = (h: HeadlineDoc) => {
    if (h.created_by === userId) return "You";
    if (h.created_by) {
      return members.find((m) => m.user_id === h.created_by)?.full_name ?? "—";
    }
    return h.source_owner_name || h.from_label || "—";
  };

  // Team's own headlines (grouped by owner) separated from cascading —
  // cascading-kind headlines this team posted plus incoming broadcast
  // copies from elsewhere in the org. Same split/grouping rules as the
  // standalone Headlines tab (lib/headlines.ts) so the two surfaces agree.
  const { team, cascading } = splitCascadingSection(active);
  const sortedTeam = [...team].sort(byDiscussedThenRecency);
  const sortedCascading = [...cascading].sort(byDiscussedThenRecency);
  const ownerGroups = groupByOwner(sortedTeam, creatorName);

  function renderRow(h: HeadlineDoc) {
    const kindLabel = KIND_LABEL[h.kind] ?? KIND_LABEL.customer;
    const remove = deleteHeadline.bind(null, teamId, h.id);
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

    const closedOnMs = archivedRow ? tsMs(h.archived_at ?? null) : null;
    const closedOn =
      closedOnMs != null
        ? (() => {
            const d = new Date(closedOnMs);
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
            disabled={readOnly}
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
                Org-wide · read-only
              </span>
            )}
          </div>
          {archivedRow && closedOn && (
            <div className="mt-0.5 text-xs tabular-nums text-zinc-500">
              Closed On: {closedOn}
            </div>
          )}
          {body && (
            <RichText
              value={body}
              className="mt-0.5 text-zinc-600 dark:text-zinc-400"
            />
          )}
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
            {kindLabel}
            {h.from_label ? ` · ${h.from_label}` : ""} ·{" "}
            {creatorName(h)} ·{" "}
            <LocalTime
              ms={tsMs(h.created_at)}
              options={{
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }}
            />
          </div>
        </div>
        {!readOnly && (
          <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
            <HeadlineEditButton
              teamId={teamId}
              headline={{
                id: h.id,
                title: h.title,
                body: h.body,
                kind: h.kind,
              }}
            />
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
            {!archivedRow && (
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
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <EntityViewToggle
          showArchived={showArchived}
          onChange={setShowArchived}
          activeCount={active.length}
          archivedCount={archived.length}
        />
        <div className="flex items-center gap-2">
          <AddHeadlineModal teamId={teamId} compact />
          <QuickAddIssue
            teamId={teamId}
            prefill="From headline: "
            meetingId={meetingId}
          />
        </div>
      </div>

      {showArchived ? (
        <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
          {archived.length === 0 && (
            <EmptyState
              icon={Megaphone}
              title="No archived headlines"
              hint="Headlines marked discussed are archived when an L10 ends."
            />
          )}
          {archived.map(renderRow)}
        </div>
      ) : active.length === 0 ? (
        <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <EmptyState
            icon={Megaphone}
            title="No headlines yet"
            hint="Share customer wins, employee news, and cascading messages."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {ownerGroups.length > 0 && (
            <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
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

          {sortedCascading.length > 0 && (
            <div>
              <h2 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Cascading
              </h2>
              <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
                {sortedCascading.map(renderRow)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
