// Batched Firestore writes, per-row preview collection, and Owner-name
// resolution — the shared ctx every kind importer is handed.

import { FieldValue } from "firebase-admin/firestore";
import type { DocumentData, Firestore, WriteBatch } from "firebase-admin/firestore";
import { normalizePersonKey, slugify } from "../csv-import";
import type { PreviewRow } from "../team-import-types";

// ---------------------------------------------------------------------------
// Batched writes
// ---------------------------------------------------------------------------

export class Writer {
  private batch: WriteBatch;
  private pending = 0;
  written = 0;

  constructor(
    private db: Firestore,
    private dryRun: boolean,
  ) {
    this.batch = db.batch();
  }

  async set(path: [string, string], data: DocumentData) {
    this.written++;
    if (this.dryRun) return;
    this.batch.set(this.db.collection(path[0]).doc(path[1]), data, { merge: true });
    if (++this.pending >= 400) await this.flush();
  }

  async flush() {
    if (this.dryRun || this.pending === 0) return;
    await this.batch.commit();
    this.batch = this.db.batch();
    this.pending = 0;
  }
}

// ---------------------------------------------------------------------------
// Owner resolution
// ---------------------------------------------------------------------------

/**
 * Collects the per-row preview. Capped so a 5k-row export can't turn the
 * server-action response into a payload the browser has to swallow whole; the
 * overflow is reported as a count.
 */
export class PreviewCollector {
  readonly rows: PreviewRow[] = [];
  truncated = 0;

  constructor(private limit = 250) {}

  add(row: PreviewRow): void {
    if (this.rows.length < this.limit) this.rows.push(row);
    else this.truncated++;
  }
}

export type Member = { user_id: string; names: string[] };

export async function loadMembers(db: Firestore, teamId: string): Promise<Member[]> {
  const membersSnap = await db
    .collection("team_members")
    .where("team_id", "==", teamId)
    .get();
  const ids = membersSnap.docs.map((d) => d.data().user_id as string);
  if (ids.length === 0) return [];

  const userDocs = await db.getAll(...ids.map((id) => db.collection("users").doc(id)));
  return ids.map((id, i) => {
    const data = userDocs[i]?.data() ?? {};
    const first = (data.first_name as string) ?? "";
    const last = (data.last_name as string) ?? "";
    const email = (data.email as string) ?? "";
    const names = [
      data.display_name as string,
      `${first} ${last}`.trim(),
      email,
      email.includes("@") ? email.split("@")[0].replace(/[._]/g, " ") : "",
      id,
    ].filter((n): n is string => !!n && n.trim() !== "");
    return { user_id: id, names };
  });
}

export class OwnerResolver {
  private index = new Map<string, string>();
  private nameByUid = new Map<string, string>();
  private cache = new Map<string, string | null>();
  created: { user_id: string; name: string }[] = [];
  unresolved = new Set<string>();

  constructor(
    private teamId: string,
    members: Member[],
    private opts: {
      createOwners: boolean;
      fallbackId: string | null;
      aliases?: Map<string, string>;
      writer: Writer;
    },
  ) {
    for (const m of members) {
      const display = m.names.find((n) => n.trim());
      if (display) this.nameByUid.set(m.user_id, display.trim());
      for (const n of m.names) {
        const key = normalizePersonKey(n);
        if (key && !this.index.has(key)) this.index.set(key, m.user_id);
      }
    }
  }

  /** Display name for a resolved uid — for the preview, not for writes. */
  nameFor(uid: string | null): string {
    if (!uid) return "No Owner";
    return this.nameByUid.get(uid) || uid;
  }

  lookup(name: string): string | null {
    const key = normalizePersonKey(name);
    return this.opts.aliases?.get(key) ?? this.index.get(key) ?? null;
  }

  /**
   * resolve() plus the name that failed to match, so an importer can put it in
   * the row's description instead of dropping the row. A blank Owner cell is
   * not "unmatched" — there was no name to match.
   */
  async resolveOwner(
    rawName: string,
  ): Promise<{ uid: string | null; unmatchedName: string | null }> {
    const raw = (rawName ?? "").trim();
    const uid = await this.resolve(rawName);
    if (uid !== null || !raw) return { uid, unmatchedName: null };
    return { uid: null, unmatchedName: raw };
  }

  async resolve(rawName: string): Promise<string | null> {
    const raw = (rawName ?? "").trim();
    if (!raw) return this.opts.fallbackId;

    const key = normalizePersonKey(raw);
    if (this.cache.has(key)) return this.cache.get(key)!;

    let uid = this.opts.aliases?.get(key) ?? this.index.get(key) ?? null;

    if (!uid && !key.includes(" ")) {
      const partial = [...this.index.entries()].filter(([k]) =>
        k.split(" ").includes(key),
      );
      if (partial.length === 1) uid = partial[0][1];
    }

    if (!uid && this.opts.createOwners) {
      uid = `import-${slugify(raw, 32)}`;
      const [first, ...rest] = raw.split(/\s+/);
      await this.opts.writer.set(["users", uid], {
        display_name: raw,
        first_name: first ?? raw,
        last_name: rest.join(" ") || null,
        email: null,
        created_via: "csv-import",
      });
      await this.opts.writer.set(["team_members", `${this.teamId}__${uid}`], {
        team_id: this.teamId,
        user_id: uid,
        role: "member",
        created_at: FieldValue.serverTimestamp(),
      });
      this.index.set(key, uid);
      this.nameByUid.set(uid, raw);
      this.created.push({ user_id: uid, name: raw });
    }

    if (!uid) {
      uid = this.opts.fallbackId;
      if (!uid) this.unresolved.add(raw);
    }

    this.cache.set(key, uid);
    return uid;
  }
}

/**
 * Keep an unmatched Owner name with the row it came from. The client's case is
 * a departed employee: the rows still have to import, but "who used to own
 * this" must not silently vanish.
 */
export function withUnmatchedOwnerNote(
  description: string | null | undefined,
  name: string,
): string {
  const note = `Imported owner: ${name.trim()}`;
  const body = (description ?? "").trim();
  if (!note.endsWith(":") && body.includes(note)) return body; // re-import
  return body ? `${body}\n\n${note}` : note;
}

// Not part of the public `@/lib/team-import` surface — only runTeamImport
// (in ./run) uses this, to seed which docs already exist before importing.
export async function loadExistingIds(
  db: Firestore,
  teamId: string,
  collections: string[],
): Promise<Set<string>> {
  const sets = await Promise.all(
    collections.map(async (c) => {
      const snap = await db.collection(c).where("team_id", "==", teamId).select().get();
      return snap.docs.map((d) => d.id);
    }),
  );
  return new Set(sets.flat());
}
