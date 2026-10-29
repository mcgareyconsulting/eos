import { Upload } from "lucide-react";
import {
  requireTeamLeader,
  getTeamMembers,
  getImportableTeams,
} from "@/lib/firebase/teams";
import { BulkUploader } from "./bulk-uploader";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  // Import is a leader/admin surface (see importTeamBundle) — members 404.
  const { team, isAdmin } = await requireTeamLeader(teamId);
  const [members, importableTeams] = await Promise.all([
    getTeamMembers(teamId),
    // The Team picker is a write surface: admins get every team, everyone else
    // only the teams they lead.
    getImportableTeams(teamId),
  ]);

  return (
    // Wide on purpose: the dry-run preview is a spreadsheet grid of the
    // file's own columns; it scrolls sideways inside its box past this.
    <div className="mx-auto max-w-7xl space-y-6">
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
      </header>

      <BulkUploader
        teamId={teamId}
        teamName={team.name}
        canCreateOwners={isAdmin}
        importableTeams={importableTeams}
        members={members.map((m) => ({
          user_id: m.user_id,
          full_name: m.full_name,
        }))}
      />
    </div>
  );
}
