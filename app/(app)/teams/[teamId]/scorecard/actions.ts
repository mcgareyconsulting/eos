"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess, requireTeamDoc } from "@/lib/firebase/teams";
import {
  loadOrgMetricCatalog,
  type CatalogMetric,
} from "@/lib/firebase/scorecard-catalog";
import {
  isScorecardUnit,
  parseScorecardValue,
  type ScorecardUnit,
} from "@/lib/scorecard";
import {
  SCORECARD_PERIODS,
  type MetricInterval,
} from "@/lib/scorecard-periods";
import {
  addShare,
  canArchiveMetric,
  canDeleteMetric,
  canEditMetricValues,
  isArchivedMetric,
  isOnScorecard,
  isSharedIntoTeam,
  removeShare,
  type ManageableMetric,
  type ShareableMetric,
} from "@/lib/scorecard-share";
import {
  groupDocId,
  groupNameKey,
  isMetricInterval,
  nextGroupSortOrder,
  normalizeGroupName,
  reorderGroup,
  type ScorecardGroup,
} from "@/lib/scorecard-groups";

const DIRECTIONS = ["gte", "lte", "eq"] as const;
type Direction = (typeof DIRECTIONS)[number];

function pathFor(teamId: string) {
  return `/teams/${teamId}/scorecard`;
}

export async function addMetric(teamId: string, formData: FormData) {
  const { uid, db } = await requireTeamAccess(teamId);

  const name = String(formData.get("name") ?? "").trim();
  const unitRaw = String(formData.get("unit") ?? "number");
  const directionRaw = String(formData.get("direction") ?? "gte");
  const goalRaw = String(formData.get("goal") ?? "").trim();
  const owner_id = String(formData.get("owner_id") ?? "") || uid;
  const groupRaw = String(formData.get("group") ?? "").trim();
  const group = groupRaw === "" ? null : groupRaw;
  const intervalRaw = String(formData.get("interval") ?? "weekly");
  const interval: MetricInterval = (
    SCORECARD_PERIODS as readonly string[]
  ).includes(intervalRaw)
    ? (intervalRaw as MetricInterval)
    : "weekly";

  if (!name) throw new Error("Name required");

  const unit: ScorecardUnit = isScorecardUnit(unitRaw) ? unitRaw : "number";
  const direction: Direction =
    unit === "yesno"
      ? "eq"
      : DIRECTIONS.includes(directionRaw as Direction)
        ? (directionRaw as Direction)
        : "gte";
  const parsedGoal =
    goalRaw === "" ? { ok: true as const, value: null } : parseScorecardValue(goalRaw, unit);
  if (!parsedGoal.ok) {
    throw new Error(
      unit === "yesno"
        ? "Goal must be Yes or No"
        : unit === "time"
          ? "Goal must be a time (h:mm)"
          : "Goal must be a number",
    );
  }
  const goal = parsedGoal.value;

  await db.collection("scorecard_metrics").add({
    team_id: teamId,
    name,
    unit,
    goal,
    direction,
    owner_id,
    group,
    interval,
    sort_order: 0,
    created_at: FieldValue.serverTimestamp(),
  });

  revalidatePath(pathFor(teamId));
}

/**
 * Edit an existing measurable's name, interval, unit, goal and owner.
 *
 * Until this existed there was **no way to change a measurable
 * at all** — `addMetric` / `deleteMetric` / `setMetricGroup` were the whole
 * surface, so fixing a typo in a name meant deleting the measurable *and every
 * value ever logged against it* and starting over. Validation is deliberately
 * the same shape as `addMetric`; the two must accept exactly the same things,
 * or a measurable becomes uneditable the moment the rules drift.
 *
 * **`group` is not editable here on purpose.** `setMetricGroup` owns that
 * field, including the rule that a group owns its period, and two writers for
 * one field is how that rule gets forgotten on one of the paths. The inline
 * group editor in the row's expand panel stays the way to change it.
 *
 * What this *does* have to respect is the other half of that rule: if the
 * measurable already sits in a defined group, the group's period wins over
 * whatever interval the form submits. Otherwise editing a grouped weekly
 * measurable and picking "Monthly" would strand it — rendered under neither
 * its own interval nor its group's, exactly the disappearance `setMetricGroup`
 * exists to prevent. The form disables the field and says so; this is the
 * enforcement.
 */
