export function formatGoal(
  goal: number | null,
  direction: string,
  unit: string,
): string {
  if (goal == null) return "—";
  const arrow = direction === "gte" ? "≥" : direction === "lte" ? "≤" : "=";
  if (unit === "currency") return `${arrow} $${goal.toLocaleString()}`;
  if (unit === "percent") return `${arrow} ${goal}%`;
  return `${arrow} ${goal.toLocaleString()}`;
}
