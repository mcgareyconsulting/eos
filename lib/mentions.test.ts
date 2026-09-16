import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyMention,
  filterMentionCandidates,
  findMentions,
  matchMentionAt,
  mentionQueryAt,
  mentionedIds,
} from "./mentions";

const roster = [
  { id: "u-steph", name: "Steph Benes" },
  { id: "u-joe", name: "Joe Smith" },
  { id: "u-jo", name: "Jo Park" },
  { id: "u-nancy", name: "Nancy" },
];
const names = roster.map((r) => r.name);

describe("matching @Name against a roster", () => {
  test("longest roster name wins and must end at a word boundary", () => {
    assert.deepEqual(matchMentionAt("@Jo Park can you", 0, names), {
      start: 0,
      end: 8,
      name: "Jo Park",
    });
    // "@Joe" is not "@Jo" followed by "e".
    assert.deepEqual(matchMentionAt("@Joe Smith", 0, names)?.name, "Joe Smith");
    assert.equal(matchMentionAt("@Josephine", 0, names), null);
  });

  test("case-insensitive, punctuation after the name is fine", () => {
    assert.equal(findMentions("thanks @steph benes!", names)[0]?.name, "Steph Benes");
    assert.equal(findMentions("(@Nancy)", names)[0]?.name, "Nancy");
  });

  test("an @ inside a word is never a mention (email addresses)", () => {
    assert.deepEqual(findMentions("mail nancy@highplainsbank.com", names), []);
    assert.deepEqual(findMentions("x@Nancy", names), []);
  });

  test("unknown names and a bare @ stay text", () => {
    assert.deepEqual(findMentions("@ nobody @Zed", names), []);
    assert.deepEqual(findMentions("no at-sign here", names), []);
  });

  test("mentionedIds dedupes repeats and keeps roster order", () => {
    assert.deepEqual(
      mentionedIds("@Nancy then @Steph Benes then @nancy again", roster),
      ["u-steph", "u-nancy"],
    );
    assert.deepEqual(mentionedIds("nothing", roster), []);
  });

  test("an empty roster never matches", () => {
    assert.deepEqual(findMentions("@Nancy", []), []);
  });
});

describe("composer query under the caret", () => {
  test("open picker right after typing @", () => {
    assert.deepEqual(mentionQueryAt("hi @", 4), { start: 3, query: "" });
  });

  test("tracks a partial first and last name", () => {
    assert.deepEqual(mentionQueryAt("hi @Steph Be", 12), {
      start: 3,
      query: "Steph Be",
    });
  });

  test("caret before the @ is not a query", () => {
    assert.equal(mentionQueryAt("hi @Steph", 2), null);
  });

  test("closes on a newline, a double space, or non-name characters", () => {
    assert.equal(mentionQueryAt("@Steph\nnext", 11), null);
    assert.equal(mentionQueryAt("@Steph  x", 9), null);
    assert.equal(mentionQueryAt("@Steph, ok", 10), null);
  });

  test("an email address never opens the picker", () => {
    assert.equal(mentionQueryAt("nancy@hp", 8), null);
  });
});

describe("filtering and applying a pick", () => {
  test("empty query lists everyone, prefix matches any word", () => {
    assert.deepEqual(
      filterMentionCandidates(roster, "").map((c) => c.id),
      ["u-steph", "u-joe", "u-jo", "u-nancy"],
    );
    assert.deepEqual(
      filterMentionCandidates(roster, "be").map((c) => c.id),
      ["u-steph"],
    );
    assert.deepEqual(
      filterMentionCandidates(roster, "jo").map((c) => c.id),
      ["u-joe", "u-jo"],
    );
    assert.deepEqual(filterMentionCandidates(roster, "zz"), []);
  });

  test("a finished name plus a space closes the list", () => {
    assert.deepEqual(filterMentionCandidates(roster, "Steph Benes "), []);
    // …but a first name plus a space is still searching for the last name.
    assert.deepEqual(
      filterMentionCandidates(roster, "Steph ").map((c) => c.id),
      ["u-steph"],
    );
  });

  test("limit caps the list", () => {
    assert.equal(filterMentionCandidates(roster, "", 2).length, 2);
  });

  test("applyMention replaces @query with @Name and a space", () => {
    const text = "hi @Ste there";
    const caret = 7; // after "@Ste"
    const q = mentionQueryAt(text, caret)!;
    const r = applyMention(text, q, caret, "Steph Benes");
    assert.equal(r.text, "hi @Steph Benes  there");
    assert.equal(r.caret, "hi @Steph Benes ".length);
  });
});
