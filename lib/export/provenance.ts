// The provenance header every export carries (docs/EXPORT.md): who, when
// (America/Chicago), which view, how many rows, which build. Pure — the
// caller passes the clock and the environment.

import { EXPORT_TIME_ZONE, formatChicagoDateTime } from "./normalize";
import type { ExportFilterLine } from "./types";

export const APP_NAME = "HPB Pulse";

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

/** "Name <email>", or whichever half exists, or the uid. */
export function exporterLabel(user: {
  uid: string;
  name?: string | null;
  email?: string | null;
}): string {
  const name = user.name?.trim();
  const email = user.email?.trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || user.uid;
}

export function filtersLabel(filters: readonly ExportFilterLine[]): string {
  if (filters.length === 0) return "None";
  return filters.map((f) => `${f.label}: ${f.value}`).join(" · ");
}

export function provenanceLines(input: {
  title: string;
  exportedBy: string;
  now: Date;
  filters: readonly ExportFilterLine[];
  rowCount: number;
  version: string;
}): ExportFilterLine[] {
  return [
    { label: "Export", value: `${APP_NAME} — ${input.title}` },
    { label: "Exported by", value: input.exportedBy },
    {
      label: "Exported at",
      value: `${formatChicagoDateTime(input.now)} (${EXPORT_TIME_ZONE})`,
    },
    { label: "Filters applied", value: filtersLabel(input.filters) },
    { label: "Rows", value: String(input.rowCount) },
    { label: "App version", value: input.version },
  ];
}

/** Lowercase ASCII words joined by "-", for file names. */
export function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[^\x00-\x7f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "export"
  );
}

/** `hpb-pulse_todos_leadership_active_2026-10-16` (no extension). */
export function exportFileName(id: string, parts: readonly string[], now: Date): string {
  const day = formatChicagoDateTime(now).slice(0, 10);
  return ["hpb-pulse", slug(id), ...parts.map(slug), day].join("_");
}
