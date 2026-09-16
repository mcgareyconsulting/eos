// @mentions in comment bodies.
//
// The stored text stays plain: a mention is literally `@Steph Benes` in the
// comment string, nothing more. That keeps every downstream reader (BigQuery
// batch, richTextToPlain, a title tooltip) showing exactly what the author
// typed, with no token syntax to learn and nothing to migrate. The cost is
// that "where does the name end?" cannot be answered from the text alone —
// names have spaces — so both ends resolve mentions against a roster: the
// composer inserts a name it was given, and the server + renderer match the
// text against the same team roster (longest name wins).
//
// Everything here is pure so the caret arithmetic and the matching rule can
// be unit-tested without a textarea or a Firestore.

export type MentionCandidate = { id: string; name: string };

export type MentionMatch = {
  /** Index of the `@`. */
  start: number;
  /** Index just past the name. */
  end: number;
  name: string;
};

/** A word character for the purposes of "is this `@` starting a mention". */
const WORD = /[A-Za-z0-9]/;

/**
 * True when an `@` at `i` can begin a mention: at the start of the text or
 * after something that is not a word character. Keeps `jane@highplainsbank.com`
 * from ever reading as a mention of anyone.
 */
export function canStartMentionAt(text: string, i: number): boolean {
  if (text[i] !== "@") return false;
  const before = text[i - 1];
  return before === undefined || !WORD.test(before);
}

/**
 * Matches a roster name at `i` (which must be an `@`). Case-insensitive,
 * longest name wins, and the name must end at a word boundary so
 * "@Jo" never claims "@Joe". Returns null when nothing on the roster fits.
 */
export function matchMentionAt(
  text: string,
  i: number,
  names: readonly string[],
): MentionMatch | null {
  if (!canStartMentionAt(text, i)) return null;
  const rest = text.slice(i + 1);
  const lower = rest.toLowerCase();
  let best: string | null = null;
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    if (!lower.startsWith(name.toLowerCase())) continue;
    const after = rest[name.length];
    if (after !== undefined && WORD.test(after)) continue;
    if (!best || name.length > best.length) best = name;
  }
  if (!best) return null;
  return { start: i, end: i + 1 + best.length, name: best };
}

/** Every mention in `text`, in document order, resolved against `names`. */
export function findMentions(
  text: string,
  names: readonly string[],
): MentionMatch[] {
  const out: MentionMatch[] = [];
  if (names.length === 0) return out;
  let i = text.indexOf("@");
  while (i !== -1) {
    const m = matchMentionAt(text, i, names);
    if (m) {
      out.push(m);
      i = text.indexOf("@", m.end);
    } else {
      i = text.indexOf("@", i + 1);
    }
  }
  return out;
}

/**
 * Roster ids mentioned in `text`. A candidate can be mentioned once however
 * many times the name appears; two people sharing a display name both
 * resolve (the text cannot tell them apart, and under-notifying is the worse
 * failure).
 */
export function mentionedIds(
  text: string,
  candidates: readonly MentionCandidate[],
): string[] {
  const names = candidates.map((c) => c.name);
  const hit = new Set(
    findMentions(text, names).map((m) => m.name.toLowerCase()),
  );
  const ids: string[] = [];
  for (const c of candidates) {
    if (hit.has(c.name.trim().toLowerCase()) && !ids.includes(c.id)) {
      ids.push(c.id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Composer side: the `@` picker.
// ---------------------------------------------------------------------------

export type MentionQuery = {
  /** Index of the `@` being completed. */
  start: number;
  /** Text typed after the `@`, up to the caret. */
  query: string;
};

/**
 * Longest partial name the picker will keep matching against. A query longer
 * than any plausible name means the author has moved on to prose, and the
 * picker should get out of the way rather than track the rest of the line.
 */
const MAX_QUERY = 40;

/**
 * If the caret sits inside an `@…` being typed, returns the `@` position and
 * the text after it; otherwise null. The query may contain single spaces (a
 * first and last name) but a second word after a space closes the picker
 * unless it still prefixes a candidate — see `filterMentionCandidates`.
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (!canStartMentionAt(text, at)) return null;
  const query = upto.slice(at + 1);
  if (query.length > MAX_QUERY) return null;
  if (/\n/.test(query)) return null;
  if (/ {2,}/.test(query)) return null;
  if (/[^A-Za-z0-9 .'\-]/.test(query)) return null;
  return { start: at, query };
}

/**
 * Candidates whose name starts with the query, or any of whose words does,
 * case-insensitive. An empty query lists everyone. Roster order is kept so
 * the list reads the same as the owner dropdown beside it.
 */
export function filterMentionCandidates<T extends MentionCandidate>(
  candidates: readonly T[],
  query: string,
  limit = 6,
): T[] {
  const q = query.trim().toLowerCase();
  // "@Steph Benes " — a whole name followed by a space is a finished mention
  // (exactly what picking one inserts), not a search for it; keeping the list
  // open here would re-open the picker the moment a pick landed.
  if (
    /\s$/.test(query) &&
    candidates.some((c) => c.name.trim().toLowerCase() === q)
  ) {
    return [];
  }
  const out: T[] = [];
  for (const c of candidates) {
    const name = c.name.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    const hit =
      q === "" ||
      lower.startsWith(q) ||
      lower.split(/\s+/).some((w) => w.startsWith(q));
    if (hit) out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Replaces the `@query` under the caret with `@Name ` and returns the new
 * text plus where the caret lands (after the trailing space, ready to type).
 */
export function applyMention(
  text: string,
  q: MentionQuery,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const inserted = `@${name.trim()} `;
  const next = text.slice(0, q.start) + inserted + text.slice(caret);
  return { text: next, caret: q.start + inserted.length };
}
