import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { kmsTokenCipher, tokenAad } from "./token-cipher";

const KEY = "projects/p/locations/us-east1/keyRings/eos/cryptoKeys/eos-tokens";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

describe("kmsTokenCipher", () => {
  test("encrypt posts base64 plaintext + AAD to the key with a bearer token", async () => {
    const calls = stubFetch(200, { name: `${KEY}/cryptoKeyVersions/3`, ciphertext: "Q1Q=" });
    const cipher = kmsTokenCipher(KEY, async () => "access-tok");

    const out = await cipher.encrypt("rt-1", tokenAad("u1"));

    assert.deepEqual(out, { ciphertext: "Q1Q=", keyVersion: `${KEY}/cryptoKeyVersions/3` });
    assert.equal(calls[0].url, `https://cloudkms.googleapis.com/v1/${KEY}:encrypt`);
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer access-tok");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      plaintext: b64("rt-1"),
      additionalAuthenticatedData: b64("google_tasks_connections/u1"),
    });
  });

  test("decrypt sends the same AAD and decodes the plaintext", async () => {
    const calls = stubFetch(200, { plaintext: b64("rt-1") });
    const cipher = kmsTokenCipher(KEY, async () => "t");

    assert.equal(await cipher.decrypt("Q1Q=", tokenAad("u1")), "rt-1");
    assert.equal(calls[0].url, `https://cloudkms.googleapis.com/v1/${KEY}:decrypt`);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      ciphertext: "Q1Q=",
      additionalAuthenticatedData: b64("google_tasks_connections/u1"),
    });
  });

  test("a KMS error throws without echoing the token", async () => {
    stubFetch(403, { error: { message: "Permission denied" } });
    const cipher = kmsTokenCipher(KEY, async () => "t");
    await assert.rejects(cipher.encrypt("super-secret-rt", "aad"), (err: Error) => {
      assert.match(err.message, /KMS encrypt failed: 403/);
      assert.doesNotMatch(err.message, /super-secret-rt/);
      assert.doesNotMatch(err.message, new RegExp(b64("super-secret-rt")));
      return true;
    });
  });
});
