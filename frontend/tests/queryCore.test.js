const test = require("node:test");
const assert = require("node:assert/strict");
const { createQueryStore } = require("../lib/queryCore.js");

test("deduplicates an in-flight request", async () => {
  const store = createQueryStore();
  let calls = 0;
  const loader = () => { calls += 1; return new Promise(resolve => setTimeout(() => resolve(["data"]), 20)); };
  const [a, b] = await Promise.all([store.fetch("units", loader), store.fetch("units", loader)]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
});

test("retries a failed load and then succeeds", async () => {
  const store = createQueryStore();
  let calls = 0;
  await assert.rejects(store.fetch("documents", () => { calls += 1; return Promise.reject(new Error("offline")); }));
  assert.equal(store.snapshot("documents").status, "error");
  const data = await store.fetch("documents", () => { calls += 1; return Promise.resolve(["ready"]); });
  assert.deepEqual(data, ["ready"]);
  assert.equal(calls, 2);
});

test("lifecycle refetch reloads registered stale queries", async () => {
  const store = createQueryStore();
  let calls = 0;
  store.registerReloader("usage", () => store.fetch("usage", () => { calls += 1; return Promise.resolve({ plan: "trial" }); }, 0));
  await store.fetch("usage", () => { calls += 1; return Promise.resolve({ plan: "trial" }); }, 0);
  await store.refetchAll();
  assert.equal(calls, 2);
});

test("one failed load never leaves a permanent loading state", async () => {
  const store = createQueryStore();
  await assert.rejects(store.fetch("conversations", () => Promise.reject(new Error("failed"))));
  assert.equal(store.snapshot("conversations").status, "error");
  assert.equal(store.snapshot("conversations").data, undefined);
});
