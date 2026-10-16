// Export definition: the org Directory (app/(app)/directory), the org-wide
// people list every signed-in user can open.
//
// The view is the table's search and its Role and Team filters, which are
// client state in DirectoryTable, so the Export control there passes them
// (`q`, `access`, `teams`, the sets comma-joined). Loads with the page's own
// loader for THIS viewer (lib/firebase/directory getDirectoryPeople(isAdmin)
// — the same people, order and fields the page gets: deactivated people and
// the account state only for an admin) and filters with the table's own
// rule (lib/directory-filter.ts). Org-wide: no team.
//
// The Account column is admin-only, as the account chips are on the page:
// a non-admin's file has no such column at all (DIRECTORY_MEMBER_COLUMNS).
//
// The account fields come from Identity Platform (getDirectoryPeople lists
// every account). `directoryExportWith({ auth })` swaps that one read for a
// test double; production uses `directoryExport`, the real Admin SDK.

import type { getAdminAuth } from "@/lib/firebase/admin";
import type { DirectoryPerson } from "@/lib/firebase/directory";
import { NO_TEAM, filterDirectory, type DirectoryFilter } from "@/lib/directory-filter";
import type {
  ExportColumn,
  ExportDefinition,
  ExportRefusal,
  LoadedView,
} from "../types";
import { checkRowCap } from "../cap";
import { ID_RE, refuse } from "./shared";

/** Test-only seam: production never passes `auth` (getDirectoryPeople's default). */
export type DirectoryExportDeps = {
  auth?: typeof getAdminAuth;
};

export type DirectoryExportParams = {
  query: string;
  access: Set<string>;
  teams: Set<string>;
};

const ACCESS_LABEL: Record<DirectoryPerson["access"], string> = {
  admin: "Admin",
  leader: "Leader",
  member: "Member",
};

function csv(raw: string | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

export function parseDirectoryParams(
  sp: URLSearchParams,
): DirectoryExportParams | ExportRefusal {
  const query = sp.get("q") ?? "";
  const access = csv(sp.get("access"));
  const teams = csv(sp.get("teams"));
  if (query.length > 200) return refuse(400, "Search is too long.");
  if (access.some((a) => !Object.hasOwn(ACCESS_LABEL, a))) {
    return refuse(400, "Invalid role filter.");
  }
  if (teams.length > 200 || teams.some((t) => t !== NO_TEAM && !ID_RE.test(t))) {
    return refuse(400, "Invalid team filter.");
  }
  return { query, access: new Set(access), teams: new Set(teams) };
}

/** The table's rows for this view, in its order (the loader's: last name first). */
export function directoryViewRows(
  people: readonly DirectoryPerson[],
  p: DirectoryExportParams,
): DirectoryPerson[] {
  const filter: DirectoryFilter = { query: p.query, access: p.access, team: p.teams };
  return filterDirectory(people, filter);
}

/** The Role access cell: Deactivated, else Admin, else per team. */
function roleText(p: DirectoryPerson): string {
  if (p.deactivated) return "Deactivated";
  if (p.access === "admin" || p.teams.length === 0) return ACCESS_LABEL[p.access];
  return p.teams
    .map((t) => `${t.name}: ${t.role === "leader" ? "Leader" : "Member"}`)
    .join("\n");
}

/** The account chips admins see: No account / Never signed in. */
function accountText(p: DirectoryPerson): string {
  if (p.hasAuth === false) return "No account";
  if (p.hasSignedIn === false) return "Never signed in";
  return "Signed in";
}

/** Every column, as an admin's file has them. */
export const DIRECTORY_COLUMNS: readonly ExportColumn<DirectoryPerson>[] = [
  { key: "first_name", header: "First Name", kind: "text", value: (p) => p.firstName },
  { key: "last_name", header: "Last Name", kind: "text", value: (p) => p.lastName },
  {
    key: "teams",
    header: "Team",
    kind: "text",
    value: (p) => (p.teams.length === 0 ? "No team" : p.teams.map((t) => t.name).join("\n")),
  },
  { key: "access", header: "Role access", kind: "text", value: roleText },
  { key: "email", header: "Email", kind: "text", value: (p) => p.email },
  { key: "account", header: "Account", kind: "text", value: accountText },
  { key: "uid", header: "User ID", kind: "text", value: (p) => p.uid },
];

/** Admin-only on the page (the No account / Never signed in chips). */
const ADMIN_ONLY_KEYS: ReadonlySet<string> = new Set(["account"]);

/** A non-admin's columns: everything but the admin-only account state. */
export const DIRECTORY_MEMBER_COLUMNS: readonly ExportColumn<DirectoryPerson>[] =
  DIRECTORY_COLUMNS.filter((c) => !ADMIN_ONLY_KEYS.has(c.key));

export function directoryExportWith(
  deps: DirectoryExportDeps = {},
): ExportDefinition<DirectoryPerson, DirectoryExportParams> {
  return {
    id: "directory",
    title: "Directory",
    parseParams: parseDirectoryParams,
    columns: DIRECTORY_COLUMNS,
    // The page's gate is the signed-in session alone (page.tsx →
    // getUserTeamsFirebase → requireFirebaseUser): everyone in the org can
    // open the Directory. The core has already verified the session and the
    // live account, so there is nothing further to check.
    authorize: async () => null,
    async load({ db, uid, viewer }, p): Promise<LoadedView<DirectoryPerson> | ExportRefusal> {
      // The loader runs as the page does for this viewer: getDirectoryPeople
      // leaves deactivated people and the account fields out unless
      // `isAdmin` (the claim as it stands on the account now). Imported
      // lazily: it pulls the session helpers, which the pure parts of this
      // module (and their tests) don't need.
      const { getDirectoryPeople } = await import("@/lib/firebase/directory");
      const [people, teamsSnap] = await Promise.all([
        getDirectoryPeople(viewer.isAdmin, {
          user: async () =>
            ({ uid, db, isAdmin: viewer.isAdmin }) as unknown as Awaited<
              ReturnType<typeof import("@/lib/firebase/auth").requireFirebaseUser>
            >,
          // Undefined in production: getDirectoryPeople reads the real
          // Identity Platform accounts.
          auth: deps.auth,
        }),
        db.collection("teams").get(),
      ]);
      const rows = directoryViewRows(people, p);
      // Row cap (lib/export/cap.ts): the view is the loader's people filtered
      // in memory by the table's rule; nothing below reads per row.
      const overCap = checkRowCap(rows.length);
      if (overCap) return overCap;
      const teamName = new Map(
        teamsSnap.docs.map((d) => [d.id, (d.data()?.name as string) ?? "Team"]),
      );
      const names = (set: ReadonlySet<string>, all: string, label: (v: string) => string) =>
        set.size === 0 ? all : [...set].map(label).sort().join(", ");

      return {
        ok: true,
        rows,
        teamId: null,
        columns: viewer.isAdmin ? DIRECTORY_COLUMNS : DIRECTORY_MEMBER_COLUMNS,
        filters: [
          { label: "Search", value: p.query.trim() || "(none)" },
          {
            label: "Role",
            value: names(p.access, "All roles", (a) => ACCESS_LABEL[a as DirectoryPerson["access"]]),
          },
          {
            label: "Team",
            value: names(p.teams, "All teams", (t) =>
              t === NO_TEAM ? "No team" : (teamName.get(t) ?? "—"),
            ),
          },
        ],
        fileNameParts: ["people"],
      };
    },
  };
}

export const directoryExport = directoryExportWith();
