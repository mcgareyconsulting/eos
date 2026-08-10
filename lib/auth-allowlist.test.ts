import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isEmailAllowed, parseAllowlist } from "./auth-allowlist";

// The allowlist is the sign-in perimeter promised to the client ("HPB
// Workspace accounts plus the consultant, no one else"), so both directions
// are pinned: the right accounts get in AND the wrong ones stay out.

describe("parseAllowlist", () => {
  test("unset or empty means open sign-in (trial behavior)", () => {
    assert.equal(parseAllowlist(undefined), null);
    assert.equal(parseAllowlist(""), null);
    assert.equal(parseAllowlist("  ,  "), null);
  });

  test("splits domains from exact emails", () => {
    const list = parseAllowlist("@highplainsbank.com, daniel@mcgareyconsulting.com");
    assert.deepEqual(list, {
      domains: ["highplainsbank.com"],
      emails: ["daniel@mcgareyconsulting.com"],
    });
  });

  test("normalizes case and whitespace", () => {
    const list = parseAllowlist(" @HighPlainsBank.com ,  Someone@Gmail.COM ");
    assert.deepEqual(list, {
      domains: ["highplainsbank.com"],
      emails: ["someone@gmail.com"],
    });
  });
});

describe("isEmailAllowed", () => {
  const list = parseAllowlist("@highplainsbank.com, daniel@mcgareyconsulting.com");

  test("null allowlist allows everyone", () => {
    assert.equal(isEmailAllowed(null, "anyone@example.com"), true);
  });

  test("allows the domain and the exact email, case-insensitively", () => {
    assert.equal(isEmailAllowed(list, "steph.benes@highplainsbank.com"), true);
    assert.equal(isEmailAllowed(list, "Steph.Benes@HighPlainsBank.com"), true);
    assert.equal(isEmailAllowed(list, "daniel@mcgareyconsulting.com"), true);
    assert.equal(isEmailAllowed(list, "Daniel@McGareyConsulting.com"), true);
  });

  test("rejects everything else", () => {
    assert.equal(isEmailAllowed(list, "other.person@gmail.com"), false);
    assert.equal(isEmailAllowed(list, "attacker@highplainsbank.com.evil.com"), false);
    assert.equal(isEmailAllowed(list, "someone@nothighplainsbank.com"), false);
  });

  test("rejects missing or malformed emails when restricted", () => {
    assert.equal(isEmailAllowed(list, undefined), false);
    assert.equal(isEmailAllowed(list, ""), false);
    assert.equal(isEmailAllowed(list, "not-an-email"), false);
  });

  test("a subdomain is not the domain", () => {
    assert.equal(isEmailAllowed(list, "user@mail.highplainsbank.com"), false);
  });
});
