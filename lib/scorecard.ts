export function formatGoal(
  goal: number | null,
  direction: string,
  unit: string,
): string {
  if (goal == null) return "—";
  const arrow = direction === "gte" ? "≥" : direction === "lte" ? "≤" : "=";
  return `${arrow} ${formatValue(goal, unit)}`;
}

// Same unit rendering as formatGoal but without the comparator prefix.
// Used for averages, individual cell displays, etc.
export function formatValue(value: number | null, unit: string): string {
  if (value == null) return "—";
  if (unit === "currency") {
    return `$${value.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })}`;
  }
  if (unit === "percent") {
    return `${value.toLocaleString(undefined, {
      maximumFractionDigits: 1,
    })}%`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
