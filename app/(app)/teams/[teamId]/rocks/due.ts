import { toLocalDate } from "@/lib/dates";

// Urgency coloring for a due date. Completed / done items never shout.
// red-600 for overdue, hpb-brown/gold inside two weeks, muted otherwise —
// same three tones the redesign uses on rocks and milestones alike.
export function dueToneClass(
  due: string | null | undefined,
  done = false,
  from: Date = new Date(),
): string {
  if (!due || done) return "text-zinc-400 dark:text-zinc-500";
  const n = Math.round(
    (toLocalDate(due).getTime() - toLocalDate(from).getTime()) / 86400000,
  );
  if (n < 0) return "text-red-600 dark:text-red-400";
  if (n <= 14) return "text-hpb-brown dark:text-hpb-gold";
  return "text-zinc-500 dark:text-zinc-400";
}
