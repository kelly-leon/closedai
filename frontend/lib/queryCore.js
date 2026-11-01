function createQueryStore() {
  const entries = new Map();
  const reloaders = new Map();

  function get(key) {
    if (!entries.has(key)) entries.set(key, { status: "idle", expiresAt: 0, attempts: 0, listeners: new Set() });
    return entries.get(key);
  }

  function publish(key) {
    const entry = get(key);
    const snapshot = { status: entry.status, data: entry.data, error: entry.error };
    entry.listeners.forEach(listener => listener(snapshot));
  }

  async function fetch(key, loader, staleMs = 30000) {
    const entry = get(key);
    if (entry.inflight) return entry.inflight;
    if (entry.status === "success" && entry.expiresAt > Date.now()) return entry.data;

    entry.status = entry.data === undefined ? "loading" : "success";
    publish(key);
    entry.inflight = Promise.resolve().then(loader).then(value => {
      entry.status = "success";
      entry.data = value;
      entry.error = undefined;
      entry.expiresAt = Date.now() + staleMs;
      entry.attempts = 0;
      entry.inflight = undefined;
      publish(key);
      return value;
    }).catch(error => {
      entry.status = "error";
      entry.error = error;
      entry.inflight = undefined;
      publish(key);
      throw error;
    });
    return entry.inflight;
  }

  function subscribe(key, listener) {
    get(key).listeners.add(listener);
    return () => get(key).listeners.delete(listener);
  }

  function snapshot(key) {
    const entry = get(key);
    return { status: entry.status, data: entry.data, error: entry.error };
  }

  function invalidate(prefix) {
    for (const [key, entry] of entries) {
      if (key.startsWith(prefix)) entry.expiresAt = 0;
    }
  }

  function registerReloader(key, reloader) {
    reloaders.set(key, reloader);
  }

  async function refetchAll() {
    await Promise.all(Array.from(reloaders, ([key, reloader]) => {
      get(key).expiresAt = 0;
      return Promise.resolve().then(reloader).catch(() => undefined);
    }));
  }

  function reset() {
    entries.clear();
    reloaders.clear();
  }

  return { fetch, subscribe, snapshot, invalidate, registerReloader, refetchAll, reset };
}

module.exports = { createQueryStore };
