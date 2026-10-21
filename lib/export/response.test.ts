import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { bytesStream, csvResponse, isSameOrigin } from "./response";
import { UNKNOWN_EXPORT } from "./run";

function req(headers: Record<string, string>) {
  return new Request("https://pulse.example/api/export/todos", { method: "POST", headers });
}

describe("export response", () => {
  test("a refusal is JSON with its status, never a file", async () => {
    const res = csvResponse({ ok: false, status: 404, message: UNKNOWN_EXPORT });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("cache-control"), "no-store, private");
    assert.match(res.headers.get("content-type") ?? "", /json/);
    assert.equal(res.headers.get("content-disposition"), null);
    assert.deepEqual(await res.json(), { error: UNKNOWN_EXPORT });
  });

  test("a table streams as a CSV attachment", async () => {
    const res = csvResponse({
      ok: true,
      table: {
        title: "To-Dos",
        headers: ["To-do"],
        rows: [["=1+1"]],
        fileName: "todos-ops-active-2026-10-16-1305-MT.csv",
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(res.headers.get("cache-control"), "no-store, private");
    assert.equal(
      res.headers.get("content-disposition"),
      'attachment; filename="todos-ops-active-2026-10-16-1305-MT.csv"',
    );
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(res.headers.get("content-length"), String(buf.length));
    assert.equal(buf.toString("utf8"), "﻿To-do\r\n'=1+1\r\n");
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
