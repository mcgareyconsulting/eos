import { daysUntil } from "@/lib/dates";

// Urgency coloring for a due date. Completed / done items never shout.
// red-600 for overdue, hpb-brown/gold inside two weeks, muted otherwise —
// the same three tones rocks, milestones and to-dos all read by.
export function dueToneClass(
  due: string | null | undefined,
  done = false,
  from: Date = new Date(),
): string {
  if (!due || done) return "text-zinc-400 dark:text-zinc-500";
  const n = daysUntil(due, from);
  if (n < 0) return "text-red-600 dark:text-red-400";
  if (n <= 14) return "text-hpb-brown dark:text-hpb-gold";
  return "text-zinc-500 dark:text-zinc-400";
}
