import { Check, X } from "lucide-react";
import { requireTeamAccess, getTeamMembers } from "@/lib/firebase/teams";
import { approveJoinRequest, denyJoinRequest } from "./actions";

type JoinRequest = {
  user_id: string;
  requester_name: string | null;
  requester_email: string | null;
};

export default async function MembersPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId: tid } = await params;
  const { uid, db, team } = await requireTeamAccess(tid);
  const members = await getTeamMembers(tid);

  const isLeader = members.some(
    (m) => m.user_id === uid && m.role === "leader",
  );

  // Pending join requests (only leaders act on them).
  let pending: JoinRequest[] = [];
  if (isLeader) {
    const snap = await db
      .collection("team_join_requests")
      .where("team_id", "==", tid)
      .where("status", "==", "pending")
      .get();
    pending = snap.docs.map((d) => ({
      user_id: d.data().user_id as string,
      requester_name: (d.data().requester_name as string) ?? null,
      requester_email: (d.data().requester_email as string) ?? null,
    }));
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {team.name} · {members.length}{" "}
          {members.length === 1 ? "member" : "members"}
        </p>
      </header>

      {isLeader && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Pending requests
            {pending.length > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 dark:bg-amber-950 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                {pending.length}
              </span>
            )}
          </h2>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
            {pending.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                No pending requests.
              </div>
            )}
            {pending.map((r) => {
              const approve = approveJoinRequest.bind(null, tid, r.user_id);
              const deny = denyJoinRequest.bind(null, tid, r.user_id);
              return (
                <div
                  key={r.user_id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {r.requester_name || r.requester_email || r.user_id}
                    </div>
                    {r.requester_email && (
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        {r.requester_email}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <form action={approve}>
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Approve
                      </button>
                    </form>
                    <form action={deny}>
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <X className="h-3.5 w-3.5" />
                        Deny
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Team members
        </h2>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
          {members.map((m) => (
            <div
              key={m.user_id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span className="font-medium">{m.full_name}</span>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                  m.role === "leader"
                    ? "bg-hpb-blue/10 text-hpb-blue ring-hpb-blue/20 dark:text-hpb-gold dark:ring-hpb-gold/20"
                    : "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700"
                }`}
              >
                {m.role === "leader" ? "Leader" : "Member"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
