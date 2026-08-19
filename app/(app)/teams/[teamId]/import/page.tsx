import { Upload } from "lucide-react";
import {
  requireTeamAccess,
  getTeamMembers,
  getOrgTeams,
  getImportableTeams,
} from "@/lib/firebase/teams";
import { ImportUploader } from "./import-uploader";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const { team } = await requireTeamAccess(teamId);
  const [members, orgTeams, importableTeams] = await Promise.all([
    getTeamMembers(teamId),
    // Department filter matches text in the *file*, so it offers every team
    // name (already a soft-directory read) plus an "Other…" escape hatch.
    getOrgTeams(),
    // "Import into" is a write surface: admins get every team, everyone else
    // only the teams they lead.
    getImportableTeams(teamId),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <div className="flex items-center gap-2 text-hpb-blue dark:text-hpb-gold">
          <Upload className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Data import
          </span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Import into {team.name}
        </h1>
        <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
          Drop a CSV or Excel file to add <strong>Rocks</strong>,{" "}
          <strong>To-Dos</strong>, <strong>Issues</strong>, or{" "}
          <strong>Headlines</strong>. Re-importing the
          same file is safe: rows already on the team are matched by title and
          left alone, so only what&rsquo;s new is added.
        </p>
      </header>

      <ImportUploader
        teamId={teamId}
        teamName={team.name}
        orgTeams={orgTeams}
        importableTeams={importableTeams}
        members={members.map((m) => ({
          user_id: m.user_id,
          full_name: m.full_name,
        }))}
      />
    </div>
  );
}
