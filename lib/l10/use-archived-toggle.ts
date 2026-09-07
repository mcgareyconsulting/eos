"use client";

import { useState } from "react";

// Local Active | Archived state for an in-meeting segment, the state half of
// the `EntityViewToggle` pairing.
//
// Resets when the segment unmounts, by design — Active is the right default
// for a room, and a remembered Archived view would read as "the team's issues
// vanished".
//
// Lives here rather than beside `EntityViewToggle` because that module is also
// imported by server components, which cannot pull a hook into their graph.
export function useArchivedToggle() {
  return useState(false);
}
