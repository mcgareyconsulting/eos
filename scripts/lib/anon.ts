// Stand-in names for script output that leaves the bank — a report pasted
// into a chat or a ticket. Each real name gets a stable alias for the run
// ("Person 03", "Measurable 017"); numbers, dates and team names are left as
// they are, so the report still compares. The key (alias → real name) is
// written to a local file that stays with whoever ran the script.

import { writeFileSync } from "node:fs";
import { normalizeKey, normalizePersonKey } from "../../lib/csv-import";

export class Anonymizer {
  private people = new Map<string, string>();
  private measurables = new Map<string, string>();
  private real = new Map<string, string>();

  constructor(private readonly on: boolean) {}

  person(name: string): string {
    return this.alias(name, normalizePersonKey(name), this.people, "Person", 2);
  }

  measurable(name: string): string {
    return this.alias(name, normalizeKey(name), this.measurables, "Measurable", 3);
  }

  private alias(name: string, key: string, map: Map<string, string>, label: string, width: number): string {
    if (!this.on || !name || !key) return name;
    let a = map.get(key);
    if (!a) {
      a = `${label} ${String(map.size + 1).padStart(width, "0")}`;
      map.set(key, a);
      this.real.set(a, name);
    }
    return a;
  }

  /** Write alias,real-name pairs. Never paste this file along with the report. */
  writeKey(path: string): void {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    writeFileSync(path, ["alias,real", ...[...this.real].map(([a, r]) => `${esc(a)},${esc(r)}`)].join("\n"));
  }
}
