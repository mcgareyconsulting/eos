import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseTodosParams } from "./pages/todos";
import { exportUrl, todosExportParams } from "./urls";

describe("exportUrl", () => {
  test("the CSV endpoint carries the view", () => {
    assert.equal(
      exportUrl("todos", { team: "t1", archived: "1", owner: undefined }),
      "/api/export/todos?team=t1&archived=1",
    );
    assert.equal(exportUrl("x y", {}), "/api/export/x%20y");
  });

  test("the To-Dos page's view round-trips through its export definition", () => {
    const params = todosExportParams({ teamId: "t1", showArchived: true, ownerFilter: "u2" });
    const qs = new URL(exportUrl("todos", params), "https://x").searchParams;
    assert.deepEqual(parseTodosParams(qs), { teamId: "t1", archived: true, owner: "u2" });
    const all = todosExportParams({ teamId: "t1", showArchived: false, ownerFilter: "all" });
    assert.deepEqual(all, { team: "t1", archived: undefined, owner: undefined });
  });
});
