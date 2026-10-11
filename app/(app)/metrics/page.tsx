import { getUserTeamsFirebase } from "@/lib/firebase/auth";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import { loadPublicMetricBoard } from "@/lib/firebase/scorecard-catalog";
import { formatGoal, formatValue } from "@/lib/scorecard";
import { TrackButton } from "./track-button";

/**
 * The org metric board (docs/PERMISSIONS_SPEC.md 3.4): every public metric,
 * with its team, owner, goal and recent values. Any person may read it. Each
 * team the viewer is rostered on gets an "Add to <team>" action; tracking a
 * metric never makes the viewer a follower and never grants edit rights.
 */
export default async function MetricBoardPage() {
  const { db } = await requireFirebaseUser();
  const { teams, membershipTeamIds } = await getUserTeamsFirebase();
  const myTeams = teams.filter((t) => membershipTeamIds.includes(t.id));
  const metrics = await loadPublicMetricBoard(db);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Metric board</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Public measurables from every team. Add one to your team&rsquo;s
          scorecard to track it; the owning team keeps editing it.
        </p>
      </header>

      {metrics.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No public measurables yet. A team member can make one public from its
          edit form.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">Measurable</th>
                <th className="px-3 py-2 font-medium">Team</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Goal</th>
                <th className="px-3 py-2 font-medium">Recent (newest first)</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr
                  key={m.id}
                  className="border-t border-zinc-100 align-top dark:border-zinc-800"
                >
                  <td className="px-3 py-2 font-medium">{m.name}</td>
                  <td className="px-3 py-2">{m.teamName}</td>
                  <td className="px-3 py-2">{m.ownerName || "—"}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {m.goal == null ? "—" : formatGoal(m.goal, m.direction, m.unit)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {m.recent.length === 0
                      ? "—"
                      : m.recent
                          .map((r) => formatValue(r.value, m.unit))
                          .join(" · ")}
                  </td>
                  <td className="space-y-1 px-3 py-2">
                    {myTeams.map((t) =>
                      t.id === m.teamId ? null : m.trackingTeamIds.includes(
                          t.id,
                        ) ? (
                        <span
                          key={t.id}
                          className="block text-xs text-zinc-500"
                        >
                          Tracked by {t.name}
                        </span>
                      ) : (
                        <TrackButton
                          key={t.id}
                          teamId={t.id}
                          teamName={t.name}
                          metricId={m.id}
                        />
                      ),
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
