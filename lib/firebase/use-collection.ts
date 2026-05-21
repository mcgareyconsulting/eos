"use client";

import { useEffect, useState } from "react";
import {
  onSnapshot,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from "firebase/firestore";

// Realtime collection subscription with server-rendered hydration.
// `initial` paints first; the first onSnapshot result replaces it.
// Loud on failure: a permission-denied error usually means the firestore.rules
// or firestore.indexes.json file hasn't been deployed.
export function useCollection<T>(
  query: Query | null,
  initial: T[],
  label?: string,
): T[] {
  const [docs, setDocs] = useState<T[]>(initial);

  useEffect(() => {
    if (!query) return;
    const unsub = onSnapshot(
      query,
      (snap: QuerySnapshot) => {
        setDocs(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T),
        );
      },
      (err) => {
        console.error(
          `[useCollection${label ? `:${label}` : ""}] subscription error — likely undeployed rules/indexes:`,
          err,
        );
      },
    );
    return unsub;
  }, [query, label]);

  return docs;
}

export function useDoc<T>(
  ref: DocumentReference | null,
  initial: T,
  label?: string,
): T {
  const [doc, setDoc] = useState<T>(initial);

  useEffect(() => {
    if (!ref) return;
    const unsub = onSnapshot(
      ref,
      (snap: DocumentSnapshot) => {
        if (!snap.exists()) return;
        setDoc({ id: snap.id, ...(snap.data() as object) } as T);
      },
      (err) => {
        console.error(
          `[useDoc${label ? `:${label}` : ""}] subscription error:`,
          err,
        );
      },
    );
    return unsub;
  }, [ref, label]);

  return doc;
}
