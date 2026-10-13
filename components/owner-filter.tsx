"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { SelectMenu } from "@/components/ui/select-menu";
import {
  OWNER_FILTER_ALL,
  ownerFilterOptions,
  ownerFilterQuery,
  resolveOwnerFilter,
  type OwnerFilterMember,
} from "@/lib/owner-filter";

// Owner filter chip on Rocks, Issues, Headlines and To-dos: "All owners" plus
// one entry per team member, in the same pill as the scorecard filters. The
// ?owner= query value is a member user_id (absent = all); legacy values are
// mapped in `resolveOwnerFilter`.
export function OwnerFilter({
  members,
  currentUserId,
}: {
  members: OwnerFilterMember[];
  currentUserId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const options = useMemo(
    () => ownerFilterOptions(members, currentUserId),
    [members, currentUserId],
  );
  const current = resolveOwnerFilter(params.get("owner"), members, currentUserId);

  function update(next: string) {
    const qs = ownerFilterQuery(params.toString(), next);
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    // w-full: fills the header's fixed filter column (EntityPageHeader), so
    // the chip lines up on every page whatever name is picked.
    <SelectMenu
      variant="pill"
      aria-label="Filter by owner"
      title="Filter by owner"
      options={options}
      value={current}
      active={current !== OWNER_FILTER_ALL}
      onChange={update}
      className="w-full"
    />
  );
}
