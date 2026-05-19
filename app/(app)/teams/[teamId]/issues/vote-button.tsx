"use client";

import { useState, useTransition } from "react";
import { ArrowBigUp } from "lucide-react";
import { toggleIssueVote } from "./actions";
import { cn } from "@/lib/utils";

export function VoteButton({
  teamId,
  issueId,
  votes,
  voted,
}: {
  teamId: string;
  issueId: string;
  votes: number;
  voted: boolean;
}) {
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useState({ votes, voted });

  const onClick = () => {
    const nextVoted = !optimistic.voted;
    const nextVotes = Math.max(
      0,
      optimistic.votes + (nextVoted ? 1 : -1),
    );
    setOptimistic({ votes: nextVotes, voted: nextVoted });
    start(async () => {
      try {
        await toggleIssueVote(teamId, issueId);
      } catch (e) {
        // Revert + show the server's message (e.g. max-3 limit).
        setOptimistic({ votes, voted });
        alert((e as Error).message);
      }
    });
  };

  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs disabled:opacity-50",
        optimistic.voted
          ? "bg-zinc-900 text-white"
          : "text-zinc-600 hover:bg-zinc-100",
      )}
      title={optimistic.voted ? "Remove your vote" : "Upvote (max 3 per team)"}
    >
      <ArrowBigUp className="w-4 h-4" />
      {optimistic.votes}
    </button>
  );
}
