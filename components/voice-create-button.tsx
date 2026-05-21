"use client";

import { useState } from "react";
import { Mic } from "lucide-react";
import { VoiceCreateModal } from "./voice-create-modal";

export function VoiceCreateButton({ teamId }: { teamId: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Voice create (to-do, issue, or rock)"
        aria-label="Voice create"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <Mic className="h-4 w-4" />
      </button>
      <VoiceCreateModal
        open={open}
        onClose={() => setOpen(false)}
        teamId={teamId}
      />
    </>
  );
}
