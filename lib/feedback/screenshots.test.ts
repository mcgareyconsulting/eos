import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { redirect } from "next/navigation";
import { FakeFirestore } from "@/lib/test-support/fake-firestore";
import {
  FEEDBACK_SCREENSHOT_DIR,
  FEEDBACK_SCREENSHOT_NAMES,
  feedbackScreenshotUrl,
  servableFeedbackScreenshot,
} from "./screenshots";
import { feedbackScreenshotResponse, readScreenshotFile, type ScreenshotDeps } from "./screenshot-response";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// A Firestore holding only the tracker's access list.
const db = new FakeFirestore();
db.seed("app_config", "feedback_tracker", { emails: ["listed@example.com"] });

type Who = "listed" | "unlisted" | "orgAdmin" | "anonymous";
function userFor(who: Who) {
  return async () => {
    // requireFirebaseUser without a session: redirect("/login") throws.
    if (who === "anonymous") redirect("/login");
    return {
      uid: who,
      email: who === "listed" ? "listed@example.com" : `${who}@example.com`,
      emailVerified: true,
      isAdmin: who === "orgAdmin",
      db: db.asFirestore(),
    };
  };
}

function deps(who: Who, reads: string[] = []): ScreenshotDeps {
  return {
    user: userFor(who),
    readFile: async (p) => {
      reads.push(p);
      return PNG;
    },
  };
}

describe("the allow-list", () => {
  test("is exactly the PNGs in docs/feedback/screenshots", () => {
    const onDisk = readdirSync(resolve(FEEDBACK_SCREENSHOT_DIR)).filter((n) => n.endsWith(".png")).sort();
    assert.deepEqual([...FEEDBACK_SCREENSHOT_NAMES].sort(), onDisk);
  });

  test("servableFeedbackScreenshot returns the list's own string, or null", () => {
    assert.equal(servableFeedbackScreenshot("row02.png"), "row02.png");
    for (const bad of ["../x", "row1.png", "row99.png", "ROW02.png", "row02.PNG", "row02.png/", "/row02.png", "row02.png\0", "..%2Frow02.png", "", 2, null]) {
      assert.equal(servableFeedbackScreenshot(bad), null, String(bad));
    }
  });

  test("url", () => {
    assert.equal(feedbackScreenshotUrl("row37.png"), "/api/admin/feedback/screenshots/row37.png");
  });
});

describe("feedbackScreenshotResponse", () => {
  test("an admin gets the PNG with private, no-store and nosniff", async () => {
    const reads: string[] = [];
    const res = await feedbackScreenshotResponse("row37.png", deps("listed", reads));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), PNG);
    assert.deepEqual(reads, ["row37.png"]);
  });

  test("readScreenshotFile reads from docs/feedback/screenshots", async () => {
    const bytes = new Uint8Array(await readScreenshotFile("row37.png"));
    assert.deepEqual(bytes.subarray(0, 8), PNG);
    assert.equal(FEEDBACK_SCREENSHOT_DIR, "docs/feedback/screenshots", "keep in step with readScreenshotFile");
  });

  test("reads the real file from the repo by default", async () => {
    const res = await feedbackScreenshotResponse("row02.png", { user: userFor("listed") });
    assert.equal(res.status, 200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual(bytes.subarray(0, 8), PNG);
  });

  test("unlisted (an org admin included) and anonymous callers get a 404, and nothing is read", async () => {
    for (const who of ["unlisted", "orgAdmin", "anonymous"] as const) {
      const reads: string[] = [];
      const res = await feedbackScreenshotResponse("row02.png", deps(who, reads));
      assert.equal(res.status, 404, String(who));
      assert.equal(res.headers.get("cache-control"), "private, no-store");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.deepEqual(reads, []);
    }
  });

  test("bad or unlisted names are refused before any read", async () => {
    for (const name of ["../x", "row1.png", "row99.png", "ROW02.png", "../../.env.local", "row02.png.."]) {
      const reads: string[] = [];
      const res = await feedbackScreenshotResponse(name, deps("listed", reads));
      assert.equal(res.status, 404, name);
      assert.deepEqual(reads, [], name);
    }
  });

  test("a listed file missing on disk is a 404, not a crash", async () => {
    const res = await feedbackScreenshotResponse("row02.png", {
      user: userFor("listed"),
      readFile: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    });
    assert.equal(res.status, 404);
  });
});
