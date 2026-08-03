import { Trash2, Smile, Users, Megaphone } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Timestamp } from "firebase-admin/firestore";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { normalizeDescription } from "@/lib/csv-import";
import { addHeadline, deleteHeadline } from "./actions";

type HeadlineDoc = {
  team_id: string;
  title: string;
  body: string | null;
  kind: "customer" | "employee" | "cascading";
  created_by: string | null;
  target_team_ids: string[];
  created_at: Timestamp | null;
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

export default async function HeadlinesPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const { uid, db, team } = await requireTeamAccess(teamId);
  const members = await getTeamMembers(teamId);

  const snap = await db
    .collection("headlines")
    .where("team_id", "==", teamId)
    .get();

  const headlines = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as HeadlineDoc) }))
    .sort((a, b) => {
      const at = a.created_at?.toMillis?.() ?? 0;
      const bt = b.created_at?.toMillis?.() ?? 0;
      return bt - at;
    });

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
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Headlines</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {team.name} · customer wins, employee news, and cascading messages
          (org-wide cascades are read-only)
        </p>
      </header>

      <AddHeadlineForm teamId={teamId} />

      <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {headlines.length === 0 && (
          <EmptyState
            icon={Megaphone}
            title="No headlines yet"
            hint="Share customer wins, employee news, and cascading messages with the form above."
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
          return (
            <div
              key={h.id}
              className="group flex items-start gap-3 px-4 py-3 text-sm"
            >
              <div
                className={`mt-0.5 rounded-full p-1.5 ring-1 ring-inset ${meta.badge}`}
                title={meta.label}
              >
                <meta.Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium">{h.title}</div>
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
                <form action={remove}>
                  <button
                    type="submit"
                    className="mt-1 text-zinc-300 opacity-0 hover:text-red-600 group-hover:opacity-100 dark:text-zinc-600"
                    aria-label="Delete headline"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </form>
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