export async function updateMetric(
  teamId: string,
  metricId: string,
  formData: FormData,
) {
  const { uid, db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "scorecard_metrics", metricId, teamId);
  const current = snap.data() ?? {};

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name required");

  const unitRaw = String(formData.get("unit") ?? "number");
  const directionRaw = String(formData.get("direction") ?? "gte");
  const goalRaw = String(formData.get("goal") ?? "").trim();
  const owner_id = String(formData.get("owner_id") ?? "") || uid;
  const intervalRaw = String(formData.get("interval") ?? "weekly");

  const unit: ScorecardUnit = isScorecardUnit(unitRaw) ? unitRaw : "number";
  const direction: Direction =
    unit === "yesno"
      ? "eq"
      : DIRECTIONS.includes(directionRaw as Direction)
        ? (directionRaw as Direction)
        : "gte";
  const parsedGoal =
    goalRaw === ""
      ? { ok: true as const, value: null }
      : parseScorecardValue(goalRaw, unit);
  if (!parsedGoal.ok) {
    throw new Error(
      unit === "yesno"
        ? "Goal must be Yes or No"
        : unit === "time"
          ? "Goal must be a time (h:mm)"
          : "Goal must be a number",
    );
  }

  let interval: MetricInterval = (
    SCORECARD_PERIODS as readonly string[]
  ).includes(intervalRaw)
    ? (intervalRaw as MetricInterval)
    : "weekly";

  // A defined group owns its period — see the note above.
  const group = current.group ?? null;
  if (group) {
    const groups = await loadGroups(db, teamId);
    const match = groups.find(
      (g) => groupNameKey(g.name) === groupNameKey(String(group)),
    );
    if (match) interval = match.interval;
  }

  await db.collection("scorecard_metrics").doc(metricId).set(
    {
      name,
      unit,
      goal: parsedGoal.value,
      direction,
      owner_id,
      interval,
    },
    { merge: true },
  );

  revalidatePath(pathFor(teamId));
}

// Renames/clears a metric's section. Kept as its own action (rather than a
// general metric-update) to match the narrow, single-purpose action style
// already used by setEntry.
async function loadGroups(
  db: FirebaseFirestore.Firestore,
  teamId: string,
): Promise<ScorecardGroup[]> {
  const snap = await db
    .collection("scorecard_groups")
    .where("team_id", "==", teamId)
    .get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      team_id: String(x.team_id ?? teamId),
      name: String(x.name ?? ""),
      interval: isMetricInterval(String(x.interval ?? ""))
        ? (String(x.interval) as MetricInterval)
        : "weekly",
      sort_order: Number(x.sort_order ?? 0),
    };
  });
}

/**
 * Assign a metric to a group by name (empty clears it).
 *
 * Assigning also moves the metric into the group's period. A group owns a
 * period, so a weekly measurable dropped into a monthly group would otherwise
 * vanish from both tabs — visible under neither its own interval nor its
 * group's. Silently correcting the interval is the lesser surprise.
 *
 * A name with no group doc yet is still accepted: the grid renders unmanaged
 * labels after the defined groups, so a typed-in name never disappears.
 */
export async function setMetricGroup(
  teamId: string,
  metricId: string,
  groupRaw: string,
) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "scorecard_metrics", metricId, teamId);
  const trimmed = normalizeGroupName(groupRaw);
  const group = trimmed === "" ? null : trimmed;

  const patch: { group: string | null; interval?: MetricInterval } = { group };
  if (group) {
    const groups = await loadGroups(db, teamId);
    const match = groups.find((g) => groupNameKey(g.name) === groupNameKey(group));
    // Reuse the stored casing so "compliance" doesn't split the bucket.
    if (match) {
      patch.group = match.name;
      patch.interval = match.interval;
    }
  }

  await db
    .collection("scorecard_metrics")
    .doc(metricId)
    .set(patch, { merge: true });

  revalidatePath(pathFor(teamId));
}

/**
 * Create a group — a name plus the period it belongs to. New groups append to
 * the end of their period, so the order a team builds them in is the order
 * they read in, and nobody has to set a number to get a sensible list.
 */
