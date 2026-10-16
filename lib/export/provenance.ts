// Provenance for an export (docs/EXPORT.md). A CSV has no header block —
// extra rows above the table would break sorting and filtering in Excel —
// so provenance lives in two places:
//
//   the file name   which page, which team / view, when (Mountain time):
//                   `todos-leadership-active-2026-10-16-1305-MT.csv`
//   the audit row   who, the filters, the row count, the build, the file
//                   name (lib/export/audit.ts)
//
// Pure — the caller passes the clock and the environment.

import { formatMountainDate, formatMountainDateTime } from "./normalize";

/**
 * The build that produced the file. `DEPLOYMENT_ID` is `<git short sha>-<Cloud
 * Build id>` (cloudbuild.yaml, Dockerfile — the same value the client-error
 * sink records); `K_REVISION` is the Cloud Run revision serving the request.
 * Local builds have neither.
 */
export function appVersion(env: Record<string, string | undefined> = process.env): string {
  const parts = [env.DEPLOYMENT_ID?.trim(), env.K_REVISION?.trim()].filter(
    (v): v is string => !!v,
  );
  return parts.length > 0 ? parts.join(" · ") : "local build";
}

/** Lowercase ASCII words joined by "-": safe in any file name and header. */
export function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[^\x00-\x7f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "export"
  );
}

/**
 * `todos-leadership-active-2026-10-16-1305-MT.csv`: page, the loader's
 * words (team, view), the Mountain date and time. Only `[a-z0-9-]` plus the
 * `MT` marker and the extension, so it needs no escaping in
 * Content-Disposition.
 */
export function exportFileName(id: string, parts: readonly string[], now: Date): string {
  const [day, time] = formatMountainDateTime(now).split(" ");
  const stamp = `${day ?? formatMountainDate(now)}-${(time ?? "").replace(":", "")}`;
  return [slug(id), ...parts.map(slug), stamp, "MT"].join("-") + ".csv";
}
