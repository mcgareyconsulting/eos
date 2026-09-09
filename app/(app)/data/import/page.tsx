import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Upload } from "lucide-react";
import {
  requireTeamLeader,
  getTeamMembers,
  getOrgTeams,
  getImportableTeams,
} from "@/lib/firebase/teams";
import { ImportUploader } from "./import-uploader";

/**
 * Import lives under /data because import and export are two halves of one
 * door: the CSV this consumes is the CSV /data exports (see
 * lib/data-directory/registry.ts).
 *
 * The target team comes from `?team=` rather than the path. That is not a
 * loosening — importTeamFile() has always gated on its `teamId` *argument*
 * (requireTeamLeader), never on the URL, and the page has always offered an
 * "Import into" picker. Writing to a team is still leader-or-admin; a
 * leadership-team member who leads nothing reads /data and gets no import.
 */
export default async function DataImportPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const { team: requested } = await searchParams;
  const importableTeams = await getImportableTeams();
  if (importableTeams.length === 0) notFound();

  const teamId =
    importableTeams.find((t) => t.id === requested)?.id ?? importableTeams[0].id;

  // Redundant with getImportableTeams by construction, and kept anyway: this
  // is the same check the server action runs, so the page cannot drift into
  // rendering an uploader the action would reject.
  const { team } = await requireTeamLeader(teamId);
  const [members, orgTeams] = await Promise.all([
    getTeamMembers(teamId),
    // Department filter matches text in the *file*, so it offers every team
    // name (already a soft-directory read) plus an "Other…" escape hatch.
    getOrgTeams(),
  ]);

  return (
    // Wide on purpose: the dry-run preview is a four-column table of real
    // rows, and 2xl squeezed titles into two clamped lines (client, 8/26).
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <Link
          href="/data"
          className="inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Data
        </Link>
        <div className="mt-2 flex items-center gap-2 text-hpb-blue dark:text-hpb-gold">
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
