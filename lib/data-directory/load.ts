// Reads for the /data page.
//
// Deliberately unfiltered at the Firestore level: each selected collection is
// fetched whole and narrowed in memory. That skips chunkForInQuery's 30-value
// `in` cap entirely (an org-wide query would otherwise need one `in` per 30
// teams) and needs no composite indexes, so firestore.indexes.json stays as
// it is. It is only sound because this app's collections are small — tens of
// users, thousands of docs. If that stops being true, this is the file that
// has to learn pagination.
//
// Admin SDK only: firestore.rules still denies a non-admin every other team's
// data from the browser, so callers must be server-side and must already have
// passed requireOrgReader().

import type { Firestore } from "firebase-admin/firestore";
import {
  userDisplayName,
  ownerLabel,
  type UserDocData,
} from "@/lib/user-name";
import {
  DATA_TYPES,
  DATA_TYPE_BY_KEY,
  UNOWNED_FILTER_VALUE,
  ownerOf,
  type DataRow,
  type DataState,
  type DataTypeDef,
  type DataTypeKey,
  type Doc,
  type RowContext,
} from "./registry";

export type DataFilters = {
  /** "all" renders the mixed view; a key renders that type's own columns. */
  type: DataTypeKey | "all";
  teamId: string | null;
  /** A user id, or UNOWNED_FILTER_VALUE for deliberately unassigned rows. */
  ownerId: string | null;
  state: DataState | null;
  quarter: string | null;
  q: string | null;
};

export type TypedRows = {
  def: DataTypeDef;
  /** Kept alongside the row so native columns can read the raw document. */
  entries: { doc: Doc; row: DataRow }[];
};

export type DataLoad = {
  ctx: RowContext;
  /** One bucket per selected type, in registry order. */
  byType: TypedRows[];
  /** Every matching row across the selected types, newest first. */
  rows: DataRow[];
  /** Facet options, built from the whole org rather than the filtered set. */
  teams: { id: string; name: string }[];
  owners: { id: string; name: string }[];
  quarters: string[];
};

function snapshotDocs(snap: { docs: { id: string; data(): unknown }[] }): Doc[] {
  return snap.docs.map((d) => ({
    ...((d.data() as Record<string, unknown>) ?? {}),
    id: d.id,
  }));
}

function matchesQuery(row: DataRow, ctx: RowContext, needle: string): boolean {
  const hay = [
    row.title,
    row.detail,
    row.id,
    ctx.teamName(row.teamId),
    ctx.ownerName(row.ownerId),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

export async function loadData(
  db: Firestore,
  filters: DataFilters,
): Promise<DataLoad> {
  const one =
    filters.type === "all" ? undefined : DATA_TYPE_BY_KEY.get(filters.type);
  const selected = one ? [one] : DATA_TYPES;

  // scorecard_entries carry no team_id, so their metric is always needed to
  // place them on a team — fetch it even when only entries are selected.
  const needsMetrics = selected.some((d) => d.key === "scorecard_entries");
  const extra = new Set<string>(["teams", "users"]);
  if (needsMetrics) extra.add("scorecard_metrics");
  for (const def of selected) extra.delete(def.collection);

  const extraNames = [...extra];
  const [selectedSnaps, extraSnaps] = await Promise.all([
    Promise.all(selected.map((def) => db.collection(def.collection).get())),
    Promise.all(extraNames.map((name) => db.collection(name).get())),
  ]);

  const docsByCollection = new Map<string, Doc[]>();
  selected.forEach((def, i) =>
    docsByCollection.set(def.collection, snapshotDocs(selectedSnaps[i])),
  );
  extraNames.forEach((name, i) =>
    docsByCollection.set(name, snapshotDocs(extraSnaps[i])),
  );

  const teamDocs = docsByCollection.get("teams") ?? [];
  const userDocs = docsByCollection.get("users") ?? [];
  const metricDocs = docsByCollection.get("scorecard_metrics") ?? [];

  const teamNameById = new Map(
    teamDocs.map((t) => [t.id, String(t.name ?? "Team")]),
  );
  const userNameById = new Map(
    // The `users` collection is never rendered as a type (see
    // DENYLISTED_COLLECTIONS) — it is read only to name owners.
    userDocs.map((u) => [u.id, userDisplayName(u as UserDocData)]),
  );
  const metricById = new Map(
    metricDocs.map((m) => [
      m.id,
      {
        name: String(m.name ?? ""),
        team_id: (String(m.team_id ?? "") || null) as string | null,
      },
    ]),
  );

  const ctx: RowContext = {
    teamName: (id) => (id ? (teamNameById.get(id) ?? "—") : "—"),
    ownerName: (id) => ownerLabel(id, (uid) => userNameById.get(uid)),
    metric: (id) => (id ? (metricById.get(id) ?? null) : null),
  };

  const needle = filters.q?.trim().toLowerCase() || "";

  const byType: TypedRows[] = selected.map((def) => {
    const docs = docsByCollection.get(def.collection) ?? [];
    const entries = docs
      .map((doc) => ({ doc, row: def.toRow(doc, ctx) }))
      .filter(({ doc, row }) => {
        if (filters.teamId && row.teamId !== filters.teamId) return false;
        if (filters.ownerId) {
          // A type with no owner field can never match an owner filter —
          // dropping it is the honest answer, not showing it unfiltered.
          if (!def.ownerField) return false;
          const owner = ownerOf(def, doc);
          if (filters.ownerId === UNOWNED_FILTER_VALUE) {
            if (owner !== null) return false;
          } else if (owner !== filters.ownerId) return false;
        }
        if (filters.state && row.state !== filters.state) return false;
        if (filters.quarter && String(doc.quarter ?? "") !== filters.quarter)
          return false;
        if (needle && !matchesQuery(row, ctx, needle)) return false;
        return true;
      });
    return { def, entries };
  });

  const rows = byType
    .flatMap((t) => t.entries.map((e) => e.row))
    .sort(
      (a, b) =>
        // Undated rows (memberships, groups) sort last rather than first.
        (b.updated || "").localeCompare(a.updated || "") ||
        a.title.localeCompare(b.title),
    );

  const quarters = [
    ...new Set(
      (docsByCollection.get("rocks") ?? [])
        .map((r) => String(r.quarter ?? ""))
        .filter(Boolean),
    ),
  ].sort((a, b) => b.localeCompare(a));

  return {
    ctx,
    byType,
    rows,
    teams: [...teamNameById.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    owners: [...userNameById.entries()]
      .filter(([, name]) => name !== "")
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    quarters,
  };
}
