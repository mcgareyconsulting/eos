// Option lists and the Owner field's display name for the issue create/edit
// form (issue-form-modal.tsx). Kept free of React so they can be tested.

import type { SelectOption } from "@/components/ui/select-menu";
import {
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  type IssuePriority,
  type IssueType,
} from "@/lib/issues";

/** "" is no priority — the value `updateIssueMeta`/`addIssue` read as null. */
export type IssuePriorityValue = IssuePriority | "";

export const ISSUE_PRIORITY_OPTIONS: SelectOption<IssuePriorityValue>[] = [
  { value: "", label: "No priority" },
  ...PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })),
];

export const ISSUE_TERM_OPTIONS: SelectOption<IssueType>[] = [
  { value: "short", label: "Short-term" },
  { value: "long", label: "Long-term" },
];

/** Narrows a stored priority to one the form offers; anything else is "". */
export function toPriorityValue(raw: string | null | undefined): IssuePriorityValue {
  return PRIORITY_ORDER.includes(raw as IssuePriority) ? (raw as IssuePriority) : "";
}

/**
 * What the Owner trigger shows. The picker lists the team roster only (the
 * server requires an issue owner to be on it), but two off-roster owners can
 * still be the value: the viewer themself (an org admin working a team they
 * aren't rostered on — the create default, and `requireRosterOwner` lets
 * `self` through), and an owner kept from before they left the team (`keep`).
 */
export function issueOwnerName(
  ownerId: string,
  members: readonly { user_id: string; full_name: string }[],
  selfId: string,
): string {
  if (!ownerId) return "Unassigned";
  const member = members.find((m) => m.user_id === ownerId);
  if (member) return member.full_name;
  if (ownerId === selfId) return "You";
  return "Not on this team";
}
