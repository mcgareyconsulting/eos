"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "team", label: "Team" },
  { value: "self", label: "Self" },
  { value: "others", label: "Others" },
] as const;

export type OwnerFilterValue = (typeof FILTERS)[number]["value"];

export function OwnerFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("owner") || "all";
  // Legacy query values from the old Mine / per-person filter.
  const current =
    raw === "mine"
      ? "self"
      : FILTERS.some((f) => f.value === raw)
        ? raw
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
      {FILTERS.map((f) => (
        <option key={f.value} value={f.value}>
          {f.label}
        </option>
      ))}
    </select>
  );
}
