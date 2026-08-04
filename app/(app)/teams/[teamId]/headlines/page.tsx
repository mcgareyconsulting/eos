import Link from "next/link";
import { Archive, Megaphone, Smile, Trash2, Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Timestamp } from "firebase-admin/firestore";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { normalizeDescription } from "@/lib/csv-import";
import {
  addHeadline,
  deleteHeadline,
  setHeadlineArchived,
} from "./actions";
import { HeadlineDiscussedCheckbox } from "./headline-checkbox";

type HeadlineDoc = {
  team_id: string;
  title: string;
  body: string | null;
  kind: "customer" | "employee" | "cascading";
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

const KIND_META: Record<
  HeadlineDoc["kind"],
  { label: string; badge: string; Icon: typeof Smile }
> = {
  customer: {
    label: "Customer",
    badge:
      "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 ring-emerald-200",
    Icon: Smile,
  },
  employee: {
    label: "Employee",
    badge:
      "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 ring-blue-200",
    Icon: Users,
  },
  cascading: {
    label: "Cascading",
    badge:
      "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 ring-amber-200",
    Icon: Megaphone,
  },
};

function isArchived(h: HeadlineDoc): boolean {
  return h.archived_at != null;
}

export default async function HeadlinesPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ archived?: string }>;
}) {
  const { teamId } = await params;
  const { archived: archivedParam } = await searchParams;
  const showArchived = archivedParam === "1" || archivedParam === "true";
  const { uid, db } = await requireTeamAccess(teamId);
  const members = await getTeamMembers(teamId);

  const snap = await db
    .collection("headlines")
    .where("team_id", "==", teamId)
    .get();

  const all = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as HeadlineDoc) }))
    .sort((a, b) => {
      const at = a.created_at?.toMillis?.() ?? 0;
      const bt = b.created_at?.toMillis?.() ?? 0;
      return bt - at;
    });

  const active = all.filter((h) => !isArchived(h));
  const archived = all.filter((h) => isArchived(h));
  const headlines = showArchived ? archived : active;

  const creatorName = (h: HeadlineDoc) => {
    if (h.created_by === uid) return "You";
    if (h.created_by) {
      return (
        members.find((m) => m.user_id === h.created_by)?.full_name ?? "—"
      );
    }
    return h.source_owner_name || h.from_label || "—";
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Headlines</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Check off discussed items in the L10. Only checked headlines archive
            when the meeting ends — standing items stay.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/teams/${teamId}/headlines`}
            className={
              !showArchived
                ? "rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "rounded-md px-3 py-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }
          >
            Active ({active.length})
          </Link>
          <Link
            href={`/teams/${teamId}/headlines?archived=1`}
            className={
              showArchived
                ? "inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }
          >
            <Archive className="h-3.5 w-3.5" />
            Archived ({archived.length})
          </Link>
        </div>
      </header>

      {!showArchived && <AddHeadlineForm teamId={teamId} />}

      <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {headlines.length === 0 && (
          <EmptyState
            icon={showArchived ? Archive : Megaphone}
            title={showArchived ? "No archived headlines" : "No headlines yet"}
            hint={
              showArchived
                ? "Headlines marked discussed are archived when an L10 ends."
                : "Share customer wins, employee news, and cascading messages with the form above."
            }
          />
        )}
        {headlines.map((h) => {
          const meta = KIND_META[h.kind] ?? KIND_META.customer;
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

          return (
            <div
              key={h.id}
              className={`group flex items-start gap-3 px-4 py-3 text-sm ${
                discussed && !archivedRow ? "bg-zinc-50/80 dark:bg-zinc-950/40" : ""
              } ${archivedRow ? "opacity-70" : ""}`}
            >
              {!archivedRow && (
                <HeadlineDiscussedCheckbox
                  teamId={teamId}
                  headlineId={h.id}
                  discussed={discussed}
                  disabled={readOnly}
                />
              )}
              <div
                className={`mt-0.5 rounded-full p-1.5 ring-1 ring-inset ${meta.badge}`}
                title={meta.label}
              >
                <meta.Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className={`font-medium ${discussed && !archivedRow ? "text-zinc-600 line-through dark:text-zinc-400" : ""}`}
                  >
                    {h.title}
                  </div>
                  {discussed && !archivedRow && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800">
                      Discussed
                    </span>
                  )}
                  {readOnly && (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700">
                      Org-wide · read-only
                    </span>
                  )}
                </div>
                {body && (
                  <div className="mt-0.5 whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
                    {body}
                  </div>
                )}
                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
                  {meta.label}
                  {h.from_label ? ` · ${h.from_label}` : ""} ·{" "}
                  {creatorName(h)} · {when}
                </div>
              </div>
              {!readOnly && (
                <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
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
                    <form action={remove}>
                      <button
                        type="submit"
                        className="rounded p-1 text-zinc-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                        aria-label="Delete headline"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddHeadlineForm({ teamId }: { teamId: string }) {
  async function action(formData: FormData) {
    "use server";
    await addHeadline(teamId, formData);
  }
  return (
    <form
      action={action}
      className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-300 bg-white p-4 md:grid-cols-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <input
        name="title"
        placeholder="Headline (one line)"
        required
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 md:col-span-4"
      />
      <select
        name="kind"
        defaultValue="customer"
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 md:col-span-2"
      >
        <option value="customer">Customer</option>
        <option value="employee">Employee</option>
        <option value="cascading">Cascading</option>
      </select>
      <textarea
        name="body"
        placeholder="Detail (optional)"
        rows={2}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 md:col-span-6"
      />
      <PendingSubmitButton
        idleLabel="Add headline"
        pendingLabel="Adding…"
        className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 md:col-span-6 md:justify-self-end"
      />
    </form>
  );
}
