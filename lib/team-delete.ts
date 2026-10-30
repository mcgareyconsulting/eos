// The client-safe half of team deletion (docs: lib/firebase/team-delete.ts):
// what the Delete team dialog names and how it labels it. No firebase-admin
// import — app/(app)/directory/directory-admin.tsx is a Client Component and
// bundles this file into the browser, where `tls`/`net` do not exist.

/** Collections whose rows carry the team's `team_id` and would be orphaned. */
export const TEAM_DATA_COLLECTIONS = [
  ["rocks", "rocks"],
  ["todos", "to-dos and milestones"],
  ["issues", "issues"],
  ["headlines", "headlines"],
  ["scorecard_metrics", "measurables"],
  ["meetings", "meetings"],
] as const;

/** One stranded record, as the warning names it. */
export type StrandedRecord = {
  id: string;
  /** The title, name, or (meetings) the date it ran. */
  label: string;
  /** A muted qualifier: "milestone", "archived", "done", "private". */
  note?: string;
};

/** How many records the warning names per collection before "and N more". */
export const STRANDED_LIST_CAP = 25;

export type TeamDataSummary = {
  id: string;
  name: string;
  memberCount: number;
  /** Rows per collection, in TEAM_DATA_COLLECTIONS order; label is the UI noun. */
  data: {
    collection: string;
    label: string;
    count: number;
    /** The first STRANDED_LIST_CAP records, open ones first, then by label. */
    records: StrandedRecord[];
  }[];
};

/** One line for the confirm dialog: "3 rocks, 12 to-dos and milestones". */
export function describeLeftBehind(data: TeamDataSummary["data"]): string {
  const parts = data.filter((d) => d.count > 0).map((d) => `${d.count} ${d.label}`);
  return parts.join(", ");
}

function hasTime(v: unknown): v is { toDate: () => Date } {
  return !!v && typeof (v as { toDate?: unknown }).toDate === "function";
}

function dayOf(v: unknown): string | null {
  if (hasTime(v)) return v.toDate().toISOString().slice(0, 10);
  if (typeof v === "string" && v) return v.slice(0, 10);
  return null;
}

/**
 * The warning's line for one stored row. Pure, so the list the admin reads
 * is testable without Firestore. Unknown shapes fall back to the doc id
 * rather than an empty line — a nameless row is still a row they lose.
 */
export function strandedRecordOf(
  collection: string,
  id: string,
  data: Record<string, unknown>,
): StrandedRecord {
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const notes: string[] = [];
  let label = title || name;
  switch (collection) {
    case "todos":
      if (typeof data.source_rock_id === "string" && data.source_rock_id) notes.push("milestone");
      if (data.visibility === "private") notes.push("private");
      if (data.completed_at) notes.push("done");
      break;
    case "rocks":
      if (data.status === "done" || data.status === "cancelled") notes.push(String(data.status));
      break;
    case "issues":
      if (data.status === "solved" || data.status === "dropped") notes.push(String(data.status));
      break;
    case "meetings": {
      const day = dayOf(data.started_at) ?? dayOf(data.created_at);
      label = day ? `Meeting on ${day}` : "Meeting";
      if (!data.ended_at) notes.push("not ended");
      break;
    }
  }
  // Issues may carry a legacy boolean instead of the timestamp.
  if (data.archived_at || data.archived === true) notes.push("archived");
  return { id, label: label || id, ...(notes.length ? { note: notes.join(" · ") } : {}) };
}

/** Open work first (nothing in `note` saying done/solved/archived), then A–Z. */
export function sortStranded(records: readonly StrandedRecord[]): StrandedRecord[] {
  const closed = (r: StrandedRecord) =>
    /\b(done|solved|archived|cancelled)\b/.test(r.note ?? "") ? 1 : 0;
  return [...records].sort(
    (a, b) =>
      closed(a) - closed(b) ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}
