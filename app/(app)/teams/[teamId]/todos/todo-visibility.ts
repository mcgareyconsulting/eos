// The to-do Visibility control's choices and wording (the segmented
// Team / Private toggle in todo-form-fields.tsx). Pure, so the copy and the
// keyboard stepping are unit-tested (todo-visibility.test.ts).
//
// Who can see what, per docs/PERMISSIONS_SPEC.md §3:
//   team    (shape A) — the parent team, the assignee (owner) from any team,
//                       admins; shows in the team's lists and L10 (§3.1).
//   private (shape B) — the creator, the assignee and admins only; never on
//                       the team's lists or L10, leaders get nothing (§3.2,
//                       lib/access/private-item.ts).
// The description says exactly that group, naming "you" where the viewer is
// in it, so Private reads as the least-privilege choice it is.

export type TodoVisibility = "team" | "private";

export type TodoVisibilityChoice = {
  value: TodoVisibility;
  label: string;
  description: string;
  disabled: boolean;
};

/**
 * "Only you, the owner and admins can see it." — the private audience, from
 * the viewer's seat. `creatorId` is null on legacy to-dos with no
 * `created_by` (then the owner and admins only, as
 * lib/access/private-item.ts reads it). Duplicates
 * collapse: a to-do you created for yourself is "Only you and admins".
 */
export function privateAudience({
  creatorId,
  ownerId,
  viewerId,
}: {
  creatorId: string | null;
  ownerId: string;
  viewerId: string;
}): string {
  const parties: string[] = [];
  if (viewerId && (viewerId === creatorId || viewerId === ownerId)) {
    parties.push("you");
  }
  if (creatorId && creatorId !== viewerId && creatorId !== ownerId) {
    parties.push("its creator");
  }
  if (ownerId && ownerId !== viewerId) parties.push("the owner");
  parties.push("admins");
  const list =
    parties.length === 1
      ? parties[0]
      : `${parties.slice(0, -1).join(", ")} and ${parties[parties.length - 1]}`;
  return `Only ${list} can see it.`;
}

export const TEAM_AUDIENCE =
  "This team, the owner and admins can see it.";

export function todoVisibilityChoices({
  canPublish,
  creatorId,
  ownerId,
  viewerId,
}: {
  /** False when the viewer may not make a private to-do a team one (§3.2). */
  canPublish: boolean;
  creatorId: string | null;
  ownerId: string;
  viewerId: string;
}): TodoVisibilityChoice[] {
  return [
    {
      value: "team",
      label: "Team",
      description: `${TEAM_AUDIENCE} Shows on the team's L10.`,
      disabled: !canPublish,
    },
    {
      value: "private",
      label: "Private",
      description: `${privateAudience({ creatorId, ownerId, viewerId })} Never shows on the L10.`,
      disabled: false,
    },
  ];
}

/**
 * Arrow-key step through a radio group: the next enabled choice `delta`
 * away, wrapping; the current value if nothing else is enabled.
 */
export function stepChoice(
  choices: readonly { value: TodoVisibility; disabled: boolean }[],
  current: TodoVisibility,
  delta: 1 | -1,
): TodoVisibility {
  const n = choices.length;
  const start = Math.max(
    0,
    choices.findIndex((c) => c.value === current),
  );
  for (let i = 1; i <= n; i++) {
    const c = choices[(start + delta * i + n * n) % n];
    if (!c.disabled) return c.value;
  }
  return current;
}