export async function addScorecardGroup(teamId: string, formData: FormData) {
  const { db } = await requireTeamAccess(teamId);

  const name = normalizeGroupName(String(formData.get("name") ?? ""));
  if (!name) throw new Error("Group name required");

  const intervalRaw = String(formData.get("interval") ?? "weekly");
  const interval: MetricInterval = isMetricInterval(intervalRaw)
    ? intervalRaw
    : "weekly";

  const groups = await loadGroups(db, teamId);
  const existing = groups.find(
    (g) => groupNameKey(g.name) === groupNameKey(name),
  );
  if (existing) {
    throw new Error(`"${existing.name}" already exists on this team.`);
  }

  await db
    .collection("scorecard_groups")
    .doc(groupDocId(teamId, name))
    .set({
      team_id: teamId,
      name,
      interval,
      sort_order: nextGroupSortOrder(groups, interval),
      created_at: FieldValue.serverTimestamp(),
    });

  revalidatePath(pathFor(teamId));
}

/** Move a group up or down within its period. */
export async function moveScorecardGroup(
  teamId: string,
  groupId: string,
  direction: -1 | 1,
) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "scorecard_groups", groupId, teamId);

  const writes = reorderGroup(await loadGroups(db, teamId), groupId, direction);
  if (writes.length === 0) return;

  const batch = db.batch();
  for (const w of writes) {
    batch.set(
      db.collection("scorecard_groups").doc(w.id),
      { sort_order: w.sort_order },
      { merge: true },
    );
  }
  await batch.commit();

  revalidatePath(pathFor(teamId));
}

/**
 * Delete a group and un-assign its measurables. The metrics themselves are
 * never touched beyond clearing `group` — deleting a bucket must not delete
 * what was in it, and they reappear above the remaining groups as ungrouped.
 */
export async function deleteScorecardGroup(teamId: string, groupId: string) {
  const { db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "scorecard_groups", groupId, teamId);
  const name = normalizeGroupName(String(snap.data()?.name ?? ""));

  const metrics = await db
    .collection("scorecard_metrics")
    .where("team_id", "==", teamId)
    .get();

  const batch = db.batch();
  for (const d of metrics.docs) {
    if (groupNameKey(String(d.data().group ?? "")) !== groupNameKey(name)) {
      continue;
    }
    batch.set(d.ref, { group: null }, { merge: true });
  }
  batch.delete(db.collection("scorecard_groups").doc(groupId));
  await batch.commit();

  revalidatePath(pathFor(teamId));
}

/**
 * Load a measurable that is on this team's scorecard by either route — owned
 * outright, or borrowed through `shared_team_ids`.
 *
 * `requireTeamDoc` cannot do this job: it asserts `doc.team_id === teamId`,
 * which is exactly right for a measurable a team owns and exactly wrong for
 * one it borrowed. Reaching for it on a shared row would 404 the borrowing
 * team out of its own scorecard. The team-access check still happens first —
 * this widens *which document* a member may reach, never *who* is a member.
 */
