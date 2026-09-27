import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CSP_REPORT_GROUP,
  CSP_REPORT_PATH,
  THEME_SCRIPT,
  buildCsp,
  newNonce,
  scriptHash,
} from "./csp";

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );
}

const prod = directives(
  buildCsp({ nonce: "abc123==", authDomain: "hpb-eos-prod.firebaseapp.com", isDev: false }),
);

describe("buildCsp", () => {
  test("scripts: per-request nonce, strict-dynamic, theme script hash", () => {
    const s = prod.get("script-src")!;
    assert.ok(s.includes("'nonce-abc123=='"));
    assert.ok(s.includes("'strict-dynamic'"));
    assert.ok(s.includes(scriptHash(THEME_SCRIPT)));
    assert.ok(!s.includes("'unsafe-inline'"));
    assert.ok(!s.includes("'unsafe-eval'"), "no eval in production");
  });

  test("Next can read the nonce back out of the header", () => {
    // Mirrors next/dist/server/app-render/get-script-nonce-from-header.js.
    const re = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/;
    const nonce = newNonce();
    const csp = directives(
      buildCsp({ nonce, authDomain: "x.firebaseapp.com", isDev: false }),
    );
    const hit = csp.get("script-src")!.map((v) => v.match(re)).find(Boolean);
    assert.equal(hit?.[1], nonce);
  });

  test("Firebase client SDK and sign-in popup are allowed", () => {
    const c = prod.get("connect-src")!;
    for (const src of [
      "https://*.googleapis.com",
      "https://*.firebaseio.com",
      "wss://*.firebaseio.com",
    ]) {
      assert.ok(c.includes(src), src);
    }
    assert.ok(prod.get("frame-src")!.includes("https://hpb-eos-prod.firebaseapp.com"));
  });

  test("anti-framing, data: images, no plugins, reports wired", () => {
    assert.deepEqual(prod.get("frame-ancestors"), ["'none'"]);
    assert.ok(prod.get("img-src")!.includes("data:"));
    assert.deepEqual(prod.get("object-src"), ["'none'"]);
    assert.deepEqual(prod.get("report-uri"), [CSP_REPORT_PATH]);
    assert.deepEqual(prod.get("report-to"), [CSP_REPORT_GROUP]);
  });

  test("dev adds eval and HMR websockets only", () => {
    const dev = directives(
      buildCsp({ nonce: "n", authDomain: "x.firebaseapp.com", isDev: true }),
    );
    assert.ok(dev.get("script-src")!.includes("'unsafe-eval'"));
    assert.ok(dev.get("connect-src")!.includes("ws:"));
    assert.ok(!prod.get("connect-src")!.includes("ws:"));
  });
});

describe("scriptHash / newNonce", () => {
  test("hash is base64 sha256 of the exact source", () => {
    const expected = createHash("sha256").update("x();").digest("base64");
    assert.equal(scriptHash("x();"), `'sha256-${expected}'`);
  });

  test("nonces are fresh and 128-bit", () => {
    const a = newNonce();
    assert.notEqual(a, newNonce());
    assert.equal(Buffer.from(a, "base64").length, 16);
  });
});
