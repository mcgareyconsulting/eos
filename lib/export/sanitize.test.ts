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

  test("leaves ordinary text alone", () => {
    for (const v of ["", "Call the vendor", "a=b", "Q3 - review", "email@x.com", "'quoted"]) {
      assert.equal(neutralizeFormula(v), v);
    }
  });
});
