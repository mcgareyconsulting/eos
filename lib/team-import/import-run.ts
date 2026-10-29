// One `import_runs` doc per applied import: who, when, which files (by
// SHA-256), what each sheet was read as, the options, and the outcome.
//
// The per-row audit_log entries already name the actor on every doc an
// import writes; this is the record that ties them together and answers
// "where did this data come from?". Every doc the run writes carries its
// `import_run_id`, so a run can be traced — or cleaned up — exactly.
//
// Server-only: firestore.rules' default deny covers the collection, and the
// generic audit trigger copies each write into the append-only audit_log,
// where admins can read it.

import { createHash } from "node:crypto";
import { FieldValue, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { stamp } from "../audit-stamp";
import type { ImportKind, ImportReport } from "../team-import-types";

export type ImportRunStart = {
  teamId: string;
  actorUid: string;
  /** The uploads as received (a .zip is hashed whole). */
  files: { name: string; bytes: Buffer }[];
  tables: { id: string; kind: ImportKind | null; rows: number; excluded: number }[];
  options: {
    includeArchived: boolean;
    createOwners: boolean;
    unmatchedOwner: "skip" | "no-owner";
    fallbackOwnerId: string | null;
    teamFilter: string | null;
    /** Name in file → member uid. */
    ownerAliases: Record<string, string>;
  };
};

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Record the run before anything is written. Throws if the record can't be
 * written — an import with no record of itself does not run.
 */
export async function startImportRun(db: Firestore, run: ImportRunStart): Promise<DocumentReference> {
  const ref = db.collection("import_runs").doc();
  await ref.set({
    team_id: run.teamId,
    actor_uid: run.actorUid,
    status: "running",
    started_at: FieldValue.serverTimestamp(),
    finished_at: null,
    files: run.files.map((f) => ({ name: f.name, size: f.bytes.length, sha256: sha256(f.bytes) })),
    tables: run.tables,
    options: {
      include_archived: run.options.includeArchived,
      create_owners: run.options.createOwners,
      unmatched_owner: run.options.unmatchedOwner,
      fallback_owner_id: run.options.fallbackOwnerId,
      team_filter: run.options.teamFilter,
      owner_aliases: run.options.ownerAliases,
    },
    result: null,
    error: null,
    ...stamp(run.actorUid),
  });
  return ref;
}

/**
 * Close the record out. The data is already written by now, so a failure
 * here is logged rather than surfaced — the "running" status left behind
 * still says the run started and never confirmed.
 */
export async function finishImportRun(
  ref: DocumentReference,
  actorUid: string,
  outcome: { report: ImportReport } | { error: string },
): Promise<void> {
  try {
    await ref.update(
      "report" in outcome
        ? {
            status: "completed",
            finished_at: FieldValue.serverTimestamp(),
            result: {
              writes: outcome.report.writes,
              kinds: outcome.report.kinds.map((k) => ({
                kind: k.kind,
                label: k.label,
                imported: k.imported,
                skipped: k.skipped,
                unchanged: k.unchanged ?? 0,
              })),
              placeholders_created: outcome.report.placeholdersCreated.map((p) => p.user_id),
              unresolved_owners: outcome.report.unresolvedOwners,
            },
            ...stamp(actorUid),
          }
        : {
            status: "failed",
            finished_at: FieldValue.serverTimestamp(),
            error: outcome.error,
            ...stamp(actorUid),
          },
    );
  } catch (err) {
    console.error("import_runs finish write failed", ref.id, err);
  }
}
