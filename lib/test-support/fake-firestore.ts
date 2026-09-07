// Minimal in-memory Firestore fake for unit tests.
//
// Covers only the surface lib/google/tasks.ts and lib/firebase/teams.ts
// actually call: single-doc get/set/update/delete, `where` (== and "in"),
// `orderBy` (single field, ascending), a bare `collection().get()`, and
// `getAll(...refs)`. It is not an emulator replacement — just enough shape
// to drive these modules' logic without touching real Firebase.

type DocData = Record<string, unknown>;

class FakeDocSnapshot {
  constructor(
    public id: string,
    private raw: DocData | undefined,
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
    const next = opts?.merge && existing ? { ...existing, ...data } : { ...data };
    this.store.write(this.path, next);
  }
  async update(data: DocData) {
    // Real Firestore rejects update() on a missing doc (NOT_FOUND); mirror
    // that so a test can't pass on a path that would fail in production.
    const existing = this.store.raw(this.path);
    if (!existing) throw new Error(`fake-firestore: update() on missing doc ${this.path}`);
    this.store.write(this.path, { ...existing, ...data });
  }
  async delete() {
    this.store.remove(this.path);
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
      .map(({ id, data }) => new FakeDocSnapshot(id, data));

    for (const [field, op, value] of this.wheres) {
      docs = docs.filter((d) => {
        const actual = (d.data() ?? {})[field];
        if (op === "==") return actual === value;
        if (op === "in") return Array.isArray(value) && value.includes(actual);
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

  collection(name: string) {
    return {
      doc: (id: string) => new FakeDocRef(this, `${name}/${id}`),
      where: (field: string, op: string, value: unknown) =>
        new FakeQuery(this, name).where(field, op, value),
      orderBy: (field: string) => new FakeQuery(this, name).orderBy(field),
      get: () => new FakeQuery(this, name).get(),
    };
  }

  async getAll(...refs: FakeDocRef[]) {
    return Promise.all(refs.map((r) => r.get()));
  }

  /** Cast for passing to code typed against firebase-admin's `Firestore`. */
  asFirestore(): import("firebase-admin/firestore").Firestore {
    return this as unknown as import("firebase-admin/firestore").Firestore;
  }
}
