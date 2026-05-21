"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";

type PresenceDoc = {
  uid: string;
  display_name: string;
  last_seen: Timestamp | null;
};

const HEARTBEAT_MS = 20_000;
const STALE_MS = 45_000;

export function MeetingPresence({
  meetingId,
  userId,
  displayName,
}: {
  meetingId: string;
  userId: string;
  displayName: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [present, setPresent] = useState<PresenceDoc[]>([]);

  // Heartbeat + cleanup
  useEffect(() => {
    const db = getClientDb();
    const ref = doc(db, "meetings", meetingId, "presence", userId);

    const write = () =>
      setDoc(ref, {
        uid: userId,
        display_name: displayName,
        last_seen: serverTimestamp(),
      }).catch((e) => console.error("[presence] write:", e));

    write();
    const beat = setInterval(write, HEARTBEAT_MS);

    return () => {
      clearInterval(beat);
      deleteDoc(ref).catch(() => {});
    };
  }, [meetingId, userId, displayName]);

  // Subscribe to others
  useEffect(() => {
    const db = getClientDb();
    const unsub = onSnapshot(
      collection(db, "meetings", meetingId, "presence"),
      (snap) => {
        setPresent(
          snap.docs.map((d) => d.data() as PresenceDoc),
        );
      },
      (err) => console.error("[presence] sub:", err),
    );
    return unsub;
  }, [meetingId]);

  // Tick clock so stale entries fall off without a new snapshot.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const active = useMemo(() => {
    return present.filter((p) => {
      const ts = p.last_seen?.toMillis?.() ?? 0;
      return ts && now - ts < STALE_MS;
    });
  }, [present, now]);

  if (active.length === 0) return null;

  return (
    <div className="flex items-center -space-x-2">
      {active.slice(0, 6).map((p) => {
        const initials = p.display_name
          .split(/\s+/)
          .map((s) => s[0])
          .filter(Boolean)
          .slice(0, 2)
          .join("")
          .toUpperCase();
        const self = p.uid === userId;
        return (
          <div
            key={p.uid}
            title={`${p.display_name}${self ? " (you)" : ""}`}
            className={
              "flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-medium ring-2 ring-white dark:ring-zinc-900 " +
              (self
                ? "bg-blue-600 text-white"
                : "bg-zinc-700 text-white dark:bg-zinc-300 dark:text-zinc-900")
            }
          >
            {initials || "?"}
          </div>
        );
      })}
      {active.length > 6 && (
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-medium text-zinc-600 dark:text-zinc-400 ring-2 ring-white dark:ring-zinc-900">
          +{active.length - 6}
        </div>
      )}
    </div>
  );
}
