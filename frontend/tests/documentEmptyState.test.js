const test = require("node:test");
const assert = require("node:assert/strict");
const { documentEmptyState } = require("../lib/documentEmptyState.js");

test("documents empty state decision is never empty while loading", () => {
  assert.equal(documentEmptyState([], "loading"), "loading");
  assert.equal(documentEmptyState([], "idle"), "loading");
  assert.equal(documentEmptyState([], "error"), "failed");
  assert.equal(documentEmptyState([], "success"), "empty");
});

test("documents empty state decision distinguishes processing and failures", () => {
  assert.equal(documentEmptyState([{ status: "processing" }], "success"), "processing");
  assert.equal(documentEmptyState([{ status: "failed" }, { status: "failed" }], "success"), "all-failed");
  assert.equal(documentEmptyState([{ status: "ready" }], "success"), "has-ready");
});
