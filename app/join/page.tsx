import { redirect } from "next/navigation";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import { signOut } from "@/app/(app)/sign-out-action";
import { EnvBadge } from "@/components/env-badge";
import { requestToJoin } from "./actions";

type RequestStatus = "pending" | "approved" | "denied";

export default async function JoinPage() {
  const { uid, name, email, db } = await requireFirebaseUser();

  // If they already belong to a team, they don't need this page.
  const myMemberships = await db
    .collection("team_members")
    .where("user_id", "==", uid)
    .limit(1)
    .get();
  if (!myMemberships.empty) redirect("/home");

  const [teamsSnap, requestsSnap] = await Promise.all([
    db.collection("teams").orderBy("name").get(),
    db.collection("team_join_requests").where("user_id", "==", uid).get(),
  ]);

  const statusByTeam = new Map<string, RequestStatus>();
  for (const d of requestsSnap.docs) {
    statusByTeam.set(d.data().team_id as string, d.data().status as RequestStatus);
  }

  const teams = teamsSnap.docs.map((d) => ({
    id: d.id,
    name: (d.data().name as string) ?? "Team",
    status: statusByTeam.get(d.id) ?? null,
  }));

  const hasPending = teams.some((t) => t.status === "pending");

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-zinc-50 dark:bg-zinc-950">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <EnvBadge className="mb-3" />
          <span className="block text-lg font-bold uppercase tracking-wide text-hpb-blue dark:text-hpb-gold">
            High Plains Bank
          </span>
          <span className="mt-0.5 block text-[10px] italic text-zinc-600 dark:text-zinc-400">
            Employee Owned • Community Driven
          </span>
        </div>

        <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <h1 className="text-xl font-semibold tracking-tight">
            Join a team
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            You&apos;re signed in as{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {name || email}
            </span>{" "}
            but aren&apos;t on a team yet. Request to join one below — a team
            leader will approve your access.
          </p>

          {hasPending && (
            <p className="mt-3 rounded-md bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-200 dark:ring-amber-900">
              You have a pending request. You&apos;ll get access as soon as a
              leader approves it.
            </p>
          )}

          <div className="mt-5 divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-300 dark:border-zinc-800">
            {teams.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
                No teams exist yet. Ask an administrator to set one up.
              </div>
            )}
            {teams.map((t) => {
              const request = requestToJoin.bind(null, t.id);
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="text-sm font-medium">{t.name}</span>
                  {t.status === "pending" ? (
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                      Requested · pending
                    </span>
                  ) : (
                    <form action={request}>
                      <button
                        type="submit"
                        className="rounded-md bg-hpb-blue px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                      >
                        {t.status === "denied"
                          ? "Request again"
                          : "Request to join"}
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 text-center">
          <form action={signOut}>
            <button
              type="submit"
              className="text-xs text-zinc-600 dark:text-zinc-400 underline-offset-2 hover:underline"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
