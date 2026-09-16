// Rows → plan. Pure: the caller supplies the teams that already exist, so
// every merge/match rule here is testable without Firestore.

import { normalizeKey } from "../csv-import";
import type {
  SeedIssue,
  SeedPersonPlan,
  SeedPersonRow,
  SeedPlan,
  SeedTeamPlan,
} from "../user-import-types";

/**
 * Merge the file's rows into one plan entry per person and one per team.
 *
 * A person may appear on several rows — that is how a seed file puts someone
 * on two teams — so rows are keyed by email and their teams unioned. The
 * first row to carry a given field wins; a later row that disagrees about the
 * *name* is reported (it is usually a typo in one of the two) but does not
 * stop the import.
 *
 * Teams are matched to existing ones by normalized name, so re-running the
 * same file joins the teams it made the first time instead of creating
 * "Leadership" beside "leadership".
 */
export function buildSeedPlan(
  rows: SeedPersonRow[],
  existingTeams: { id: string; name: string }[],
): SeedPlan {
  const issues: SeedIssue[] = [];

  const teamIdByKey = new Map<string, string>();
  for (const t of existingTeams) {
    const key = normalizeKey(t.name);
    // First wins: if the org already has two teams whose names normalize the
    // same, the import must not silently pick the later one on re-run.
    if (key && !teamIdByKey.has(key)) teamIdByKey.set(key, t.id);
  }

  const byEmail = new Map<string, SeedPersonPlan>();
  for (const row of rows) {
    const existing = byEmail.get(row.email);
    if (!existing) {
      byEmail.set(row.email, {
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
        title: row.title,
        teams: [...row.teams],
        lines: [row.line],
      });
      continue;
    }

    existing.lines.push(row.line);

    const wasName = `${existing.firstName} ${existing.lastName}`.trim();
    const nowName = `${row.firstName} ${row.lastName}`.trim();
    if (nowName && wasName && normalizeKey(nowName) !== normalizeKey(wasName)) {
      issues.push({
        line: row.line,
        label: row.email,
        reason: `Two names for one address — keeping "${wasName}", ignoring "${nowName}".`,
      });
    }

    // Fill blanks from later rows, never overwrite what the first row set.
    if (!existing.firstName) existing.firstName = row.firstName;
    if (!existing.lastName) existing.lastName = row.lastName;
    if (!existing.title) existing.title = row.title;

    for (const team of row.teams) {
      const key = normalizeKey(team);
      if (!existing.teams.some((t) => normalizeKey(t) === key)) {
        existing.teams.push(team);
      }
    }
  }

  const people = [...byEmail.values()];

  // Team plans, in first-seen order so the report reads like the file.
  const teams = new Map<string, SeedTeamPlan>();
  for (const person of people) {
    for (const name of person.teams) {
      const key = normalizeKey(name);
      if (!key) continue;
      let plan = teams.get(key);
      if (!plan) {
        const teamId = teamIdByKey.get(key) ?? null;
        plan = {
          name: name.trim(),
          teamId,
          action: teamId ? "match" : "create",
          emails: [],
        };
        teams.set(key, plan);
      }
      if (!plan.emails.includes(person.email)) plan.emails.push(person.email);
    }
  }

  return { people, teams: [...teams.values()], issues };
}
