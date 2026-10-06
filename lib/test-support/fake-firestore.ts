// Minimal in-memory Firestore fake for unit tests.
//
// Covers only the surface lib/google/tasks.ts, lib/firebase/teams.ts,
// lib/firebase/queries.ts and lib/firebase/notifications.ts actually call:
// single-doc get/set/update/delete, `where` (==, "in" and "array-contains"),
// `orderBy` (single field, ascending), a bare `collection().get()`,
// `collection().doc()` with no id (auto-id), `getAll(...refs)`, a
// `batch()` of set/update/delete, one-level subcollections
// (`doc().collection()`, with `.ref` on query results), and
// `FieldValue.delete()` in set/update. It is not an emulator replacement — just
// enough shape to drive these modules' logic without touching real Firebase.

import { FieldValue } from "firebase-admin/firestore";

type DocData = Record<string, unknown>;

const DELETE = FieldValue.delete();

/** Apply `patch` onto `base`, honouring FieldValue.delete() like Firestore. */
function applyPatch(base: DocData, patch: DocData): DocData {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v instanceof FieldValue && v.isEqual(DELETE)) delete out[k];
    else out[k] = v;
  }
  return out;
}

class FakeDocSnapshot {
  constructor(
    public id: string,
    private raw: DocData | undefined,
    /** Set on query results, so callers can `batch.delete(snap.ref)`. */
    public ref?: FakeDocRef,
  ) {}
  get exists() {
    return this.raw !== undefined;
  }
  data() {
    return this.raw ? { ...this.raw } : undefined;
  }
}

class FakeDocRef {
  constructor(
    private store: FakeFirestore,
    private path: string,
  ) {}
  get id() {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }
  async get() {
    return new FakeDocSnapshot(this.id, this.store.raw(this.path));
  }
  async set(data: DocData, opts?: { merge?: boolean }) {
    const existing = this.store.raw(this.path);
    const next = applyPatch(opts?.merge && existing ? existing : {}, data);
    this.store.write(this.path, next);
  }
  async update(data: DocData) {
    // Real Firestore rejects update() on a missing doc (NOT_FOUND); mirror
    // that so a test can't pass on a path that would fail in production.
    const existing = this.store.raw(this.path);
    // `code: 5` is gRPC NOT_FOUND, which is what callers branch on.
    if (!existing) {
      throw Object.assign(new Error(`fake-firestore: update() on missing doc ${this.path}`), {
        code: 5,
      });
    }
    this.store.write(this.path, applyPatch(existing, data));
  }
  async delete() {
    this.store.remove(this.path);
  }
  /** Subcollection, e.g. `meetings/m1/effectiveness_scores`. */
  collection(name: string) {
    return this.store.collection(`${this.path}/${name}`);
  }
}

type WhereClause = [string, string, unknown];

class FakeQuery {
  constructor(
    private store: FakeFirestore,
    private collectionPath: string,
    private wheres: WhereClause[] = [],
    private order?: string,
  ) {}

  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(
      this.store,
      this.collectionPath,
      [...this.wheres, [field, op, value]],
      this.order,
    );
  }

  orderBy(field: string): FakeQuery {
    return new FakeQuery(this.store, this.collectionPath, this.wheres, field);
  }

  async get() {
    let docs = this.store
      .docsIn(this.collectionPath)
      .map(
        ({ id, data }) =>
          new FakeDocSnapshot(id, data, new FakeDocRef(this.store, `${this.collectionPath}/${id}`)),
      );

    for (const [field, op, value] of this.wheres) {
      docs = docs.filter((d) => {
        const actual = (d.data() ?? {})[field];
        if (op === "==") return actual === value;
        if (op === "in") return Array.isArray(value) && value.includes(actual);
        // Real Firestore skips docs where the field is missing or not an
        // array, rather than erroring — shared_team_ids is absent on most
        // rocks.
        if (op === "array-contains")
          return Array.isArray(actual) && actual.includes(value);
        throw new Error(`fake-firestore: unsupported where operator ${op}`);
      });
    }
    if (this.order) {
      const field = this.order;
      docs = [...docs].sort((a, b) => {
        const av = String((a.data() ?? {})[field] ?? "");
        const bv = String((b.data() ?? {})[field] ?? "");
        return av.localeCompare(bv);
      });
    }
    return { docs };
  }
}

/** Seed with `seed(collection, id, data)`, then pass `fake.asFirestore()`. */
export class FakeFirestore {
  private docs = new Map<string, DocData>();

  raw(path: string): DocData | undefined {
    return this.docs.get(path);
  }
  write(path: string, data: DocData) {
    this.docs.set(path, data);
  }
  remove(path: string) {
    this.docs.delete(path);
  }
  docsIn(collectionPath: string): { id: string; data: DocData }[] {
    const prefix = `${collectionPath}/`;
    return [...this.docs.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, data]) => ({ id: path.slice(prefix.length), data }));
  }

  /** Seed a doc directly (bypasses any `set`/`merge` semantics). */
  seed(collection: string, id: string, data: DocData) {
    this.docs.set(`${collection}/${id}`, data);
  }

  private autoId = 0;

  collection(name: string) {
    return {
      doc: (id?: string) =>
        new FakeDocRef(this, `${name}/${id ?? `auto-${++this.autoId}`}`),
      where: (field: string, op: string, value: unknown) =>
        new FakeQuery(this, name).where(field, op, value),
      orderBy: (field: string) => new FakeQuery(this, name).orderBy(field),
      get: () => new FakeQuery(this, name).get(),
    };
  }

  async getAll(...refs: FakeDocRef[]) {
    return Promise.all(refs.map((r) => r.get()));
  }

  /** Queued writes applied together on commit(), like the real WriteBatch. */
  batch() {
    const ops: (() => Promise<void>)[] = [];
    const b = {
      set: (ref: FakeDocRef, data: DocData, opts?: { merge?: boolean }) => {
        ops.push(() => ref.set(data, opts));
        return b;
      },
      update: (ref: FakeDocRef, data: DocData) => {
        ops.push(() => ref.update(data));
        return b;
      },
      delete: (ref: FakeDocRef) => {
        ops.push(() => ref.delete());
        return b;
      },
      commit: async () => {
        for (const op of ops) await op();
      },
    };
    return b;
  }

  /** Cast for passing to code typed against firebase-admin's `Firestore`. */
  asFirestore(): import("firebase-admin/firestore").Firestore {
    return this as unknown as import("firebase-admin/firestore").Firestore;
  }
}
