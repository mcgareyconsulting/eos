"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

export function OwnerFilter({
  members,
  currentUserId,
}: {
  members: { user_id: string; full_name: string }[];
  currentUserId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("owner") || "all";

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
    >
      <option value="all">All owners</option>
      <option value="mine">Mine</option>
      {members
        .filter((m) => m.user_id !== currentUserId)
        .map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.full_name}
          </option>
        ))}
    </select>
  );
}
