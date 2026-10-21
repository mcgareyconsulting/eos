// Headline categories ("kind") as the UI shows them: label, a short line of
// help for the picker, and the color of the small dot that marks the category
// in the form's Category menu and in the meta line under each headline (the
// Headlines tab and the L10 headlines segment). One map, so the dot in the
// menu and the dot on the row can't drift apart.
//
// The stored values are fixed by the server action's KINDS list
// (./actions.ts) and HeadlineKind (lib/headlines.ts); this file only labels
// and colors them.

import type { HeadlineKind } from "@/lib/headlines";

export type HeadlineKindOption = {
  value: HeadlineKind;
  label: string;
  description: string;
  /** Background class for the category dot. */
  dotClassName: string;
};

/** Picker order; the first is the default on create. */
export const HEADLINE_KIND_OPTIONS: readonly HeadlineKindOption[] = [
  {
    value: "customer",
    label: "Customer",
    description: "Good or bad news about a customer",
    dotClassName: "bg-emerald-500",
  },
  {
    value: "employee",
    label: "Employee",
    description: "Good or bad news about someone on the team",
    dotClassName: "bg-sky-500",
  },
  {
    value: "cascading",
    label: "Cascading",
    description: "Listed in the Cascading section",
    dotClassName: "bg-hpb-gold",
  },
  {
    value: "general",
    label: "General / FYI",
    description: "Anything else worth sharing",
    dotClassName: "bg-zinc-400",
  },
];

const BY_VALUE = new Map<string, HeadlineKindOption>(
  HEADLINE_KIND_OPTIONS.map((o) => [o.value, o]),
);

/** The category's display entry. An unknown or missing kind (legacy or
 *  imported docs) reads as Customer — the server action's own fallback. */
export function headlineKind(kind: string | null | undefined): HeadlineKindOption {
  return BY_VALUE.get(kind ?? "") ?? HEADLINE_KIND_OPTIONS[0];
}
