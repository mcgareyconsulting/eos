import {
  SEGMENT_DURATION_SECONDS,
  SEGMENT_LABELS,
  SEGMENTS,
  type Segment,
  isSegment,
  normalizeSegment,
} from "./segments";

/**
 * Active stage tools that can appear on a meeting agenda.
 * `"done"` is never an agenda item — it is only written by Finish / endMeeting.
 */
export const AGENDA_TOOL_TYPES = SEGMENTS.filter(
  (s): s is Exclude<Segment, "done"> => s !== "done",
);

export type AgendaToolType = (typeof AGENDA_TOOL_TYPES)[number];

export type AgendaItem = {
  /** Built-in L10 stage this row drives. */
  type: AgendaToolType;
  /** Allotted time for this stage (seconds). */
  duration_seconds: number;
  /** Optional display override; falls back to SEGMENT_LABELS[type]. */
  label?: string | null;
};

export type AgendaDoc = {
  id: string;
  team_id: string;
  name: string;
  items: AgendaItem[];
  /** Built-in seed that cannot be deleted (can still be edited). */
  is_default?: boolean;
  created_at?: unknown;
  updated_at?: unknown;
  created_by?: string | null;
};

/** Snapshot stamped onto a meeting at start so later template edits never
 *  rewrite a live or historical meeting's rail/timers. */
export type MeetingAgendaSnapshot = {
  agenda_id: string | null;
  agenda_name: string;
  agenda_items: AgendaItem[];
};

export function isAgendaToolType(s: string | null | undefined): s is AgendaToolType {
  return !!s && (AGENDA_TOOL_TYPES as readonly string[]).includes(s);
}

export function agendaItemLabel(item: AgendaItem): string {
  const custom = item.label?.trim();
  if (custom) return custom;
  return SEGMENT_LABELS[item.type] ?? item.type;
}

export function totalAgendaSeconds(items: readonly AgendaItem[]): number {
  return items.reduce((sum, it) => sum + Math.max(0, it.duration_seconds || 0), 0);
}

export function totalAgendaMinutes(items: readonly AgendaItem[]): number {
  return Math.round(totalAgendaSeconds(items) / 60);
}

/** Standard EOS Level 10 (90 minutes). */
export function defaultL10Items(): AgendaItem[] {
  return AGENDA_TOOL_TYPES.map((type) => ({
    type,
    duration_seconds: SEGMENT_DURATION_SECONDS[type],
  }));
}

/**
 * L10 Condensed (~60 minutes): same stages, shorter Issues hour.
 * 3+3+3+3+3+40+5 = 60.
 */
export function defaultL10CondensedItems(): AgendaItem[] {
  const condensed: Record<AgendaToolType, number> = {
    segue: 3 * 60,
    scorecard: 3 * 60,
    rocks: 3 * 60,
    headlines: 3 * 60,
    todos: 3 * 60,
    issues: 40 * 60,
    conclude: 5 * 60,
  };
  return AGENDA_TOOL_TYPES.map((type) => ({
    type,
    duration_seconds: condensed[type],
  }));
}

/** Built-in templates offered when seeding a team (and as clone sources). */
export const BUILT_IN_AGENDA_PRESETS: ReadonlyArray<{
  key: "l10" | "l10-condensed";
  name: string;
  items: () => AgendaItem[];
  is_default: boolean;
}> = [
  {
    key: "l10",
    name: "Level 10",
    items: defaultL10Items,
    is_default: true,
  },
  {
    key: "l10-condensed",
    name: "L10 Condensed",
    items: defaultL10CondensedItems,
    is_default: false,
  },
];

const MAX_ITEM_SECONDS = 8 * 60 * 60; // 8h cap per stage
const MIN_ITEM_SECONDS = 60; // 1 minute floor

/**
 * Sanitize client/server agenda items:
 * - only known tool types
 * - unique types (first wins)
 * - clamp durations
 * - strip empty labels
 */
export function normalizeAgendaItems(
  raw: unknown,
): AgendaItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const seen = new Set<string>();
  const out: AgendaItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const typeRaw = typeof r.type === "string" ? r.type : "";
    const type = isAgendaToolType(typeRaw)
      ? typeRaw
      : typeRaw === "ids"
        ? "issues"
        : null;
    if (!type || seen.has(type)) continue;
    seen.add(type);

    let duration = Number(r.duration_seconds);
    if (!Number.isFinite(duration)) {
      duration = SEGMENT_DURATION_SECONDS[type] ?? 5 * 60;
    }
    duration = Math.round(duration);
    if (duration < MIN_ITEM_SECONDS) duration = MIN_ITEM_SECONDS;
    if (duration > MAX_ITEM_SECONDS) duration = MAX_ITEM_SECONDS;

    const labelRaw = r.label;
    const label =
      typeof labelRaw === "string" && labelRaw.trim()
        ? labelRaw.trim().slice(0, 80)
        : null;

    out.push({
      type,
      duration_seconds: duration,
      ...(label ? { label } : {}),
    });
  }
  return out.length > 0 ? out : null;
}

