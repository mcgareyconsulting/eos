import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  EMAIL_UNVERIFIED_MESSAGE,
  NOT_AUTHORIZED_MESSAGE,
  isEmailAllowed,
  parseAllowlist,
  signInRefusal,
} from "./auth-allowlist";

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
    const list = parseAllowlist("@highplainsbank.com, consultant@example.com");
    assert.deepEqual(list, {
      domains: ["highplainsbank.com"],
      emails: ["consultant@example.com"],
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
  const list = parseAllowlist("@highplainsbank.com, consultant@example.com");

  test("null allowlist allows everyone", () => {
    assert.equal(isEmailAllowed(null, "anyone@example.com"), true);
  });

  test("allows the domain and the exact email, case-insensitively", () => {
    assert.equal(isEmailAllowed(list, "sam.reyes@highplainsbank.com"), true);
    assert.equal(isEmailAllowed(list, "Sam.Reyes@HighPlainsBank.com"), true);
    assert.equal(isEmailAllowed(list, "consultant@example.com"), true);
    assert.equal(isEmailAllowed(list, "Consultant@Example.com"), true);
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

describe("signInRefusal", () => {
  const list = parseAllowlist("@highplainsbank.com, consultant@example.com");

  test("admits a verified, allowlisted account", () => {
    assert.equal(
      signInRefusal({ email: "jane@highplainsbank.com", email_verified: true }, list),
      null,
    );
  });

  test("refuses an allowlisted address that is not verified (C-04)", () => {
    assert.equal(
      signInRefusal({ email: "jane@highplainsbank.com", email_verified: false }, list),
      EMAIL_UNVERIFIED_MESSAGE,
    );
    assert.equal(
      signInRefusal({ email: "jane@highplainsbank.com" }, list),
      EMAIL_UNVERIFIED_MESSAGE,
    );
  });

  test("only a literal true counts as verified", () => {
    const loose = { email: "jane@highplainsbank.com", email_verified: "true" };
    assert.equal(
      signInRefusal(loose as unknown as { email: string; email_verified: boolean }, list),
      EMAIL_UNVERIFIED_MESSAGE,
    );
  });

  test("refuses a verified account outside the allowlist", () => {
    assert.equal(
      signInRefusal({ email: "someone@gmail.com", email_verified: true }, list),
      NOT_AUTHORIZED_MESSAGE,
    );
  });

  test("open sign-in (no allowlist) still requires a verified email", () => {
    assert.equal(signInRefusal({ email: "a@b.com", email_verified: true }, null), null);
    assert.equal(
      signInRefusal({ email: "a@b.com", email_verified: false }, null),
      EMAIL_UNVERIFIED_MESSAGE,
    );
  });
});
