const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CACHE_TTL_MS,
  sidebarCacheKey,
  readSidebarCache,
  writeSidebarCache,
  clearSidebarCache,
  isCurrentSidebarUnit,
} = require("../lib/sidebarCache.js");
const {
  SIDEBAR_SKELETON_TIMEOUT_MS,
  refreshSidebar,
  startSidebarLoadingDeadline,
} = require("../lib/sidebarRetry.js");

function storage() {
  const entries = new Map();
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key),
    entries,
  };
}

test("cached sidebar data paints synchronously before the network response", async () => {
  const store = storage();
  const data = { units: [{ id: "u1", name: "Course" }], conversations: [{ id: "c1", title: "Chat" }], usage: {} };
  writeSidebarCache(store, "user-1", data, 1000);
  const cache = readSidebarCache(store, "user-1", 1001);
  const events = [];
  let resolveNetwork;
  const pending = refreshSidebar(cache, () => new Promise(resolve => { resolveNetwork = resolve; }), value => events.push(["cache", value]), value => events.push(["fresh", value]));
  assert.equal(events[0][0], "cache");
  assert.equal(events.length, 1);
  resolveNetwork({ units: [], conversations: [] });
  await pending;
  assert.deepEqual(events.map(event => event[0]), ["cache", "fresh"]);
});

test("sidebar cache is user-scoped, expires after seven days, and clears on sign out", () => {
  const store = storage();
  writeSidebarCache(store, "user-1", {
    units: [{ id: "u1", name: "Course", email: "private@example.test" }],
    conversations: [{ id: "c1", title: "Chat", content: "private message" }],
    usage: { documents_used: 3, plan: "trial", access_token: "secret" },
  }, 1000);
  const raw = store.getItem(sidebarCacheKey("user-1"));
  assert.equal(readSidebarCache(store, "user-2", 1001), null);
  assert.equal(readSidebarCache(store, "user-1", 1000 + CACHE_TTL_MS + 1), null);
  assert.doesNotMatch(raw, /private@example|private message|access_token|secret|"plan"/);
  clearSidebarCache(store, "user-1");
  assert.equal(readSidebarCache(store, "user-1", 1001), null);
});

test("stale conversation responses do not match a newly selected unit", () => {
  assert.equal(isCurrentSidebarUnit("unit-2", "unit-1"), false);
  assert.equal(isCurrentSidebarUnit("unit-2", "unit-2"), true);
});

test("a failed refresh keeps cached content visible and retries before succeeding", async () => {
  const visible = [];
  let attempts = 0;
  const result = await refreshSidebar(
    { conversations: [{ id: "cached" }] },
    async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("offline"), { retryable: true });
      return { conversations: [{ id: "fresh" }] };
    },
    value => visible.push(value),
    () => {},
    { delays: [0], sleep: async () => {} },
  );
  assert.equal(attempts, 2);
  assert.equal(visible[0].conversations[0].id, "cached");
  assert.equal(result.conversations[0].id, "fresh");
});

test("the loading deadline exits skeleton state within eight seconds", () => {
  let scheduledDelay = 0;
  let callback;
  let deadlineReached = false;
  const cancel = startSidebarLoadingDeadline(() => { deadlineReached = true; }, (fn, delay) => {
    callback = fn;
    scheduledDelay = delay;
    return 1;
  }, () => {});
  assert.equal(scheduledDelay, 8000);
  assert.equal(SIDEBAR_SKELETON_TIMEOUT_MS, 8000);
  callback();
  assert.equal(deadlineReached, true);
  cancel();
});
