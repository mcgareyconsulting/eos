// Export definition: the org Directory (app/(app)/directory), the admin
// people list.
//
// The view is the table's search and its Role and Team filters, which are
// client state in DirectoryTable, so the Export control there passes them
// (`q`, `access`, `teams`, the sets comma-joined). Loads with the page's own
// loader for an admin (lib/firebase/directory getDirectoryPeople — the same
// people, order and admin-only account fields the page gets) and filters
// with the table's own rule (lib/directory-filter.ts). Org-wide: no team.
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

export const DIRECTORY_COLUMNS: readonly ExportColumn<DirectoryPerson>[] = [
  { key: "first_name", header: "First Name", kind: "text", value: (p) => p.firstName, width: 16 },
  { key: "last_name", header: "Last Name", kind: "text", value: (p) => p.lastName, width: 18 },
  {
    key: "teams",
    header: "Team",
    kind: "text",
    value: (p) => (p.teams.length === 0 ? "No team" : p.teams.map((t) => t.name).join("\n")),
    width: 28,
  },
  { key: "access", header: "Role access", kind: "text", value: roleText, width: 24 },
  { key: "email", header: "Email", kind: "text", value: (p) => p.email, width: 32 },
  { key: "account", header: "Account", kind: "text", value: accountText, width: 16 },
  { key: "uid", header: "User ID", kind: "text", value: (p) => p.uid, width: 30 },
];

export function directoryExportWith(
  deps: DirectoryExportDeps = {},
): ExportDefinition<DirectoryPerson, DirectoryExportParams> {
  return {
    id: "directory",
    title: "Directory",
    parseParams: parseDirectoryParams,
    columns: DIRECTORY_COLUMNS,
    async load({ db, uid, viewer }, p): Promise<LoadedView<DirectoryPerson> | ExportRefusal> {
      // The core admits admins only, and the account fields are admin-only, so
      // the loader runs as the page does for an admin. Imported lazily: it
      // pulls the session helpers, which the pure parts of this module (and
      // their tests) don't need.
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
