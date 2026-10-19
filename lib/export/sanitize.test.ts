import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { neutralizeFormula, startsLikeFormula } from "./sanitize";

describe("neutralizeFormula", () => {
  test("prefixes every OWASP trigger character with a quote", () => {
    for (const v of [
      "=1+1",
      '=HYPERLINK("https://evil.example","click")',
      "+1",
      "-2+3",
      "@SUM(A1:A2)",
      "\t=cmd",
      "\r=cmd",
      "\n=cmd",
      "＝1+1",
      "＋1",
      "－1",
      "＠SUM(A1)",
    ]) {
      assert.equal(neutralizeFormula(v), `'${v}`, JSON.stringify(v));
      assert.equal(startsLikeFormula(v), true);
    }
  });

  test("after leading whitespace", () => {
    for (const v of ["  =1+1", " @SUM(A1)", " +1", "   -2"]) {
      assert.equal(neutralizeFormula(v), `'${v}`, JSON.stringify(v));
    }
  });

  test("after leading control or zero-width characters", () => {
    for (const v of ["\u0000=1+1", "\u200b=1+1", "\ufeff@SUM(A1)", "\u2060 +1", "ok\n\u200d-2"]) {
      assert.equal(neutralizeFormula(v), `'${v}`, JSON.stringify(v));
    }
    assert.equal(neutralizeFormula("\u200bplain"), "\u200bplain");
  });

  test("on any line of a multi-line value", () => {
    for (const v of ["Call the vendor\n=HYPERLINK(\"x\")", "ok\r\n  @cmd", "a\rb\r-1"]) {
      assert.equal(neutralizeFormula(v), `'${v}`, JSON.stringify(v));
    }
  });

  test("leaves ordinary text alone", () => {
    for (const v of [
      "",
      "Call the vendor",
      "a=b",
      "Q3 - review",
      "email@x.com",
      "'quoted",
      "line one\nline two",
      "   ",
      "• one\n• two",
    ]) {
      assert.equal(neutralizeFormula(v), v, JSON.stringify(v));
    }
  });
});
