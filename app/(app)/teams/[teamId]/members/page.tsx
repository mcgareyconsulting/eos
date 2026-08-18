import { Check, X, Video, Compass } from "lucide-react";
import { getUserTeamsFirebase } from "@/lib/firebase/auth";
import {
  requireTeamAccess,
  getTeamMembers,
  getOrgDirectory,
  getOrgAdmins,
} from "@/lib/firebase/teams";
import {
  approveJoinRequest,
  denyJoinRequest,
  setMeetingDriver,
  setMeetLink,
} from "./actions";
import { AddMemberDrawer } from "./add-member-drawer";
import { AdminBadge } from "./admin-badge";
import { MemberRoleControls } from "./member-role-controls";
import { SpeakingOrderEditor } from "./speaking-order-editor";
import { MembersTabs, type MembersTab } from "./members-tabs";
import { OrgDirectoryPanel } from "./org-directory-panel";

type JoinRequest = {
  user_id: string;
  requester_name: string | null;
  requester_email: string | null;
};

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { teamId: tid } = await params;
  const sp = await searchParams;
  const tab: MembersTab = sp.tab === "directory" ? "directory" : "team";

  const { uid, db, team, isAdmin, membershipRole } =
    await requireTeamAccess(tid);

  if (tab === "directory") {
    const { membershipTeamIds, user } = await getUserTeamsFirebase();
    const [directory, orgAdmins] = await Promise.all([
      getOrgDirectory(),
      getOrgAdmins(),
    ]);
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Team roster and org-wide directory.
          </p>
        </header>
        <MembersTabs teamId={tid} active="directory" />
        <OrgDirectoryPanel
          directory={directory}
          membershipTeamIds={membershipTeamIds}
          currentUserId={user.id}
          isAdmin={isAdmin}
          contextTeamId={tid}
          orgAdmins={orgAdmins}
        />
      </div>
    );
  }

  const [members, orgAdmins] = await Promise.all([
    getTeamMembers(tid),
    getOrgAdmins(),
  ]);
  const adminUids = new Set(orgAdmins.map((a) => a.uid));

  const isLeader = membershipRole === "leader";
  const canManage = isLeader || isAdmin;
  const leaderCount = members.filter((m) => m.role === "leader").length;

  const roster = [...members].sort((a, b) => {
    if (a.role === "leader" && b.role !== "leader") return -1;
    if (a.role !== "leader" && b.role === "leader") return 1;
    return a.full_name.localeCompare(b.full_name, undefined, {
      sensitivity: "base",
    });
  });

  const driver = members.find((m) => m.user_id === team.meetingDriverId) ?? null;

  let pending: JoinRequest[] = [];
  if (canManage) {
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
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
          {isAdmin && !isLeader && (
            <p className="mt-1 text-xs text-zinc-500">
              Viewing as org admin — you can invite and manage roles without
              being on the roster.
            </p>
          )}
        </div>
        {canManage && <AddMemberDrawer teamId={tid} />}
      </header>

      <MembersTabs teamId={tid} active="team" />

      {canManage && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Meeting settings
          </h2>
          <div className="space-y-4 rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <form action={setMeetingDriver.bind(null, tid)}>
              <label
                htmlFor="driver_id"
                className="flex items-center gap-1.5 text-sm font-medium"
              >
                <Compass className="h-4 w-4 text-hpb-blue" />
                Meeting driver
              </label>
              <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                Shown as the facilitator on the live meeting. Anyone can still
                advance the stage.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <select
                  id="driver_id"
                  name="driver_id"
                  defaultValue={team.meetingDriverId ?? "none"}
                  className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
                >
                  <option value="none">No driver assigned</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
                >
                  Save
                </button>
              </div>
            </form>

            <form
              action={setMeetLink.bind(null, tid)}
              className="border-t border-zinc-200 dark:border-zinc-800 pt-4"
            >
              <label
                htmlFor="meet_link"
                className="flex items-center gap-1.5 text-sm font-medium"
              >
                <Video className="h-4 w-4 text-hpb-green" />
                Google Meet link
              </label>
              <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                The standing Meet room for this team&rsquo;s L10. Members join it
                from the live meeting.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id="meet_link"
                  name="meet_link"
                  type="url"
                  inputMode="url"
                  placeholder="https://meet.google.com/abc-defg-hij"
                  defaultValue={team.meetLink ?? ""}
                  className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-green/40"
                />
                <button
                  type="submit"
                  className="rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
                >
                  Save
                </button>
              </div>
            </form>

            <SpeakingOrderEditor
              teamId={tid}
              members={members}
              storedOrder={team.speakingOrder}
              canEdit
            />
          </div>

          <h2 className="pt-2 text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Pending requests
            {pending.length > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 dark:bg-amber-950 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                {pending.length}
              </span>
            )}
          </h2>
          <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
            {pending.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
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
                      <div className="text-xs text-zinc-600 dark:text-zinc-400 truncate">
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
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Team members
          </h2>
          {canManage && (
            <p className="text-xs text-zinc-500">
              Leaders can manage members and meeting settings. A team always
              needs at least one leader.
            </p>
          )}
        </div>
        <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
          {roster.map((m) => (
            <div
              key={m.user_id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium">{m.full_name}</span>
                {m.user_id === uid && (
                  <span className="ml-1.5 text-xs text-zinc-500">(you)</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {adminUids.has(m.user_id) && <AdminBadge />}
                {driver?.user_id === m.user_id && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-hpb-green/10 px-2 py-0.5 text-xs font-medium text-hpb-green ring-1 ring-inset ring-hpb-green/30">
                    <Compass className="h-3 w-3" />
                    Driver
                  </span>
                )}
                {canManage ? (
                  <MemberRoleControls
                    teamId={tid}
                    userId={m.user_id}
                    role={m.role}
                    isSelf={m.user_id === uid}
                    canDemote={!(m.role === "leader" && leaderCount <= 1)}
                  />
                ) : (
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      m.role === "leader"
                        ? "bg-hpb-blue/10 text-hpb-blue ring-hpb-blue/20 dark:text-hpb-gold dark:ring-hpb-gold/20"
                        : "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700"
                    }`}
                  >
                    {m.role === "leader" ? "Leader" : "Member"}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
