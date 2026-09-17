// Client-safe result shapes for the admin console (not a "use server" module).

export type AdminResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * What a delete actually did, so the confirm dialog can report it honestly
 * rather than claiming more than happened.
 */
export type DeleteResult =
  | {
      ok: true;
      message: string;
      /** Rosters the person was removed from. */
      teamsRemoved: number;
      /** Whether an Identity Platform account was actually deleted. */
      signInRevoked: boolean;
    }
  | { ok: false; error: string };
