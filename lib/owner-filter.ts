// Pure pieces of the shared owner filter chip (components/owner-filter.tsx),
// kept here so they are unit-tested without React.

export type OwnerFilterMember = { user_id: string; full_name: string };

/** The `?owner=` value meaning "no owner filter" (the param is absent). */
export const OWNER_FILTER_ALL = "all";

/**
 * Which option the chip shows for a raw `?owner=` value. The value is a
 * member user_id; absent means all. Legacy values from the old
 * Team/Self/Others (and older Mine) filter still arrive via bookmarks — map
 * self/mine to the signed-in user and anything else unknown to "all".
 */
export function resolveOwnerFilter(
  raw: string | null | undefined,
  members: readonly OwnerFilterMember[],
  currentUserId: string,
): string {
  const value = raw || OWNER_FILTER_ALL;
  const mapped = value === "self" || value === "mine" ? currentUserId : value;
  return members.some((m) => m.user_id === mapped) ? mapped : OWNER_FILTER_ALL;
}

/** "All owners" first, then the members by name, the viewer marked "(you)". */
export function ownerFilterOptions(
  members: readonly OwnerFilterMember[],
  currentUserId: string,
): { value: string; label: string }[] {
  const sorted = [...members].sort((a, b) => a.full_name.localeCompare(b.full_name));
  return [
    { value: OWNER_FILTER_ALL, label: "All owners" },
    ...sorted.map((m) => ({
      value: m.user_id,
      label: m.user_id === currentUserId ? `${m.full_name} (you)` : m.full_name,
    })),
  ];
}

/** The query string after picking `next` (the `owner` param dropped for "all"). */
export function ownerFilterQuery(current: string, next: string): string {
  const sp = new URLSearchParams(current);
  if (next === OWNER_FILTER_ALL) sp.delete("owner");
  else sp.set("owner", next);
  return sp.toString();
}