export function validateAgendaName(name: unknown): string {
  const n = String(name ?? "").trim();
  if (!n) throw new Error("Agenda name is required");
  if (n.length > 80) throw new Error("Agenda name must be 80 characters or fewer");
  return n;
}

/** Resolve the agenda snapshot for a meeting doc (legacy-safe). */
export function resolveMeetingAgenda(data: {
  agenda_id?: string | null;
  agenda_name?: string | null;
  agenda_items?: unknown;
} | null | undefined): MeetingAgendaSnapshot {
  const items = normalizeAgendaItems(data?.agenda_items) ?? defaultL10Items();
  return {
    agenda_id: data?.agenda_id ?? null,
    agenda_name:
      (typeof data?.agenda_name === "string" && data.agenda_name.trim()) ||
      "Level 10",
    agenda_items: items,
  };
}

export function agendaSegmentList(
  items: readonly AgendaItem[],
): AgendaToolType[] {
  return items.map((i) => i.type);
}

export function durationMapFromAgenda(
  items: readonly AgendaItem[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const it of items) map[it.type] = it.duration_seconds;
  return map;
}

export function nextInAgenda(
  items: readonly AgendaItem[],
  current: string | null | undefined,
): AgendaToolType | "done" {
  const order = agendaSegmentList(items);
  if (order.length === 0) return "done";
  const cur = normalizeSegment(current);
  // "done" stays terminal
  if (cur === "done") return "done";
  const i = cur ? order.indexOf(cur as AgendaToolType) : -1;
  if (i < 0) return order[0]!;
  if (i >= order.length - 1) {
    // Last agenda item: do not auto-write "done" (endMeeting owns that).
    return order[i]!;
  }
  return order[i + 1]!;
}

export function prevInAgenda(
  items: readonly AgendaItem[],
  current: string | null | undefined,
): AgendaToolType {
  const order = agendaSegmentList(items);
  if (order.length === 0) return "segue";
  const cur = normalizeSegment(current);
  const i = cur ? order.indexOf(cur as AgendaToolType) : -1;
  if (i <= 0) return order[0]!;
  return order[i - 1]!;
}

export function firstAgendaSegment(
  items: readonly AgendaItem[],
): AgendaToolType {
  return agendaSegmentList(items)[0] ?? "segue";
}

export function lastAgendaSegment(
  items: readonly AgendaItem[],
): AgendaToolType | null {
  const order = agendaSegmentList(items);
  return order.length ? order[order.length - 1]! : null;
}

export function isLastAgendaSegment(
  items: readonly AgendaItem[],
  segment: string | null | undefined,
): boolean {
  const last = lastAgendaSegment(items);
  const cur = normalizeSegment(segment);
  return !!last && cur === last;
}

export function isFirstAgendaSegment(
  items: readonly AgendaItem[],
  segment: string | null | undefined,
): boolean {
  const first = firstAgendaSegment(items);
  const cur = normalizeSegment(segment);
  return cur === first;
}

/** Whether a view/peek target is on this meeting's agenda. */
export function isOnAgenda(
  items: readonly AgendaItem[],
  segment: string | null | undefined,
): boolean {
  const cur = normalizeSegment(segment);
  if (!cur || cur === "done") return false;
  return agendaSegmentList(items).includes(cur as AgendaToolType);
}

/**
 * If the stored segment is not on the agenda (template shrank, bad data),
 * fall back to the first agenda item.
 */
export function clampSegmentToAgenda(
  items: readonly AgendaItem[],
  segment: string | null | undefined,
): AgendaToolType {
  const cur = normalizeSegment(segment);
  if (cur && cur !== "done" && isOnAgenda(items, cur)) {
    return cur as AgendaToolType;
  }
  return firstAgendaSegment(items);
}

/** Tools not yet on the agenda (for the editor's "Add stage" list). */
export function availableToolsToAdd(
  items: readonly AgendaItem[],
): AgendaToolType[] {
  const used = new Set(items.map((i) => i.type));
  return AGENDA_TOOL_TYPES.filter((t) => !used.has(t));
}

export function defaultDurationForTool(type: AgendaToolType): number {
  return SEGMENT_DURATION_SECONDS[type] ?? 5 * 60;
}

/** Format seconds as "5 min" / "1 hr 30 min" for list UI. */
export function formatAgendaDuration(totalSeconds: number): string {
  const mins = Math.max(0, Math.round(totalSeconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/** Type guard used by server actions when accepting segment jumps. */
export function agendaIncludesSegment(
  items: readonly AgendaItem[],
  target: Segment,
): boolean {
  if (target === "done") return false;
  return isOnAgenda(items, target);
}
