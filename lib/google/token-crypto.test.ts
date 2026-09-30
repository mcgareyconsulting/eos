import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  openToken,
  sealToken,
  setTokenCipherForTests,
  tokenEncryptionEnabled,
  type TokenCipher,
} from "./token-crypto";

const KEY = "projects/p/locations/us-east1/keyRings/eos/cryptoKeys/eos-tokens";

/**
 * A reversible stand-in for KMS that still enforces the two properties the
 * module relies on: the key name is passed through, and the AAD must match
 * on decrypt (a ciphertext moved to another uid's doc fails).
 */
function fakeCipher(): TokenCipher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async encrypt(keyName, plaintext, aad) {
      calls.push(`encrypt:${keyName}`);
      const body = Buffer.concat([aad, Buffer.from("|"), plaintext]);
      return { ciphertext: body, keyVersion: `${keyName}/cryptoKeyVersions/3` };
    },
    async decrypt(keyName, ciphertext, aad) {
      calls.push(`decrypt:${keyName}`);
      const sep = ciphertext.indexOf("|");
      const boundAad = ciphertext.subarray(0, sep);
      if (!boundAad.equals(aad)) throw new Error("AAD mismatch");
      return ciphertext.subarray(sep + 1);
    },
  };
}

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.GOOGLE_TOKEN_KMS_KEY;
  delete process.env.GOOGLE_TOKEN_KMS_KEY;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.GOOGLE_TOKEN_KMS_KEY;
  else process.env.GOOGLE_TOKEN_KMS_KEY = savedKey;
  setTokenCipherForTests(null);
});

describe("token-crypto", () => {
  test("encryption is off until GOOGLE_TOKEN_KMS_KEY is set", () => {
    assert.equal(tokenEncryptionEnabled(), false);
    process.env.GOOGLE_TOKEN_KMS_KEY = KEY;
    assert.equal(tokenEncryptionEnabled(), true);
    process.env.GOOGLE_TOKEN_KMS_KEY = "   ";
    assert.equal(tokenEncryptionEnabled(), false);
  });

  test("sealToken refuses when encryption is off (callers never silently store plaintext by accident)", async () => {
    await assert.rejects(() => sealToken("u1", "rt"), /GOOGLE_TOKEN_KMS_KEY is unset/);
  });

  test("openToken refuses when the key is unset — an encrypted row with no key is a deploy error", async () => {
    await assert.rejects(
      () => openToken("u1", { ciphertext: "AAAA", keyVersion: "v" }),
      /GOOGLE_TOKEN_KMS_KEY is unset/,
    );
  });

  test("round-trips through the configured key and records the key version", async () => {
    process.env.GOOGLE_TOKEN_KMS_KEY = KEY;
    const fake = fakeCipher();
    setTokenCipherForTests(fake);

    const sealed = await sealToken("u1", "1//refresh-token");
    assert.notEqual(sealed.ciphertext, "1//refresh-token");
    assert.equal(sealed.keyVersion, `${KEY}/cryptoKeyVersions/3`);
    assert.equal(await openToken("u1", sealed), "1//refresh-token");
    assert.deepEqual(fake.calls, [`encrypt:${KEY}`, `decrypt:${KEY}`]);
  });

  test("a ciphertext is bound to the uid it was sealed under", async () => {
    process.env.GOOGLE_TOKEN_KMS_KEY = KEY;
    setTokenCipherForTests(fakeCipher());

    const sealed = await sealToken("u1", "rt");
    await assert.rejects(() => openToken("u2", sealed), /AAD mismatch/);
  });
});
