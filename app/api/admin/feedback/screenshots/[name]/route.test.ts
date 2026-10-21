import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "./route";

// The real route with the real session check: outside a request there is no
// session cookie, which must read as "not an admin" — a 404, never the file
// and never a redirect.
test("GET without a session is a 404", async () => {
  const res = await GET(new Request("http://localhost/api/admin/feedback/screenshots/row02.png"), {
    params: Promise.resolve({ name: "row02.png" }),
  });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});
