"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

type Member = { user_id: string; full_name: string };

// Owner filter: "All" plus one entry per team member. The ?owner= query value
// is a member user_id (absent = all). Legacy values from the old
// Team/Self/Others (and older Mine) filter still arrive via bookmarks — map
// self/mine to the signed-in user and everything else unknown to "all".
export function OwnerFilter({
  members,
  currentUserId,
}: {
  members: Member[];
  currentUserId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("owner") || "all";

  const sorted = [...members].sort((a, b) =>
    a.full_name.localeCompare(b.full_name),
  );

  const legacyMapped =
    raw === "self" || raw === "mine" ? currentUserId : raw;
  const current = sorted.some((m) => m.user_id === legacyMapped)
    ? legacyMapped
    : "all";

  function update(next: string) {
    const sp = new URLSearchParams(params.toString());
    if (next === "all") sp.delete("owner");
    else sp.set("owner", next);
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <select
      value={current}
      onChange={(e) => update(e.target.value)}
      className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm"
      aria-label="Filter rocks by owner"
    >
      <option value="all">All</option>
      {sorted.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.full_name}
          {m.user_id === currentUserId ? " (you)" : ""}
        </option>
      ))}
    </select>
  );
}
