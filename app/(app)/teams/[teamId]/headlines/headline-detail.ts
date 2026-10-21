// The pure half of the headline detail modal (headline-detail-modal.tsx):
// the plain-data shape the modal takes, and the feed events that can be read
// straight off a headline's own fields.
//
// Both surfaces that open the modal build the same shape here — the
// Headlines tab from Admin SDK docs on the server, the L10 headlines segment
// from its live listener (Timestamps) merged with a server prefetch (millis)
// — so the modal never sees a Timestamp and can cross the RSC boundary.

import { SYSTEM_ACTOR_ID } from "@/lib/activity";
import {
  tsMs,
  type FeedEvent,
  type MaybeTimestamp,
} from "@/lib/activity-feed";
import type { HeadlineKind } from "@/lib/headlines";

/** Everything the detail modal shows, as plain serialisable data. */
export type HeadlineDetailData = {
  id: string;
  title: string;
  /** Already passed through normalizeDescription; null when empty. */
  body: string | null;
  kind: HeadlineKind;
  createdBy: string | null;
  /** Who the row is shown as belonging to (headlineCreatorLabel). */
  ownerLabel: string;
  createdMs: number | null;
  discussed: boolean;
  /** When it was last marked discussed; null when not discussed. */
  discussedMs: number | null;
  /** Set while archived; restoring clears it. */
  archivedMs: number | null;
  /** An org-wide cascade copy: text is read-only on this team. */
  broadcast: boolean;
  fromLabel: string | null;
  sourceOwnerName: string | null;
};

/** The headline fields the detail reads, in either timestamp form. */
export type HeadlineSource = {
  id: string;
  title: string;
  body?: string | null;
  kind: HeadlineKind;
  created_by?: string | null;
  created_at?: MaybeTimestamp;
  discussed?: boolean | null;
  discussed_at?: MaybeTimestamp;
  archived_at?: MaybeTimestamp;
  broadcast?: boolean | null;
  from_label?: string | null;
  source_owner_name?: string | null;
};

export function headlineDetailFrom(
  h: HeadlineSource,
  opts: { body: string | null; ownerLabel: string },
): HeadlineDetailData {
  const discussed = h.discussed === true;
  return {
    id: h.id,
    title: h.title,
    body: opts.body?.trim() ? opts.body : null,
    kind: h.kind,
    createdBy: h.created_by ?? null,
    ownerLabel: opts.ownerLabel,
    createdMs: tsMs(h.created_at),
    discussed,
    // A stale discussed_at on an undiscussed headline says nothing true.
    discussedMs: discussed ? tsMs(h.discussed_at) : null,
    archivedMs: tsMs(h.archived_at),
    broadcast: !!h.broadcast,
    fromLabel: h.from_label?.trim() || null,
    sourceOwnerName: h.source_owner_name?.trim() || null,
  };
}

/**
 * Who the headline is for, in the words the modal's Audience line uses. An
 * org-wide copy names where it came from when the importer recorded it.
 */
export function headlineAudienceLabel(
  h: Pick<HeadlineDetailData, "broadcast" | "kind" | "fromLabel">,
): string {
  if (h.broadcast) {
    return h.fromLabel ? `Org-wide · from ${h.fromLabel}` : "Org-wide";
  }
  if (h.kind === "cascading") return "Cascading · this team's message";
  return "This team";
}

/**
 * Feed events a headline proves on its own — no activity trace exists for
 * headlines, so these are read off its fields and nothing else:
 *
 * - created: `created_at`, by `created_by` (or the imported owner's name).
 *   Skipped when the time is unknown (an import without a date), rather
 *   than sorted to the top as if it had just happened.
 * - marked discussed: `discussed_at` while `discussed` is set — the latest
 *   time only; earlier toggles leave no trace.
 * - archived: `archived_at` while archived.
 *
 * Neither write records who did it (`updated_by` is overwritten by every
 * later write, so it can't be trusted for an older one), so those two rows
 * carry no actor: SYSTEM_ACTOR_ID with an explicit verb makes the feed
 * render them as a bare sentence ("Archived"), not "Someone archived …" and
 * not the sweep's "Archived automatically" — an archive may be a person's.
 *
 * TODO(activity-rules): edits (title / detail / category), owner changes
 * (deactivation → Unassigned), restore, and each discussed toggle plug in
 * here once headlines write an `entity_activity` trace and its read rule
 * serves `entity_type == 'headline'`.
 */
export function headlineFeedEvents(
  h: HeadlineDetailData,
  nameOf: (uid: string) => string | null | undefined,
): FeedEvent[] {
  const out: FeedEvent[] = [];
  if (h.createdMs != null) {
    // The roster's own "no profile yet" placeholder is not a name.
    const name = h.createdBy ? nameOf(h.createdBy)?.trim() : null;
    out.push({
      id: `headline:${h.id}:created`,
      kind: "created",
      actorId: h.createdBy,
      actorName:
        (name && name !== "—" ? name : null) ?? h.sourceOwnerName ?? "",
      ms: h.createdMs,
    });
  }
  if (h.discussed && h.discussedMs != null) {
    out.push({
      id: `headline:${h.id}:discussed`,
      kind: "completed",
      actorId: SYSTEM_ACTOR_ID,
      actorName: "",
      ms: h.discussedMs,
      verb: "marked discussed",
    });
  }
  if (h.archivedMs != null) {
    out.push({
      id: `headline:${h.id}:archived`,
      kind: "archived",
      actorId: SYSTEM_ACTOR_ID,
      actorName: "",
      ms: h.archivedMs,
      verb: "archived",
    });
  }
  return out;
}

/** Where the modal was opened from — each keeps its own row's actions. */
export type HeadlineSurface = "page" | "meeting";

export type HeadlineActions = {
  /** The discussed checkbox. */
  discussed: boolean;
  edit: boolean;
  /** Archive / Restore. */
  archive: boolean;
  delete: boolean;
};

/**
 * Which of a row's actions the modal offers — the same set the row it opened
 * from shows, so the modal never hands out one the row withholds:
 *
 * - Headlines tab: discussed on active rows; archive/restore on every row
 *   (a broadcast copy is this team's own doc); edit on any non-broadcast
 *   row; delete on active non-broadcast rows.
 * - L10 segment: discussed on every row; no archive (Finish does that);
 *   edit and delete on any non-broadcast row.
 *
 * Broadcast copies stay read-only for text in the server actions too
 * (updateHeadline / deleteHeadline throw); this only mirrors that.
 */
export function headlineActions(
  h: Pick<HeadlineDetailData, "broadcast" | "archivedMs">,
  surface: HeadlineSurface,
): HeadlineActions {
  const archived = h.archivedMs != null;
  const ownText = !h.broadcast;
  if (surface === "meeting") {
    return { discussed: true, edit: ownText, archive: false, delete: ownText };
  }
  return {
    discussed: !archived,
    edit: ownText,
    archive: true,
    delete: ownText && !archived,
  };
}
