"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  onSnapshot,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from "firebase/firestore";
import { getClientAuth } from "./client";

// Resolves to the signed-in uid once Firebase Auth has restored its state,
// `null` if signed out, `undefined` while still determining. Firestore rules
// require request.auth, and a listener attached before auth is ready gets a
// permanent permission-denied — so every realtime subscription waits on this.
export function useAuthUid(): string | null | undefined {
  const [uid, setUid] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    return onAuthStateChanged(getClientAuth(), (u) => setUid(u?.uid ?? null));
  }, []);
  return uid;
}

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
  const uid = useAuthUid();

  useEffect(() => {
    // Wait for client auth — a listener attached before request.auth exists
    // is permanently denied by Firestore rules and never recovers.
    if (!query || !uid) return;
    const unsub = onSnapshot(
      query,
      (snap: QuerySnapshot) => {
        setDocs(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T),
        );
      },
      (err) => {
        console.error(
          `[useCollection${label ? `:${label}` : ""}] subscription error:`,
          err,
        );
      },
    );
    return unsub;
  }, [query, label, uid]);

  return docs;
}

export function useDoc<T>(
  ref: DocumentReference | null,
  initial: T,
  label?: string,
): T {
  const [doc, setDoc] = useState<T>(initial);
  const uid = useAuthUid();

  useEffect(() => {
    if (!ref || !uid) return;
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
  }, [ref, label, uid]);

  return doc;
}
