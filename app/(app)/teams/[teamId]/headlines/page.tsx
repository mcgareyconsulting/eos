import { Trash2, Smile, Users, Megaphone } from "lucide-react";
import { Timestamp } from "firebase-admin/firestore";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { addHeadline, deleteHeadline } from "./actions";

type HeadlineDoc = {
  team_id: string;
  title: string;
  body: string | null;
  kind: "customer" | "employee" | "cascading";
  created_by: string | null;
  target_team_ids: string[];
  created_at: Timestamp | null;
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

  const creatorName = (id: string | null) =>
    id === uid
      ? "You"
      : id
        ? (members.find((m) => m.user_id === id)?.full_name ?? "—")
        : "—";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Headlines</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {team.name} · customer wins, employee news, and cascading messages
        </p>
      </header>

      <AddHeadlineForm teamId={teamId} />

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
        {headlines.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No headlines yet. Add one above.
          </div>
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
          return (
            <div
              key={h.id}
              className="group flex items-start gap-3 px-4 py-3 text-sm"
            >
              <div
                className={`mt-0.5 rounded-full p-1.5 ring-1 ring-inset ${meta.badge}`}
                title={meta.label}
              >
                <meta.Icon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium">{h.title}</div>
                {h.body && (
                  <div className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                    {h.body}
                  </div>
                )}
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                  {meta.label} · {creatorName(h.created_by)} · {when}
                </div>
              </div>
              <form action={remove}>
                <button
                  type="submit"
                  className="text-zinc-300 dark:text-zinc-600 hover:text-red-600 opacity-0 group-hover:opacity-100 mt-1"
                  aria-label="Delete headline"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </form>
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
      className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 grid grid-cols-1 md:grid-cols-6 gap-3"
    >
      <input
        name="title"
        placeholder="Headline (one line)"
        required
        className="md:col-span-4 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
      />
      <select
        name="kind"
        defaultValue="customer"
        className="md:col-span-2 rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-sm"
      >
        <option value="customer">Customer</option>
        <option value="employee">Employee</option>
        <option value="cascading">Cascading</option>
      </select>
      <textarea
        name="body"
        placeholder="Detail (optional)"
        rows={2}
        className="md:col-span-6 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
      />
      <button
        type="submit"
        className="md:col-span-6 md:justify-self-end rounded-md bg-zinc-900 dark:bg-zinc-100 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Add headline
      </button>
    </form>
  );
}
