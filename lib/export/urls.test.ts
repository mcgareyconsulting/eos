import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseTodosParams } from "./pages/todos";
import { exportUrls, todosExportParams } from "./urls";

describe("exportUrls", () => {
  test("both formats carry the same view", () => {
    const urls = exportUrls("todos", { team: "t1", archived: "1", owner: undefined });
    assert.deepEqual(urls, {
      xlsx: "/api/export/todos?team=t1&archived=1",
      print: "/print/todos?team=t1&archived=1",
    });
    assert.equal(exportUrls("x y", {}).print, "/print/x%20y");
  });

  test("the To-Dos page's view round-trips through its export definition", () => {
    const params = todosExportParams({ teamId: "t1", showArchived: true, ownerFilter: "u2" });
    const qs = new URL(exportUrls("todos", params).xlsx, "https://x").searchParams;
    assert.deepEqual(parseTodosParams(qs), { teamId: "t1", archived: true, owner: "u2" });
    const all = todosExportParams({ teamId: "t1", showArchived: false, ownerFilter: "all" });
    assert.deepEqual(all, { team: "t1", archived: undefined, owner: undefined });
  });
});
