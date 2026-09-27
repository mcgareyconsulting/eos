import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REPORTS_PER_REQUEST,
  parseCspReports,
  rateLimiter,
  redactUrl,
} from "./csp-report";

describe("parseCspReports", () => {
  test("report-uri shape (application/csp-report)", () => {
    const [v] = parseCspReports({
      "csp-report": {
        "document-uri": "https://eos.example/teams/t1/todos?x=1#frag",
        "blocked-uri": "inline",
        "violated-directive": "script-src-elem",
        "effective-directive": "script-src-elem",
        "original-policy": "script-src 'nonce-SECRET'",
        disposition: "report",
        "source-file": "https://eos.example/_next/static/chunks/a.js",
        "line-number": 12,
        "script-sample": "alert(document.cookie)",
      },
    });
    assert.deepEqual(v, {
      documentUri: "https://eos.example/teams/t1/todos",
      blockedUri: "inline",
      directive: "script-src-elem",
      disposition: "report",
      sourceFile: "https://eos.example/_next/static/chunks/a.js",
      line: 12,
    });
  });

  test("report-to shape (application/reports+json)", () => {
    const out = parseCspReports([
      {
        type: "csp-violation",
        url: "https://eos.example/login",
        body: {
          documentURL: "https://eos.example/api/google/tasks/callback?code=SECRET",
          blockedURL: "https://evil.example/x.js?token=1",
          effectiveDirective: "script-src-elem",
          disposition: "report",
          lineNumber: "7",
          sample: "steal()",
        },
      },
      { type: "deprecation", body: {} },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].documentUri, "https://eos.example/api/google/tasks/callback");
    assert.equal(out[0].blockedUri, "https://evil.example/x.js");
    assert.equal(out[0].line, 7);
  });

  test("never carries samples or the policy (which holds the nonce)", () => {
    const out = parseCspReports({
      "csp-report": { "original-policy": "'nonce-SECRET'", "script-sample": "x" },
    });
    const json = JSON.stringify(out);
    assert.ok(!json.includes("SECRET"));
    assert.ok(!json.includes("script-sample"));
  });

  test("caps the number of reports and the field length", () => {
    const many = Array.from({ length: 50 }, () => ({
      type: "csp-violation",
      body: { effectiveDirective: "x".repeat(5000) },
    }));
    const out = parseCspReports(many);
    assert.equal(out.length, MAX_REPORTS_PER_REQUEST);
    assert.equal(out[0].directive?.length, 500);
  });

  test("junk in, nothing out", () => {
    assert.deepEqual(parseCspReports(null), []);
    assert.deepEqual(parseCspReports("hi"), []);
    assert.deepEqual(parseCspReports({ other: 1 }), []);
    assert.deepEqual(parseCspReports([1, null, "x"]), []);
  });
});

describe("redactUrl", () => {
  test("keeps keywords, drops free text and data payloads", () => {
    assert.equal(redactUrl("eval"), "eval");
    assert.equal(redactUrl("<script>alert(1)</script>"), null);
    assert.equal(redactUrl("data:text/html;base64,AAAA"), "data:…");
    assert.equal(redactUrl(42), null);
  });
});

describe("rateLimiter", () => {
  test("allows N per minute, then drops until the window resets", () => {
    const over = rateLimiter(2);
    assert.equal(over(1_000_000), false);
    assert.equal(over(1_000_001), false);
    assert.equal(over(1_000_002), true);
    assert.equal(over(1_061_000), false);
  });
});
