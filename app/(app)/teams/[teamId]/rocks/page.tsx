import { requireTeamAccess, getTeamMembers } from "@/lib/teams";
import { currentQuarter } from "@/lib/dates";
import { StatusSelect } from "./status-select";
import { addRock } from "./actions";

export default async function RocksPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const { supabase, team } = await requireTeamAccess(teamId);
  const members = await getTeamMembers(teamId);

  const quarter = currentQuarter();

  const { data: rocks } = await supabase
    .from("rocks")
    .select("id, title, owner_id, quarter, due_date, status, description")
    .eq("team_id", teamId)
    .order("status", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false });

  const ownerName = (id: string | null) =>
    id ? members.find((m) => m.user_id === id)?.full_name ?? "—" : "—";

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rocks</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {team.name} · current quarter {quarter}
          </p>
        </div>
      </header>

      <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100">
        {(rocks ?? []).length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">
            No rocks yet. Add one below.
          </div>
        )}
        {(rocks ?? []).map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-12 gap-3 px-4 py-3 items-center text-sm"
          >
            <div className="col-span-6">
              <div className="font-medium">{r.title}</div>
              {r.description && (
                <div className="text-xs text-zinc-500 mt-0.5 line-clamp-1">
                  {r.description}
                </div>
              )}
              <div className="text-xs text-zinc-400 mt-0.5">{r.quarter}</div>
            </div>
            <div className="col-span-3 text-zinc-600">
              {ownerName(r.owner_id)}
            </div>
            <div className="col-span-1 text-zinc-500 text-xs">
              {r.due_date
                ? new Date(r.due_date).toLocaleDateString()
                : "—"}
            </div>
            <div className="col-span-2 justify-self-end">
              <StatusSelect
                teamId={teamId}
                rockId={r.id}
                status={r.status}
              />
            </div>
          </div>
        ))}
      </div>

      <AddRockForm teamId={teamId} members={members} quarter={quarter} />
    </div>
  );
}

function AddRockForm({
  teamId,
  members,
  quarter,
}: {
  teamId: string;
  members: { user_id: string; full_name: string }[];
  quarter: string;
}) {
  async function action(formData: FormData) {
    "use server";
    await addRock(teamId, formData);
  }
  return (
    <form
      action={action}
      className="rounded-xl border border-zinc-200 bg-white p-4 grid grid-cols-1 md:grid-cols-6 gap-3"
    >
      <input
        name="title"
        placeholder="Rock title"
        required
        className="md:col-span-3 rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
      />
      <input
        name="quarter"
        defaultValue={quarter}
        required
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
      />
      <input
        name="due_date"
        type="date"
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
      />
      <select
        name="owner_id"
        defaultValue=""
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
      >
        <option value="">— owner —</option>
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.full_name}
          </option>
        ))}
      </select>
      <textarea
        name="description"
        placeholder="What does done look like? (optional)"
        rows={2}
        className="md:col-span-6 rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
      />
      <button
        type="submit"
        className="md:col-span-6 md:justify-self-end rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
      >
        Add rock
      </button>
    </form>
  );
}
