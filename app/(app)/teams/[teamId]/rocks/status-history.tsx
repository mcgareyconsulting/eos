"use client";

// Plain-data history entry (server serializes Timestamps → millis).
export type StatusUpdateSerialized = {
  id: string;
  status: string;
  comment: string | null;
  user_id: string | null;
  /** Epoch millis, or null if the server timestamp hasn't resolved yet. */
  created_at_ms: number | null;
  author_name: string;
};
