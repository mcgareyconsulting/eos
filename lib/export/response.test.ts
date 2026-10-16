import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readXlsx } from "@/lib/xlsx";
import {
  bytesStream,
  isCrossSiteNavigation,
  isSameOrigin,
  printTokenResponse,
  xlsxResponse,
} from "./response";
import { NOT_ADMIN } from "./run";

describe("print door framing", () => {
  test("cross-site navigations are spotted by Sec-Fetch-Site", () => {
    const h = (v?: string) => new Headers(v === undefined ? {} : { "sec-fetch-site": v });
    assert.equal(isCrossSiteNavigation(h("same-origin")), false);
    assert.equal(isCrossSiteNavigation(h("none")), false);
    assert.equal(isCrossSiteNavigation(h()), false);
    assert.equal(isCrossSiteNavigation(h("cross-site")), true);
    assert.equal(isCrossSiteNavigation(h("same-site")), true);
  });

  test("print-token answers with the print view's URL, or the refusal", async () => {
    const ok = printTokenResponse("todos", { ok: true, token: "tok" });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store, private");
    assert.deepEqual(await ok.json(), { url: "/print/todos?t=tok" });
    const no = printTokenResponse("todos", { ok: false, status: 403, message: NOT_ADMIN });
    assert.equal(no.status, 403);
    assert.deepEqual(await no.json(), { error: NOT_ADMIN });
  });
});

function req(headers: Record<string, string>) {
  return new Request("https://pulse.example/api/export/todos", { method: "POST", headers });
}

describe("export response", () => {
  test("a refusal is JSON with its status, never a file", async () => {
    const res = xlsxResponse({ ok: false, status: 403, message: NOT_ADMIN });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("cache-control"), "no-store, private");
    assert.deepEqual(await res.json(), { error: NOT_ADMIN });
  });

  test("a table streams as an attachment the reader can open", async () => {
    const res = xlsxResponse({
      ok: true,
      table: {
        title: "To-Dos",
        headers: ["To-do"],
        widths: [20],
        rows: [["=1+1"]],
        provenance: [{ label: "Export", value: "HPB Pulse — To-Dos" }],
        fileName: "hpb-pulse_todos_ops_active_2026-10-16",
      },
    });
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get("content-disposition"),
      'attachment; filename="hpb-pulse_todos_ops_active_2026-10-16.xlsx"',
    );
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(res.headers.get("content-length"), String(buf.length));
    const [sheet] = readXlsx(buf);
    assert.deepEqual(sheet.rows.at(-1), ["'=1+1"]);
  });

  test("bytesStream chunks and ends", async () => {
    const data = new Uint8Array(200_000).fill(7);
    const out = Buffer.from(await new Response(bytesStream(data)).arrayBuffer());
    assert.equal(out.length, data.length);
  });

  test("same-origin check", () => {
    assert.equal(isSameOrigin(req({ origin: "https://pulse.example", host: "pulse.example" })), true);
    assert.equal(isSameOrigin(req({ origin: "https://evil.example", host: "pulse.example" })), false);
    assert.equal(
      isSameOrigin(req({ origin: "https://pulse.example", host: "internal:8080", "x-forwarded-host": "pulse.example" })),
      true,
    );
    assert.equal(isSameOrigin(req({ "sec-fetch-site": "cross-site" })), false);
    assert.equal(isSameOrigin(req({ origin: "null", host: "pulse.example" })), false);
  });
});
