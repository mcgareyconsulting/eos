// Avatar initials from a display name — first letter of the first two words,
// uppercased. Names in this app come from /users profiles and fall back to
// "—" when a profile hasn't been written yet, so callers should render
// `initials(name) || "?"`.
export function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
