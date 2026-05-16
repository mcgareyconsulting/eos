import { requireTeamAccess, getTeamMembers } from "@/lib/teams";
import { Users, UserCircle2 } from "lucide-react";
import { addHeadline, deleteHeadline } from "./actions";
import { mondayOf, toDateString } from "@/lib/dates";

export default async function HeadlinesPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const { supabase, team } = await requireTeamAccess(teamId);
  const members = await getTeamMembers(teamId);

  const sinceMonday = toDateString(mondayOf());
  const { data: headlines } = await supabase
    .from("headlines")
    .select("id, title, body, kind, created_by, created_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });

  const authorName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  const thisWeek = (headlines ?? []).filter(
    (h) => h.created_at.slice(0, 10) >= sinceMonday,
  );
  const earlier = (headlines ?? []).filter(
    (h) => h.created_at.slice(0, 10) < sinceMonday,
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Headlines</h1>
        <p className="mt-1 text-sm text-zinc-500">{team.name}</p>
      </header>

      <Section title={`This week (${thisWeek.length})`}>
        {thisWeek.length === 0 && <Empty>No headlines yet this week.</Empty>}
        {thisWeek.map((h) => (
          <HeadlineRow
            key={h.id}
            teamId={teamId}
            headline={h}
            authorName={authorName(h.created_by)}
          />
        ))}
      </Section>

      {earlier.length > 0 && (
        <Section title="Earlier">
          {earlier.map((h) => (
            <HeadlineRow
              key={h.id}
              teamId={teamId}
              headline={h}
              authorName={authorName(h.created_by)}
            />
          ))}
        </Section>
      )}

      <AddHeadlineForm teamId={teamId} />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 mb-2">
        {title}
      </h2>
      <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100">
        {children}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-sm text-zinc-500">{children}</div>;
}

function HeadlineRow({
  teamId,
  headline,
  authorName,
}: {
  teamId: string;
  headline: {
    id: string;
    title: string;
    body: string | null;
    kind: string;
    created_at: string;
  };
  authorName: string;
}) {
  async function remove() {
    "use server";
    await deleteHeadline(teamId, headline.id);
  }
  const Icon = headline.kind === "customer" ? Users : UserCircle2;
  const tagColor =
    headline.kind === "customer"
      ? "text-blue-600 bg-blue-50"
      : "text-purple-600 bg-purple-50";

  return (
    <div className="group flex items-start gap-3 px-4 py-3 text-sm">
      <span className={`mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full ${tagColor}`}>
        <Icon className="w-3.5 h-3.5" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-medium">{headline.title}</div>
        {headline.body && (
          <div className="text-sm text-zinc-600 mt-0.5">{headline.body}</div>
        )}
        <div className="text-xs text-zinc-400 mt-1">
          {authorName} · {new Date(headline.created_at).toLocaleString()}
        </div>
      </div>
      <form action={remove}>
        <button
          type="submit"
          className="text-xs text-zinc-300 hover:text-red-600 opacity-0 group-hover:opacity-100"
        >
          Delete
        </button>
      </form>
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
      className="rounded-xl border border-zinc-200 bg-white p-4 grid grid-cols-1 md:grid-cols-6 gap-3"
    >
      <input
        name="title"
        placeholder="Headline (e.g. New customer signed)"
        required
        className="md:col-span-4 rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
      />
      <select
        name="kind"
        defaultValue="customer"
        className="md:col-span-2 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
      >
        <option value="customer">Customer</option>
        <option value="employee">Employee</option>
      </select>
      <textarea
        name="body"
        placeholder="Details (optional)"
        rows={2}
        className="md:col-span-6 rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
      />
      <button
        type="submit"
        className="md:col-span-6 md:justify-self-end rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
      >
        Add headline
      </button>
    </form>
  );
}
