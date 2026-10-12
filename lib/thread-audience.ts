// The "Visible to …" line under a comment box (docs/PERMISSIONS_SPEC.md §5.1:
// "The comment box shows who can read the thread"). Pure: the server action
// loads the item and the team names, this words them.

import {
  audienceTeamIdsOf,
  audienceUserIdsOf,
  type RockSubject,
} from "@/lib/access/rock";
import type { ItemType } from "@/lib/item-registry";

function list(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function rockAudiencePart(
  rock: RockSubject,
  teamName: (id: string) => string,
): string | null {
  const teams = audienceTeamIdsOf(rock).map(teamName);
  const persons = audienceUserIdsOf(rock).length;
  if (teams.length === 0 && persons === 0) return null;
  const detail = [
    ...teams,
    ...(persons > 0
      ? [`${persons} named ${persons === 1 ? "person" : "people"}`]
      : []),
  ];
  return `this rock's audience (${list(detail)})`;
}

/**
 * Who can read the thread of an item, in words. `subject` is the access
 * subject (`LoadedItem.subject`); `teamName` resolves a team id.
 */
export function visibleToLine(
  type: ItemType,
  subject: unknown,
  teamName: (id: string) => string,
): string {
  const s = subject as Record<string, unknown>;
  const parts: string[] = [];
  switch (type) {
    case "rock": {
      const rock = s as unknown as RockSubject;
      parts.push(teamName(rock.team_id));
      const aud = rockAudiencePart(rock, teamName);
      if (aud) parts.push(aud);
      break;
    }
    case "milestone": {
      const m = s as unknown as {
        milestone: { team_id: string };
        rock: RockSubject;
      };
      parts.push(teamName(m.milestone.team_id));
      const aud = rockAudiencePart(m.rock, teamName);
      if (aud) parts.push(aud);
      parts.push("the assignee");
      break;
    }
    case "todo": {
      if (s.visibility === "private") {
        parts.push("the creator", "the assignee");
      } else {
        parts.push(teamName(String(s.team_id ?? "")), "the assignee");
      }
      break;
    }
    default:
      parts.push(teamName(String(s.team_id ?? "")));
  }
  parts.push("admins");
  return `Visible to ${list(parts)}.`;
}

