// Option lists for the measurable form (metric-form-modal.tsx) and the
// Groups modal's Period field (manage-groups.tsx), plus the Owner trigger's
// text. Kept free of React so the lists — whose values are what the server
// actions receive — can be tested on their own.

import type { SelectOption } from "@/components/ui/select-menu";
import {
  PERIOD_LABELS,
  SCORECARD_PERIODS,
  type ScorecardPeriod,
} from "@/lib/scorecard-periods";

/** Weekly / Monthly / Quarterly / Annual — the metric interval and group period. */
export const PERIOD_OPTIONS: readonly SelectOption<ScorecardPeriod>[] =
  SCORECARD_PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }));

export const UNIT_OPTIONS: readonly SelectOption[] = [
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "percent", label: "Percent" },
  { value: "yesno", label: "Yes/No" },
  { value: "time", label: "Time" },
];

/** The goal comparison. Not offered for Yes/No, which is always "eq". */
export const DIRECTION_OPTIONS: readonly SelectOption[] = [
  { value: "gte", label: "At least (>=)" },
  { value: "lte", label: "At most (<=)" },
  { value: "eq", label: "Exactly (=)" },
];

/** The Yes/No goal; "" is no goal, same as an empty numeric goal. */
export const YESNO_GOAL_OPTIONS: readonly SelectOption[] = [
  { value: "", label: "No goal" },
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" },
];

/**
 * What the Owner trigger shows. The picker lists the team roster only, but
 * the value can be someone who isn't on it: the creator when they aren't
 * rostered (an org admin — `addMetric` lets them own it), or an existing
 * owner who has since left the team (`updateMetric` keeps them). The native
 * select this replaced showed a roster name it would not submit in those
 * cases; this names who will actually be saved.
 */
export function metricOwnerLabel({
  ownerId,
  members,
  selfId,
  resolvedName,
}: {
  ownerId: string;
  members: readonly { user_id: string; full_name: string }[];
  /** The signed-in user's id when known (create mode's default owner). */
  selfId?: string;
  /** A server-resolved name for an owner the roster can't see. */
  resolvedName?: string | null;
}): string {
  if (!ownerId) return "Choose an owner";
  const member = members.find((m) => m.user_id === ownerId);
  if (member) return member.full_name;
  if (resolvedName) return resolvedName;
  if (selfId && ownerId === selfId) return "You";
  return "Current owner (not on this team)";
}