async function requireMetricOnScorecard(
  db: FirebaseFirestore.Firestore,
  metricId: string,
  teamId: string,
) {
  const ref = db.collection("scorecard_metrics").doc(metricId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Measurable not found");
  const metric = (snap.data() ?? {}) as ShareableMetric;
  if (!isOnScorecard(metric, teamId)) {
    throw new Error("Measurable not found on this scorecard");
  }
  return { ref, snap, metric };
}

/**
 * The org-wide measurable list behind the "Add existing" picker.
 *
 * Loaded on demand when the modal opens rather than in the page's SSR pass.
 * The scorecard renders on every navigation and the catalog is every
 * measurable in the organisation; paying for that read on each page view to
 * serve a modal most visits never open is the wrong trade.
 */
export async function listOrgMetrics(teamId: string): Promise<CatalogMetric[]> {
  const { db } = await requireTeamAccess(teamId);
  return loadOrgMetricCatalog(db, teamId);
}

/**
 * Pull an existing measurable from anywhere in the org onto this scorecard.
 *
 * The picker deliberately lists every team's measurables, so this is the one
 * action a member takes against a document their team does not own. It writes
 * a single array element and nothing else: no copy of the metric, no copy of
 * its history, no change to who owns it. What the borrowing team gets is a
 * read — values stay editable only by the home team and org admins
 * (`setEntry`), and Delete stays on the home team (`deleteMetric`).
 *
 * Runs on the Admin SDK, so `firestore.rules` is not what authorises it; the
 * `requireTeamAccess` above is. The rules change that accompanies this
 * feature is for the *client* listener, which has to be able to read a
 * borrowed row once it is attached.
 */
export async function addExistingMetric(
  teamId: string,
  metricId: string,
  /**
   * One of this team's own groups, or empty for the cadence default.
   *
   * Written to `shared_groups[teamId]`, never to `group` — that field is the
   * home team's, and `setMetricGroup` would also rewrite the measurable's
   * interval to the group's period, changing its cadence for the team that
   * owns it. An unrecognised name is dropped rather than stored, so a stale
   * form cannot invent a section.
   */
  groupRaw = "",
) {
  const { db } = await requireTeamAccess(teamId);

  const ref = db.collection("scorecard_metrics").doc(metricId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Measurable not found");
  const metric = (snap.data() ?? {}) as ShareableMetric & {
    shared_groups?: Record<string, string | null> | null;
  };

  const result = addShare(metric, teamId);
  if (!result.ok) throw new Error(result.error);

  const wanted = normalizeGroupName(groupRaw);
  let group: string | null = null;
  if (wanted) {
    const match = (await loadGroups(db, teamId)).find(
      (g) => groupNameKey(g.name) === groupNameKey(wanted),
    );
    // Reuse the stored casing so "customer" doesn't split the bucket.
    group = match ? match.name : null;
  }

  await ref.set(
    {
      shared_team_ids: result.shared_team_ids,
      shared_groups: { ...(metric.shared_groups ?? {}), [teamId]: group },
    },
    { merge: true },
  );
  revalidatePath(pathFor(teamId));
}

/**
 * Move a borrowed measurable between this team's sections.
 *
 * The mirror of `setMetricGroup` for rows this team does not own. It writes
 * only `shared_groups[teamId]`, so it cannot touch the home team's `group` or
 * — unlike `setMetricGroup` — the measurable's interval. A borrowing team does
 * not get to change a measurable's cadence for its owner, which is why this is
 * a separate action rather than a branch inside that one.
 */
export async function setSharedMetricGroup(
  teamId: string,
  metricId: string,
  groupRaw: string,
) {
  const { db } = await requireTeamAccess(teamId);

  const ref = db.collection("scorecard_metrics").doc(metricId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Measurable not found");
  const metric = (snap.data() ?? {}) as ShareableMetric & {
    shared_groups?: Record<string, string | null> | null;
  };

  if (!isSharedIntoTeam(metric, teamId)) {
    throw new Error(
      "This measurable belongs to this team — use the group editor on the row.",
    );
  }

  const wanted = normalizeGroupName(groupRaw);
  let group: string | null = null;
  if (wanted) {
    const match = (await loadGroups(db, teamId)).find(
      (g) => groupNameKey(g.name) === groupNameKey(wanted),
    );
    group = match ? match.name : wanted;
  }

  await ref.set(
    { shared_groups: { ...(metric.shared_groups ?? {}), [teamId]: group } },
    { merge: true },
  );
  revalidatePath(pathFor(teamId));
}

/**
 * Take a borrowed measurable off this team's scorecard.
 *
 * **"Remove" means remove from this scorecard, and the confirmation says so in
 * as many words.** It drops one team from `shared_team_ids`; the measurable,
 * its owner and every value ever logged against it are untouched, and
 * re-adding it from the picker restores the row exactly. That is why it is
 * safe to hand to any member of the borrowing team while Delete stays
 * restricted to the home team, and to its owner or an admin.
 *
 * Refuses on a measurable this team owns. There the row is not borrowed and
 * there is nothing to detach, so the honest action is Delete — and quietly
 * doing nothing would read as a broken button.
 */
export async function removeSharedMetric(teamId: string, metricId: string) {
  const { db } = await requireTeamAccess(teamId);

  const ref = db.collection("scorecard_metrics").doc(metricId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Measurable not found");
  const metric = (snap.data() ?? {}) as ShareableMetric;

  if (!isSharedIntoTeam(metric, teamId)) {
    throw new Error(
      "This measurable belongs to this team — removing only applies to ones borrowed from another scorecard.",
    );
  }

  // Drop the team's section choice with the share. Leaving it behind would
  // silently restore an old section if the row were ever added back, which is
  // not what "add" should mean.
  const rest = { ...((metric as { shared_groups?: Record<string, string | null> }).shared_groups ?? {}) };
  delete rest[teamId];

  await ref.set(
    { shared_team_ids: removeShare(metric, teamId), shared_groups: rest },
    { merge: true },
  );
  revalidatePath(pathFor(teamId));
}

export async function setEntry(
  teamId: string,
  metricId: string,
  weekStartDate: string,
  valueRaw: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { db, isAdmin } = await requireTeamAccess(teamId);
  const { snap, metric } = await requireMetricOnScorecard(db, metricId, teamId);

  // Borrowing a measurable buys a read, not a pen. The values belong to the
  // team that owns it, and a second team typing into them would rewrite the
  // first team's scorecard from a row it merely displays. Admins are the
  // deliberate exception — they are the ones who correct a shared number.
  if (isArchivedMetric(metric as ManageableMetric)) {
    return {
      ok: false as const,
      error: "This measurable is archived. Restore it before logging values.",
    };
  }

  if (!canEditMetricValues({ metric, teamId, isAdmin })) {
    return {
      ok: false as const,
      error:
        "This measurable belongs to another team. Only its team or an admin can change its values.",
    };
  }

  const unitRaw = String(snap.data()?.unit ?? "number");
  const unit = isScorecardUnit(unitRaw) ? unitRaw : "number";
  const parsed = parseScorecardValue(valueRaw, unit);
  if (!parsed.ok) return parsed;
  const value = parsed.value;

  const id = `${metricId}__${weekStartDate}`;
  await db
    .collection("scorecard_entries")
    .doc(id)
    .set(
      {
        metric_id: metricId,
        week_start_date: weekStartDate,
        value,
        note: null,
        created_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  revalidatePath(pathFor(teamId));
  return { ok: true };
}

/**
 * Archive or restore a measurable. Owner or org admin, home team only.
 *
 * **Archive is the answer to almost every "get this off my scorecard".** It
 * hides the row and keeps every value ever logged, so a measurable a team has
 * stopped tracking stops cluttering the grid without anyone losing the
 * history — and restoring puts it back exactly. Delete exists for the genuine
 * mistake and destroys that history; the two share a permission gate
 * (`canManageMetricLifecycle`) precisely so nobody has to reason about which
 * is more restricted, only about which is more destructive.
 *
 * Reversible, so callers do not confirm — same treatment as `setRockArchived`
 * and `setHeadlineArchived`.
 *
 * Archiving does **not** unshare. A measurable borrowed by three other teams
 * disappears from all four scorecards at once and comes back to all four on
 * restore, which keeps one measurable's state in one place. Detaching one
 * borrowing team is `removeSharedMetric`, and that is that team's decision to
 * make, not the owner's to make for them.
 */
export async function setMetricArchived(
  teamId: string,
  metricId: string,
  archived: boolean,
) {
  const { uid, db, isAdmin } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "scorecard_metrics", metricId, teamId);
  const metric = (snap.data() ?? {}) as ManageableMetric;

  if (!canArchiveMetric({ metric, teamId, uid, isAdmin })) {
    throw new Error(
      archived
        ? "Only this measurable's owner or an admin can archive it."
        : "Only this measurable's owner or an admin can restore it.",
    );
  }

  await db
    .collection("scorecard_metrics")
    .doc(metricId)
    .set(
      archived
        ? { archived_at: FieldValue.serverTimestamp() }
        : { archived_at: null },
      { merge: true },
    );

  revalidatePath(pathFor(teamId));
}

/**
 * Destroy a measurable and orphan its history — home team only.
 *
 * The guard matters more since sharing exists. A borrowed row is visible on
 * another team's scorecard, and if Delete were reachable from there one team
 * could erase another team's data through what looks like a remove button.
 * Remove is that team's action; this one is not offered to them. `requireTeamDoc`
 * already enforces this by asserting the document's own `team_id`, and the
 * explicit check below states the rule rather than leaving it as a side
 * effect of which loader happened to be used.
 */
export async function deleteMetric(teamId: string, metricId: string) {
  const { uid, db, isAdmin } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "scorecard_metrics", metricId, teamId);
  const metric = (snap.data() ?? {}) as ManageableMetric;
  if (!canDeleteMetric({ metric, teamId, uid, isAdmin })) {
    throw new Error(
      "Only this measurable's owner or an admin can delete it.",
    );
  }
  // Delete the metric. Entries are orphaned but harmless; can clean up later.
  await db.collection("scorecard_metrics").doc(metricId).delete();
  revalidatePath(pathFor(teamId));
}
