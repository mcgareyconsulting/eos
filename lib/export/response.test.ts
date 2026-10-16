import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readXlsx } from "@/lib/xlsx";
import { bytesStream, isSameOrigin, xlsxResponse } from "./response";
import { NOT_ADMIN } from "./run";

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
